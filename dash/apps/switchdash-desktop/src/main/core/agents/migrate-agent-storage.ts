import { getLocationById } from '@main/core/locations/store';
import { getPlugin } from '@main/core/providers/plugin-registry';
import { backfillSessionAgentName } from '@main/core/sessions/operations/backfillSessionAgentName';
import { parseSwitchAgentCredentials } from '@main/core/switch-rooms/switch-credentials';
import { fetchAgentDetail } from '@main/core/switch-servers/gateway-client';
import { getServer } from '@main/core/switch-servers/servers-store';
import { log } from '@main/lib/logger';
import type { Agent } from '@shared/core/agents/agents';
import {
  isAgentStorageMigrationComplete,
  markAgentStorageMigrationComplete,
} from './agent-storage-migration-marker';
import { resolveWorkspaceFsFor } from './agent-workspace-fs';
import { getAgents } from './getAgents';
import { agentSettingsRelativePath, SWITCH_SETTINGS_RELATIVE_PATH } from './switch-settings-paths';
import { updateAgent } from './updateAgent';

/**
 * Migrate existing switchdash-managed agents to the current storage/definition
 * layout (CHOO-1440): every agent is a repository-defined agent with a per-agent
 * credentials file at `.switch/agents/<name>.json`, an on-disk definition, and a
 * populated `definitionName`. Pre-CHOO-1440 installs kept credentials in the
 * legacy `.claude/switch-subagents/<name>.settings.json` (or the shared
 * `.claude/settings.local.json`) and left `definitionName` null.
 *
 * Runs once at boot, best-effort: each agent is migrated in isolation so one bad
 * directory or unreachable host never aborts the rest, and every step is
 * idempotent (re-running does nothing once an agent is in the new layout).
 * Applies to LOCAL and REMOTE agents alike — remote reads/writes go over SFTP
 * through the same provider filesystem abstraction.
 */
export async function migrateAgentStorage(): Promise<void> {
  // Once a full pass has migrated every agent, never re-run: the steady-state
  // migration re-opens each agent's workspace filesystem (an SSH/SFTP round trip
  // per remote agent) on every boot for no benefit.
  if (await isAgentStorageMigrationComplete()) return;

  const agents = await getAgents();
  let migrated = 0;
  let allComplete = true;
  for (const agent of agents) {
    try {
      const result = await migrateOne(agent);
      if (result.changed) migrated += 1;
      if (!result.complete) allComplete = false;
    } catch (error) {
      allComplete = false;
      log.warn('migrateAgentStorage: failed to migrate agent', {
        agentId: agent.id,
        error: String(error),
      });
    }
  }
  if (migrated > 0) {
    log.info('migrateAgentStorage: migrated agents to the neutral storage layout', { migrated });
  }
  // Only latch the marker when every agent reached the final layout this pass.
  // A transient failure (unreachable host, gateway down) leaves it unset so the
  // next boot retries — cheaply, since the migration now runs off the boot path.
  if (allComplete) await markAgentStorageMigrationComplete();
}

interface MigrateResult {
  /** Whether this pass wrote anything for the agent. */
  changed: boolean;
  /** Whether the agent is now fully in the new layout (nothing left to retry). */
  complete: boolean;
}

/** Migrate one agent (local or remote). */
async function migrateOne(agent: Agent): Promise<MigrateResult> {
  const behavior = getPlugin(agent.providerId).behavior.repoAgents;
  if (!behavior) return { changed: false, complete: true };

  const location = await getLocationById(agent.locationId);
  if (!location) return { changed: false, complete: true };

  const workspace = await resolveWorkspaceFsFor(location.sshHost, location.dir);
  try {
    // Resolve the agent's REAL name — the credentials/definition stem, NOT
    // `agent.name` (the directory-derived display name). Prefer the row's
    // definitionName; else the on-disk agent matched to this row by switchAgentId;
    // else the registered Switch name from the gateway (authoritative — the same
    // name new agents are created under). Never the directory name (CHOO-1440).
    let name = agent.definitionName;
    let description = agent.name;
    if (!name) {
      // No switchAgentId → nothing anchors a real name; leave for a later boot
      // in case the row is still being populated.
      if (!agent.switchAgentId) return { changed: false, complete: false };
      const discovered = await behavior.discoverLocal(workspace.fs, workspace.homeFs);
      const match = discovered.find((d) => d.switchAgentId === agent.switchAgentId);
      if (match) {
        name = match.name;
        description = match.description ?? match.name;
      } else {
        const registered = await fetchRegisteredName(agent);
        if (!registered) {
          log.info('migrateAgentStorage: could not resolve a real name for agent; skipping', {
            agentId: agent.id,
            switchAgentId: agent.switchAgentId,
          });
          // Resolution may fail transiently (gateway down); retry next boot.
          return { changed: false, complete: false };
        }
        name = registered.name;
        description = registered.description;
      }
    }

    let changed = false;

    // 1. Credentials: if the name-keyed neutral file is absent, adopt whatever
    //    complete credentials already exist on disk, in priority order:
    //      a. a stale ID-keyed neutral file `.switch/agents/<agentId>.json` — an
    //         earlier layout keyed the neutral file by agent id, not name;
    //      b. the legacy per-agent file (via readLaunchEnv: name-keyed neutral
    //         then `.claude/switch-subagents/<name>.settings.json`);
    //      c. the shared `.claude/settings.local.json` (legacy "main" agent).
    //    The token is minted once and lives only on disk, so this is the only way
    //    to recover it — nothing can reconstruct it from the gateway.
    const idKeyedRelPath = agentSettingsRelativePath(agent.id);
    const namedRelPath = agentSettingsRelativePath(name);
    const neutral = name === agent.id ? null : await workspace.fs.read(namedRelPath);
    if (neutral === null) {
      const creds =
        parseSwitchAgentCredentials((await workspace.fs.read(idKeyedRelPath)) ?? '', log) ??
        toCreds(await behavior.readLaunchEnv(workspace.fs, name)) ??
        parseSwitchAgentCredentials(
          (await workspace.fs.read(SWITCH_SETTINGS_RELATIVE_PATH)) ?? '',
          log
        );
      if (creds) {
        await behavior.writeCredentials(workspace.fs, {
          agentName: name,
          apiEndpoint: creds.apiEndpoint,
          apiToken: creds.token,
          agentId: creds.agentId,
        });
        changed = true;
      }
    }

    // Remove the stale ID-keyed neutral file once the name-keyed one is in place:
    // an incomplete leftover there otherwise shadows the real creds in the
    // session preflight (which scans both), and a complete one is now redundant.
    if (name !== agent.id && (await workspace.fs.read(namedRelPath)) !== null) {
      if ((await workspace.fs.read(idKeyedRelPath)) !== null) {
        await workspace.fs.delete(idKeyedRelPath);
        changed = true;
      }
    }

    // 2. Definition: ensure the provider has an on-disk definition for this agent
    //    so it runs as a named repository-defined agent.
    if ((await behavior.readDefinition(workspace.fs, name)) === null) {
      await behavior.writeDefinition(workspace.fs, { name, description });
      changed = true;
    }

    // 3. Row: populate definitionName so sessions launch as this named agent.
    if (agent.definitionName === null) {
      await updateAgent({ agentId: agent.id, definitionName: name });
      changed = true;
    }

    // 4. Backfill this agent's own pre-existing sessions: they froze no
    //    `agentName` (created before it had a definitionName), so the sidebar —
    //    which pairs a session to its agent by `agentName === definitionName` —
    //    would orphan them once definitionName is set. Idempotent, and run even
    //    when definitionName was already populated so installs that ran an
    //    earlier migration (before this backfill existed) are repaired too.
    const backfilled = await backfillSessionAgentName(agent.id, name);
    if (backfilled > 0) {
      log.info('migrateAgentStorage: backfilled session agentName for migrated agent', {
        agentId: agent.id,
        backfilled,
      });
      changed = true;
    }

    return { changed, complete: true };
  } finally {
    workspace.close();
  }
}

/** The agent's registered name + description on its Switch server, or null. */
async function fetchRegisteredName(
  agent: Agent
): Promise<{ name: string; description: string } | null> {
  if (!agent.serverId || !agent.switchAgentId) return null;
  const server = await getServer(agent.serverId);
  if (!server) return null;
  try {
    const detail = await fetchAgentDetail(server, agent.switchAgentId);
    return { name: detail.name, description: detail.description || detail.name };
  } catch (error) {
    log.warn('migrateAgentStorage: failed to fetch registered agent name', {
      agentId: agent.id,
      error: String(error),
    });
    return null;
  }
}

/** Build credentials from a launch-env map, or null when any value is missing. */
function toCreds(
  env: Record<string, string>
): { apiEndpoint: string; token: string; agentId: string } | null {
  const apiEndpoint = env.SWITCH_API_ENDPOINT;
  const token = env.SWITCH_API_TOKEN;
  const agentId = env.SWITCH_AGENT_ID;
  if (apiEndpoint && token && agentId) return { apiEndpoint, token, agentId };
  return null;
}
