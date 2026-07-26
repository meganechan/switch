import { eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { kv } from '@main/db/schema';

/**
 * Persisted marker recording that the CHOO-1440 agent-storage migration has
 * completed a full, error-free pass. Once set, {@link migrateAgentStorage}
 * short-circuits at boot instead of re-opening every agent's workspace
 * filesystem (an SSH/SFTP round trip per remote agent) on every launch.
 */
const MARKER_KEY = 'agentStorageMigrationComplete';

export async function isAgentStorageMigrationComplete(): Promise<boolean> {
  const [row] = await db.select().from(kv).where(eq(kv.key, MARKER_KEY)).limit(1);
  return row?.value === '1';
}

export async function markAgentStorageMigrationComplete(): Promise<void> {
  await db
    .insert(kv)
    .values({ key: MARKER_KEY, value: '1', updatedAt: sql`CURRENT_TIMESTAMP` })
    .onConflictDoUpdate({ target: kv.key, set: { value: '1', updatedAt: sql`CURRENT_TIMESTAMP` } });
}
