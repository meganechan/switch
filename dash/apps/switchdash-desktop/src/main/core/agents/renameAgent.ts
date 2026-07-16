import { eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { agents } from '@main/db/schema';
import type { Agent, RenameAgentParams } from '@shared/core/agents/agents';
import { mapAgentRowToAgent } from './utils';

export async function renameAgent(params: RenameAgentParams): Promise<Agent | undefined> {
  const [row] = await db
    .update(agents)
    .set({ name: params.newName, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(agents.id, params.agentId))
    .returning();
  if (!row) return undefined;
  return mapAgentRowToAgent(row);
}
