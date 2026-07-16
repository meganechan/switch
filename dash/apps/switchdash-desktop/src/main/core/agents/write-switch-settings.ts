import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SWITCH_CONNECTOR_TOOL_RULES } from '@switchdash/core/agents/plugins';
import { SWITCH_SETTINGS_RELATIVE_PATH } from './switch-settings-paths';

export interface SwitchSettingsCredentials {
  apiEndpoint: string;
  apiToken: string;
  agentId: string;
}

/**
 * Merge the `SWITCH_*` env block (and the connector tool-allow rules) into the
 * contents of a `.claude/settings.local.json`, returning the new file text.
 *
 * The file is merged, not clobbered: any unrelated top-level keys and any other
 * `env` entries the user already has are preserved, and only the three
 * `SWITCH_*` keys are set/overwritten. The connector MCP tools are unioned into
 * `permissions.allow` so they are auto-approved ("don't ask").
 *
 * Pure: takes the existing file text (or null when absent/unreadable) and
 * returns the text to write. Shared by the local writer and the remote (SFTP)
 * writer so on-disk and over-SSH setup produce byte-identical files.
 */
export function mergeSwitchSettings(
  existingRaw: string | null,
  creds: SwitchSettingsCredentials
): string {
  let existing: Record<string, unknown> = {};
  if (existingRaw !== null) {
    try {
      const parsed: unknown = JSON.parse(existingRaw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      // Unparseable file: start fresh. A malformed file is rare and would be
      // replaced wholesale rather than half-merged.
    }
  }

  const currentEnv =
    existing.env && typeof existing.env === 'object' && !Array.isArray(existing.env)
      ? (existing.env as Record<string, unknown>)
      : {};

  const currentPerms =
    existing.permissions &&
    typeof existing.permissions === 'object' &&
    !Array.isArray(existing.permissions)
      ? (existing.permissions as Record<string, unknown>)
      : {};
  const currentAllow = Array.isArray(currentPerms.allow)
    ? (currentPerms.allow as unknown[]).map(String)
    : [];

  const merged = {
    ...existing,
    permissions: {
      ...currentPerms,
      allow: [...new Set([...currentAllow, ...SWITCH_CONNECTOR_TOOL_RULES])],
    },
    env: {
      ...currentEnv,
      SWITCH_API_ENDPOINT: creds.apiEndpoint,
      SWITCH_API_TOKEN: creds.apiToken,
      SWITCH_AGENT_ID: creds.agentId,
    },
  };

  return `${JSON.stringify(merged, null, 2)}\n`;
}

/**
 * Write the `SWITCH_*` env block into a local directory's
 * `.claude/settings.local.json`, the same file the switch-connector
 * `configure` skill writes.
 *
 * `apiToken` is the agent's secret API key — it is written here and nowhere
 * else, and must never be returned to the renderer or logged.
 */
export async function writeSwitchSettings(params: {
  dir: string;
  apiEndpoint: string;
  apiToken: string;
  agentId: string;
}): Promise<void> {
  const settingsPath = path.join(params.dir, SWITCH_SETTINGS_RELATIVE_PATH);

  let existingRaw: string | null = null;
  try {
    existingRaw = await fs.readFile(settingsPath, 'utf8');
  } catch (error) {
    // Start fresh only when the file is genuinely absent. Any other read
    // failure must propagate — merging into "nothing" would rewrite the file
    // without its hooks block.
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      throw error;
    }
  }

  const merged = mergeSwitchSettings(existingRaw, params);
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, merged, 'utf8');
}
