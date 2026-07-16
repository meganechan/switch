import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import type { CreateAgentParams, RenameAgentParams } from '@shared/core/agents/agents';
import type { AgentVerifyResult } from '@shared/core/switch-servers/switch-servers';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { assignAgentServer } from './assignAgentServer';
import { createAgent } from './createAgent';
import { deleteAgent } from './deleteAgent';
import { getAgentById } from './getAgentById';
import { getAgents } from './getAgents';
import { ensureRemoteWatcher, startRemoteDiscovery } from './remote-watcher';
import { renameAgent } from './renameAgent';
import {
  getAgentAutoSession,
  setAgentAutoSession,
  type AgentAutoSessionParams,
} from './setAgentAutoSession';
import { setAgentConnection, type SetAgentConnectionParams } from './setAgentConnection';
import { setupRemoteAgent } from './setup-remote-agent';
import { updateAgent, type UpdateAgentParams } from './updateAgent';

export const agentsController = createRPCController({
  createAgent: (params: CreateAgentParams) => createAgent(params),
  getAgents: (projectId?: string) => getAgents(projectId),
  getAgentById: (agentId: string) => getAgentById(agentId),
  renameAgent: (params: RenameAgentParams) => renameAgent(params),
  deleteAgent: (agentId: string) => deleteAgent(agentId),
  updateAgent: (params: UpdateAgentParams) => updateAgent(params),
  assignServer: (params: { agentId: string; serverId: string }): Promise<AgentVerifyResult> =>
    assignAgentServer(params),
  setAgentAutoSession: (params: AgentAutoSessionParams): Promise<void> =>
    setAgentAutoSession(params),
  getAgentAutoSession: (params: { agentId: string }): Promise<boolean> =>
    getAgentAutoSession(params),
  setAgentConnection: (params: SetAgentConnectionParams) => setAgentConnection(params),

  /**
   * Copy a remote agent's Switch credentials onto its host (CHOO-1059, option A).
   * Run after configuring an agent remote and before its first remote session.
   * Resolves the agent's local project dir (where its minted creds live) and
   * ships them to the remote working dir over SFTP.
   */
  setupRemoteAgent: async (params: { agentId: string }): Promise<void> => {
    const agent = await getAgentById(params.agentId);
    if (!agent) throw new Error(`No agent with id ${params.agentId}`);
    if (agent.connection !== 'remote' || !agent.remoteConfig) {
      throw new Error(`Agent ${params.agentId} is not configured to run remotely`);
    }
    const [project] = await db
      .select({ path: projects.path })
      .from(projects)
      .where(eq(projects.id, agent.projectId))
      .limit(1);
    if (!project) {
      throw new Error(`No project ${agent.projectId} for agent ${params.agentId}`);
    }
    if (project.path === null) {
      throw new Error(
        `Agent ${params.agentId} has no local directory; its Switch credentials already live on the remote host, so there is nothing to copy.`
      );
    }
    await setupRemoteAgent({ remoteConfig: agent.remoteConfig, localDir: project.path });
    // Bring up (or reattach to) the on-VM notification-watcher daemon so the
    // agent auto-starts sessions while switchdash is closed. No-op unless
    // auto_session is enabled for the agent.
    await ensureRemoteWatcher(params.agentId);
    // Discover sessions this agent already has running elsewhere (another client
    // or the VM watcher), regardless of auto_session.
    await startRemoteDiscovery(params.agentId);
  },
});
