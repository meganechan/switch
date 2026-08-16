import { log } from '@main/lib/logger';
import { agentAvatarUrlForName } from '@shared/core/agents/agent-avatar';
import type { SwitchServer } from '@shared/core/switch-servers/switch-servers';
import { fetchAgents, fetchMe, updateAgentIcon } from './gateway-client';

/**
 * Give the signed-in user's existing agents the bot avatar their name generates
 * (CHOO-2171).
 *
 * Agents registered before icons existed have none, and the Switch server's own
 * fallback for those is the lettered avatar the bridges have always drawn. This
 * writes the bot in, so an agent this app manages looks the same in the app as
 * it does in Slack — and an agent belonging to an install that has not updated
 * keeps the letters, which is the intended way to tell the two apart.
 *
 * Only the user's own agents are touched, and only those with no icon at all: a
 * chosen icon is never overwritten, and someone else's agent is not ours to
 * change (the gateway would refuse anyway).
 */
export function backfillAgentIcons(server: SwitchServer): Promise<number> {
  const settled = completed.get(server.id);
  if (settled !== undefined) return Promise.resolve(settled);

  const running = inFlight.get(server.id);
  if (running) return running;

  const run = writeMissingIcons(server)
    .then((written) => {
      completed.set(server.id, written);
      return written;
    })
    .finally(() => inFlight.delete(server.id));

  inFlight.set(server.id, run);
  return run;
}

/** Servers already done this run, and how many icons each got. Kept so opening
 * the agents page repeatedly does not re-ask the gateway; a server that failed
 * is deliberately absent, so the next refresh tries again. */
const completed = new Map<string, number>();
const inFlight = new Map<string, Promise<number>>();

async function writeMissingIcons(server: SwitchServer): Promise<number> {
  const [me, agents] = await Promise.all([fetchMe(server), fetchAgents(server)]);
  const missing = agents.filter((agent) => agent.iconUrl === null && agent.ownerId === me.id);
  if (missing.length === 0) return 0;

  let written = 0;
  const failures: string[] = [];
  for (const agent of missing) {
    try {
      await updateAgentIcon(server, agent.id, agentAvatarUrlForName(agent.name));
      written += 1;
    } catch (cause) {
      // One agent refusing must not cost the rest theirs, so this collects
      // rather than throws — but it is reported below rather than dropped.
      failures.push(agent.name);
      log.debug('agent icon backfill: one agent failed', { agent: agent.name, cause });
    }
  }

  if (failures.length > 0) {
    log.warn('agent icon backfill: some agents kept the lettered avatar', {
      event: 'agent_icon_backfill',
      serverId: server.id,
      written,
      failed: failures.length,
      failedAgents: failures,
    });
  } else {
    log.info('agent icon backfill: done', {
      event: 'agent_icon_backfill',
      serverId: server.id,
      written,
    });
  }
  return written;
}
