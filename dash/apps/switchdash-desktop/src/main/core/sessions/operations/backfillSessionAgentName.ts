import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { sessions } from '@main/db/schema';

/**
 * Backfill `config.agentName` on an agent's own pre-existing sessions to match
 * its definitionName.
 *
 * `createSession` freezes a session's `agentName` from its agent's
 * `definitionName` at creation time, and the sidebar joins a session to its
 * agent by `agentName === definitionName`. Sessions created before the agent had
 * a definitionName froze no `agentName`, so once the CHOO-1440 migration
 * populates `definitionName` those sessions match no agent and vanish from the
 * tree (they still exist and open via deeplink). This restores the pairing.
 *
 * Idempotent: only sessions with no `agentName`/`subagentName` are touched, so
 * re-running is a no-op and sessions launched as a different definition (a former
 * subagent) are left alone. Returns the number of sessions updated.
 */
export async function backfillSessionAgentName(
  agentId: string,
  definitionName: string
): Promise<number> {
  const rows = await db.select().from(sessions).where(eq(sessions.agentId, agentId));
  let updated = 0;
  for (const row of rows) {
    const config = row.config ?? {};
    if (config.agentName || config.subagentName) continue;
    await db
      .update(sessions)
      .set({ config: { ...config, agentName: definitionName } })
      .where(eq(sessions.id, row.id));
    updated += 1;
  }
  return updated;
}
