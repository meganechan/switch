import { eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { agents } from '@main/db/schema';
import { agentRemoteConfig, type AgentRemoteConfig } from '@shared/core/agents/agent-connection';
import type { Agent } from '@shared/core/agents/agents';
import { mapAgentRowToAgent } from './utils';

/**
 * Set an agent to run locally or on a remote SSH host. Local clears any stored
 * remote config; remote requires a validated `{ sshHost, remoteRepoDir }`. This
 * only records the connection intent — remote setup/preflight (claude + plugin
 * install, writing the remote Switch creds, gateway reachability) runs
 * separately before a remote session is provisioned.
 */
export type SetAgentConnectionParams =
  | { agentId: string; connection: 'local' }
  | { agentId: string; connection: 'remote'; remoteConfig: AgentRemoteConfig };

export async function setAgentConnection(params: SetAgentConnectionParams): Promise<Agent> {
  if (params.connection === 'remote') {
    const parsed = agentRemoteConfig.schema.safeParse(params.remoteConfig);
    if (!parsed.success) {
      throw new Error(`Invalid remote agent config: ${parsed.error.message}`);
    }
  }

  const [row] = await db
    .update(agents)
    .set({
      connection: params.connection,
      remoteConfigJson: params.connection === 'remote' ? params.remoteConfig : null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(agents.id, params.agentId))
    .returning();

  if (!row) throw new Error(`No agent with id ${params.agentId}`);
  return mapAgentRowToAgent(row);
}
