import type { PluginFs } from '@switchdash/core/agents/plugins';
import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { agents } from '@main/db/schema';
import { log } from '@main/lib/logger';
import type { Agent } from '@shared/core/agents/agents';
import type { AgentApiUrlPropagation } from '@shared/core/switch-servers/switch-servers';
import { getAgentLocation } from './agent-location';
import { resolveWorkspaceFsFor } from './agent-workspace-fs';
import { agentSettingsRelativePath, SWITCH_SETTINGS_RELATIVE_PATH } from './switch-settings-paths';
import { updateAgent } from './updateAgent';
import { mapAgentRowToAgent } from './utils';
import { mergeSwitchApiEndpoint } from './write-switch-settings';

/**
 * Every file that may hold this agent's `SWITCH_API_ENDPOINT`, in the same order
 * the session preflight reads them: the per-agent credentials keyed by name,
 * the earlier id-keyed variant of that file, and last the legacy shared
 * settings file.
 *
 * All of them are rewritten, not just the first found. An agent can have more
 * than one on disk — a migrated agent keeps its legacy file, which Claude Code
 * still reads natively — and leaving any of them naming the old server is how
 * an agent ends up authenticating against an endpoint nobody configured.
 */
function credentialPathsFor(agent: Agent): string[] {
  return [
    ...new Set([
      agentSettingsRelativePath(agent.name ?? agent.id),
      agentSettingsRelativePath(agent.id),
    ]),
    SWITCH_SETTINGS_RELATIVE_PATH,
  ];
}

/**
 * Rewrite `SWITCH_API_ENDPOINT` in each of the agent's credentials files that
 * exists, preserving its token and every other key. Returns whether anything
 * was updated (false = no provisioned credentials anywhere, so nothing to do).
 *
 * Local and remote share this path: `resolveWorkspaceFsFor` hands back a
 * filesystem rooted at the working directory either way, and both map an absent
 * file to null while letting a real read failure propagate — so a dead SSH
 * connection is never mistaken for an unprovisioned agent.
 */
async function propagateToWorkspace(
  fs: PluginFs,
  agent: Agent,
  apiEndpoint: string
): Promise<boolean> {
  let updated = false;
  for (const relPath of credentialPathsFor(agent)) {
    const merged = mergeSwitchApiEndpoint(await fs.read(relPath), apiEndpoint);
    if (merged === null) continue;
    await fs.write(relPath, merged);
    updated = true;
  }
  return updated;
}

/** Cascade a server API-URL edit to a single member agent, mapping any failure
 * to a `failed` outcome so one bad agent never aborts the rest. */
async function propagateToAgent(
  agent: Agent,
  apiEndpoint: string
): Promise<AgentApiUrlPropagation> {
  try {
    const location = await getAgentLocation(agent);
    const isRemote = location.sshHost !== null;
    const workspace = await resolveWorkspaceFsFor(location.sshHost, location.dir);
    let updated: boolean;
    try {
      updated = await propagateToWorkspace(workspace.fs, agent, apiEndpoint);
    } finally {
      workspace.close();
    }

    if (updated) {
      // Keep the DB mirror in step with what is now on disk.
      await updateAgent({ agentId: agent.id, apiEndpoint });
    }
    return {
      agentId: agent.id,
      agentName: agent.name,
      location: isRemote ? 'remote' : 'local',
      outcome: updated ? 'updated' : 'not-provisioned',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('switch-agents: failed to propagate server API URL to agent', {
      agentId: agent.id,
      error: message,
    });
    return {
      agentId: agent.id,
      agentName: agent.name,
      // Location lookup itself may have thrown; report best-effort.
      location: 'local',
      outcome: 'failed',
      error: message,
    };
  }
}

/**
 * Cascade a server's new API URL to every agent linked to it, rewriting each
 * agent's on-disk `SWITCH_API_ENDPOINT` (local dir or remote SSH host) and the
 * DB mirror. Agents keep their token; unprovisioned agents are skipped, not
 * clobbered. Returns a per-agent summary — failures are reported, never
 * swallowed — so the caller can surface which agents changed and which need a
 * running session restarted to pick up the new endpoint.
 *
 * This used to write only the legacy shared `.claude/settings.local.json`,
 * which no agent created since CHOO-1440 has: every one of them was reported
 * `not-provisioned` and silently kept the old endpoint. It now rewrites the
 * per-agent credentials file that is actually authoritative, and any legacy
 * file alongside it.
 */
export async function propagateServerApiUrl(
  serverId: string,
  apiEndpoint: string
): Promise<AgentApiUrlPropagation[]> {
  const rows = await db.select().from(agents).where(eq(agents.serverId, serverId));
  const results: AgentApiUrlPropagation[] = [];
  for (const row of rows) {
    results.push(await propagateToAgent(mapAgentRowToAgent(row), apiEndpoint));
  }
  return results;
}
