import { getPlugin } from '@main/core/providers/plugin-registry';
import { deleteAgent } from '@main/core/switch-servers/gateway-client';
import { getServer } from '@main/core/switch-servers/servers-store';
import { resolveSubagentWorkspace } from './resolve-workspace';

export type DeleteSubagentParams = {
  /** The parent agent the subagent belongs to. */
  parentAgentId: string;
  name: string;
  /** The subagent's own Switch agent id, when known, so its child identity can
   * be deregistered on the gateway. Null skips the gateway delete (local-only
   * drift). */
  switchAgentId: string | null;
};

/**
 * Remove a subagent: deregister its child identity on the gateway (when known),
 * then delete its on-disk definition and credentials from the parent's working
 * directory (local or remote). The gateway delete runs first so a failure there
 * surfaces before the local files are removed.
 */
export async function deleteSubagent(params: DeleteSubagentParams): Promise<void> {
  const workspace = await resolveSubagentWorkspace(params.parentAgentId);
  try {
    const behavior = getPlugin(workspace.agent.providerId).behavior.subagents;
    if (!behavior) {
      throw new Error(`Provider ${workspace.agent.providerId} does not support subagents.`);
    }

    if (params.switchAgentId) {
      if (!workspace.agent.serverId) {
        throw new Error(`Agent ${params.parentAgentId} is not linked to a Switch server.`);
      }
      const server = await getServer(workspace.agent.serverId);
      if (!server) throw new Error(`No Switch server with id ${workspace.agent.serverId}`);
      await deleteAgent(server, params.switchAgentId);
    }

    await behavior.removeLocal(workspace.fs, params.name);
  } finally {
    workspace.close();
  }
}
