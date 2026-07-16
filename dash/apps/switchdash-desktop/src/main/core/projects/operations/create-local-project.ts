import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { err, ok } from '@switchdash/shared';
import { sql } from 'drizzle-orm';
import { createAgent } from '@main/core/agents/createAgent';
import { detectSwitchAgent } from '@main/core/agents/detect';
import { detectSwitchAgentRemote } from '@main/core/agents/detect-remote';
import { reconcileAgentAutoSessionFromGateway } from '@main/core/agents/setAgentAutoSession';
import { setAgentConnection } from '@main/core/agents/setAgentConnection';
import { projectEvents } from '@main/core/projects/project-events';
import { projectManager } from '@main/core/projects/project-manager';
import { agentExistsOnServer, GatewayError } from '@main/core/switch-servers/gateway-client';
import { getServer } from '@main/core/switch-servers/servers-store';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { log } from '@main/lib/logger';
import type { AgentRemoteConfig } from '@shared/core/agents/agent-connection';
import type { AgentProviderId } from '@shared/core/providers/agent-provider-registry';
import { basenameFromAnyPath } from '@shared/path-name';
import type { CreateProjectError, CreateProjectResult, ProjectPathStatus } from '@shared/projects';
import { checkIsValidDirectory } from '../path-utils';

export type CreateLocalProjectParams = {
  id?: string;
  /** The local working directory. Omit for a remote agent (see `remoteConfig`). */
  path?: string;
  name: string;
  /** The registered Switch server the user chose for this agent. */
  serverId: string;
  /** The agent type (CLI provider) chosen at onboarding. */
  providerId: AgentProviderId;
  /** When set, the agent runs remotely on this SSH host + working dir, and there
   * is no local directory. */
  remoteConfig?: AgentRemoteConfig;
};

/**
 * Gate agent creation on the chosen server actually owning the detected agent
 * (and on being signed in). Every agent in the app is bound to a usable server
 * it provably exists on. `dir` is used only for error reporting.
 */
async function verifyAgentOnServer(
  serverId: string,
  agentId: string,
  dir: string | null
): Promise<CreateProjectError | null> {
  const server = await getServer(serverId);
  if (!server) {
    throw new Error(`No Switch server with id ${serverId}`);
  }
  try {
    const exists = await agentExistsOnServer(server, agentId);
    if (!exists) {
      return {
        type: 'switch-agent-not-on-server',
        path: dir ?? '',
        serverId: server.id,
        serverName: server.name,
        agentId,
      };
    }
    return null;
  } catch (cause) {
    if (cause instanceof GatewayError && cause.kind === 'unauthorized') {
      return {
        type: 'switch-server-unauthenticated',
        path: dir ?? '',
        serverId: server.id,
        serverName: server.name,
      };
    }
    throw cause;
  }
}

export async function createLocalProject(
  params: CreateLocalProjectParams
): Promise<CreateProjectResult> {
  return params.remoteConfig
    ? createRemoteProject(params, params.remoteConfig)
    : createLocalOnlyProject(params);
}

async function createLocalOnlyProject(
  params: CreateLocalProjectParams
): Promise<CreateProjectResult> {
  const localPath = params.path;
  if (!localPath) {
    return err({ type: 'invalid-directory', path: '', message: 'A directory is required' });
  }

  const isValidDirectory = checkIsValidDirectory(localPath);
  if (!isValidDirectory) {
    return err({ type: 'invalid-directory', path: localPath, message: 'Invalid directory' });
  }

  // Adding a directory == onboarding a Switch agent. Reject directories that are
  // not configured as a Switch agent (no `.claude/settings.local.json` block).
  const switchAgent = await detectSwitchAgent(localPath);
  if (!switchAgent) {
    return err({
      type: 'invalid-directory',
      path: localPath,
      message:
        'This directory is not configured as a Switch agent. Configure the agent first (run the switch-connector configure skill) before adding it.',
    });
  }

  const serverError = await verifyAgentOnServer(params.serverId, switchAgent.agentId, localPath);
  if (serverError) return err(serverError);

  const [row] = await db
    .insert(projects)
    .values({
      id: params.id ?? randomUUID(),
      name: params.name,
      path: localPath,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  const project = rowToLocalProject(row);

  const agent = await createAgent({
    id: randomUUID(),
    projectId: project.id,
    name: path.basename(localPath) || params.providerId,
    providerId: params.providerId,
    switchAgentId: switchAgent.agentId,
    apiEndpoint: switchAgent.apiEndpoint,
    serverId: params.serverId,
  });

  // Seed the local auto_session mirror + start the watcher from the gateway
  // profile so an agent registered with auto_session on starts watching now,
  // without the operator toggling it off→on (CHOO-1185). Best-effort: a gateway
  // hiccup must not fail project creation — the settings panel reconciles later.
  await reconcileAgentAutoSessionFromGateway(agent.id).catch((error) => {
    log.warn('createLocalProject: failed to reconcile auto_session for new agent', {
      agentId: agent.id,
      error: String(error),
    });
  });

  await projectManager.openProject(project);
  projectEvents._emit('project:created', project);
  return ok(project);
}

async function createRemoteProject(
  params: CreateLocalProjectParams,
  remoteConfig: AgentRemoteConfig
): Promise<CreateProjectResult> {
  // A remote agent has no local directory: detect + validate its Switch config
  // in the remote working dir over SSH. Its `.claude/settings.local.json`
  // already lives on the host (creds are not copied from a local dir).
  const switchAgent = await detectSwitchAgentRemote(
    remoteConfig.sshHost,
    remoteConfig.remoteRepoDir
  );
  if (!switchAgent) {
    return err({
      type: 'invalid-directory',
      path: remoteConfig.remoteRepoDir,
      message: `The remote directory ${remoteConfig.remoteRepoDir} on ${remoteConfig.sshHost} is not configured as a Switch agent.`,
    });
  }

  const serverError = await verifyAgentOnServer(
    params.serverId,
    switchAgent.agentId,
    remoteConfig.remoteRepoDir
  );
  if (serverError) return err(serverError);

  const [row] = await db
    .insert(projects)
    .values({
      id: params.id ?? randomUUID(),
      name: params.name,
      path: null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  const project = rowToLocalProject(row);

  const agent = await createAgent({
    id: randomUUID(),
    projectId: project.id,
    name: basenameFromAnyPath(remoteConfig.remoteRepoDir) || params.providerId,
    providerId: params.providerId,
    switchAgentId: switchAgent.agentId,
    apiEndpoint: switchAgent.apiEndpoint,
    serverId: params.serverId,
  });

  // Record the remote connection. The Switch creds already live on the host, so
  // there is no local→remote copy (setupRemoteAgent is intentionally skipped).
  await setAgentConnection({
    agentId: agent.id,
    connection: 'remote',
    remoteConfig,
  });

  // Reconcile auto_session after the connection is recorded as remote so the
  // remote branch (ensureRemoteWatcher → sidecar + watch-enabled marker file)
  // runs for a fresh remote agent registered with auto_session on (CHOO-1185).
  // Best-effort: an unreachable VM must not fail project creation.
  await reconcileAgentAutoSessionFromGateway(agent.id).catch((error) => {
    log.warn('createRemoteProject: failed to reconcile auto_session for new agent', {
      agentId: agent.id,
      error: String(error),
    });
  });

  await projectManager.openProject(project);
  projectEvents._emit('project:created', project);
  return ok(project);
}

function rowToLocalProject(row: typeof projects.$inferSelect) {
  return {
    type: 'local' as const,
    id: row.id,
    name: row.name,
    path: row.path,
    repositoryWorkspaceId: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getLocalProjectPathStatus(path: string): Promise<ProjectPathStatus> {
  return { isDirectory: checkIsValidDirectory(path) };
}
