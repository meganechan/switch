import { eq, isNull } from 'drizzle-orm';
import { db } from '@main/db/client';
import { agents, sessions } from '@main/db/schema';
import { mapSessionRowToConversation } from './utils';

export async function getConversations() {
  const rows = await db
    .select({ session: sessions, projectId: agents.projectId, providerId: agents.providerId })
    .from(sessions)
    .innerJoin(agents, eq(sessions.agentId, agents.id))
    .where(isNull(sessions.archivedAt));
  return rows.map(({ session, projectId, providerId }) =>
    mapSessionRowToConversation(session, projectId, providerId, false)
  );
}
