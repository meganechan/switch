import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { sessions } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { isDroidProviderSessionId } from '@shared/core/conversations/conversation-config';
import { conversationChangedChannel } from '@shared/core/conversations/conversationEvents';
import { loadSessionWithAgent } from './session-join';

export async function saveProviderSessionId(
  conversationId: string,
  providerSessionId: string
): Promise<void> {
  if (!isDroidProviderSessionId(providerSessionId)) {
    log.warn('saveProviderSessionId: ignored invalid Droid session id', {
      conversationId,
      providerSessionId,
    });
    return;
  }

  const loaded = await loadSessionWithAgent(conversationId);
  if (!loaded) return;

  const config = loaded.row.config ?? {};
  if (config.providerSessionId === providerSessionId) return;

  await db
    .update(sessions)
    .set({ config: { ...config, providerSessionId }, updatedAt: new Date().toISOString() })
    .where(eq(sessions.id, conversationId));

  events.emit(conversationChangedChannel, {
    conversationId,
    sessionId: conversationId,
    projectId: loaded.projectId,
    changes: { providerSessionId },
  });
}
