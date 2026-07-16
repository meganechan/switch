import { loadSessionWithAgent } from './session-join';
import { mapSessionRowToConversation } from './utils';

export async function getConversationsForSession(_projectId: string, sessionId: string) {
  const loaded = await loadSessionWithAgent(sessionId);
  if (!loaded) return [];
  return [mapSessionRowToConversation(loaded.row, loaded.projectId, loaded.providerId, false)];
}
