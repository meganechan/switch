import { resolveSession } from '../projects/utils';

export async function dehydrateConversation(
  projectId: string,
  sessionId: string,
  conversationId: string
): Promise<void> {
  const session = resolveSession(projectId, sessionId);
  await session?.conversations.detachSession(conversationId);
}
