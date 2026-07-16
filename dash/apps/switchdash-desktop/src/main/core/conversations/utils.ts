import { type SessionRow } from '@main/db/schema';
import { type Conversation } from '@shared/core/conversations/conversations';
import { type AgentProviderId } from '@shared/core/providers/agent-provider-registry';
import { type AgentStatus } from '@shared/core/providers/agentEvents';

/**
 * In switchdash a conversation IS a session (the old switchdash "conversation" was
 * renamed to "session"). `projectId` and `providerId` are denormalised from the
 * owning agent and must be supplied by the caller (which has joined `agents`).
 */
export function mapSessionRowToConversation(
  row: SessionRow,
  projectId: string,
  providerId: AgentProviderId,
  resume: boolean = false
): Conversation {
  const config = row.config ?? {};
  return {
    id: row.id,
    title: row.title,
    sessionId: row.id,
    projectId,
    providerId,
    autoApprove: config.autoApprove,
    providerSessionId: config.providerSessionId,
    subagentName: config.subagentName,
    resume: resume,
    lastInteractedAt: row.lastInteractedAt ?? null,
    isInitialConversation: row.isInitialSession,
    agentStatus: (row.agentStatus as AgentStatus | null) ?? null,
    agentStatusSeen: row.agentStatusSeen === 1,
  };
}
