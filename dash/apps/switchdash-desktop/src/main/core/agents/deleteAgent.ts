import { eq } from 'drizzle-orm';
import {
  listAutoSessionSubagents,
  setAutoSessionAgent,
  setAutoSessionSubagent,
} from '@main/core/switch-rooms/auto-session-store';
import { autoSessionWatcher } from '@main/core/switch-rooms/auto-session-watcher';
import { db } from '@main/db/client';
import { agents } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { getAgentById } from './getAgentById';
import { stopRemoteWatcher } from './remote-watcher';

/**
 * Delete an agent and tear down its auto_session state first. The watcher caches
 * the agent's Switch credentials in memory, so without an explicit stop it keeps
 * posting watch heartbeats and polling the notification stream for an agent that
 * no longer exists. Stop the watcher(s) and clear the local mirror before removing
 * the row so a deleted agent goes quiet immediately and does not linger in the
 * mirror across a restart.
 */
export async function deleteAgent(agentId: string): Promise<void> {
  const agent = await getAgentById(agentId);

  if (agent?.connection === 'remote') {
    await stopRemoteWatcher(agentId).catch((error) => {
      log.warn('deleteAgent: failed to stop remote watcher', { agentId, error: String(error) });
    });
  } else {
    autoSessionWatcher.stopForAgent(agentId);
  }

  for (const { parentAgentId, name } of await listAutoSessionSubagents()) {
    if (parentAgentId !== agentId) continue;
    autoSessionWatcher.stopForSubagent(parentAgentId, name);
    await setAutoSessionSubagent(parentAgentId, name, false);
  }
  await setAutoSessionAgent(agentId, false);

  await db.delete(agents).where(eq(agents.id, agentId));
}
