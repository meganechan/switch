import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { sessions } from '@main/db/schema';
import { MAX_CONVERSATION_TITLE_LENGTH } from '@shared/core/conversations/conversations';
import { conversationEvents } from './conversation-events';
import { loadSessionWithAgent } from './session-join';

export async function renameConversation(conversationId: string, name: string) {
  const title = name.trim().slice(0, MAX_CONVERSATION_TITLE_LENGTH);

  const existing = await loadSessionWithAgent(conversationId);

  await db.update(sessions).set({ title }).where(eq(sessions.id, conversationId));

  if (existing) {
    conversationEvents._emit(
      'conversation:renamed',
      conversationId,
      existing.projectId,
      conversationId,
      title
    );
  }
}
