import type { AgentRow } from '@main/db/schema';
import type { Agent } from '@shared/core/agents/agents';

export function mapAgentRowToAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    providerId: row.providerId,
    switchAgentId: row.switchAgentId ?? null,
    apiEndpoint: row.apiEndpoint ?? null,
    serverId: row.serverId ?? null,
    status: row.status ?? null,
    connection: row.connection,
    remoteConfig: row.remoteConfigJson ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
