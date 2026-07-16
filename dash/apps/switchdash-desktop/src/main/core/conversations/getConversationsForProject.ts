import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { agents, sessions } from '@main/db/schema';
import { mapSessionRowToConversation } from './utils';

export async function getConversationsForProject(projectId: string) {
  const rows = await db
    .select({ session: sessions, providerId: agents.providerId })
    .from(sessions)
    .innerJoin(agents, eq(sessions.agentId, agents.id))
    .where(eq(agents.projectId, projectId));
  return rows.map(({ session, providerId }) =>
    mapSessionRowToConversation(session, projectId, providerId, false)
  );
}
