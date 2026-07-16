import type { TelemetryEnvelope } from '@shared/telemetry';

type TelemetryScope = Pick<TelemetryEnvelope, 'project_id' | 'session_id' | 'conversation_id'>;

const scope: TelemetryScope = {
  project_id: undefined,
  session_id: undefined,
  conversation_id: undefined,
};

export function setTelemetrySessionScope({
  projectId,
  sessionId,
}: {
  projectId: string;
  sessionId: string;
}): void {
  scope.project_id = projectId;
  scope.session_id = sessionId;
  scope.conversation_id = undefined;
}

export function clearTelemetrySessionScope(): void {
  scope.project_id = undefined;
  scope.session_id = undefined;
  scope.conversation_id = undefined;
}

export function setTelemetryConversationScope(conversationId: string | null): void {
  scope.conversation_id = conversationId ?? undefined;
}

export function getTelemetryScope(): TelemetryScope {
  return { ...scope };
}
