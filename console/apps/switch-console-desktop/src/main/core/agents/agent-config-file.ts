import type { PluginFs } from '@switch-console/core/agents/plugins';
import { agentConfigRelativePath } from './switch-settings-paths';

/**
 * An agent's committed, secret-free config file (CHOO-2228).
 *
 * The file that already exists per agent — `.switch/agents/<slug>.json` —
 * carries the agent's API token and is gitignored for that reason, so it can
 * never be the home for settings meant to travel. This is its counterpart: no
 * credentials, checked in alongside the code the agent works on, so a second
 * machine opening the same working directory sees the same agent.
 *
 * **Sparse by construction.** Only values someone actually set are written. A
 * key that is absent means "not specified", which is not the same as an empty
 * value — it leaves the provider's own default in force. Writing defaults out
 * explicitly would freeze today's defaults into every user's repository and
 * make a later change to them invisible.
 *
 * Only `instructions` is modelled today. The per-provider advanced settings
 * still live in Switch Console's database; the shape leaves room for them to
 * move here without a second format change.
 */
export type AgentConfigFile = {
  /** The agent's provider-agnostic system prompt. Absent when none is set. */
  instructions?: string;
};

/**
 * Parse an agent config file's text.
 *
 * A file that is unreadable JSON, or holds something other than an object, is
 * reported as such rather than silently treated as empty: the alternative is a
 * read-modify-write that quietly discards whatever the user had, and an agent
 * launching with no instructions when it should have had some.
 */
export function parseAgentConfigFile(raw: string): AgentConfigFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`Agent config file is not valid JSON`, { cause });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Agent config file must contain a JSON object`);
  }

  const record = parsed as Record<string, unknown>;
  const config: AgentConfigFile = {};
  if (typeof record.instructions === 'string') config.instructions = record.instructions;
  return config;
}

/**
 * Serialise a config file, dropping anything unset.
 *
 * `unknownKeys` are keys read from an existing file that this version does not
 * model; they are written back untouched so a newer Switch Console's settings
 * survive an older one editing the same repository.
 */
export function serialiseAgentConfigFile(
  config: AgentConfigFile,
  unknownKeys: Record<string, unknown> = {}
): string {
  const out: Record<string, unknown> = { ...unknownKeys };
  delete out.instructions;

  // Blank is how the owner says "none", and none is the absent state — the
  // value itself is written exactly as given, never trimmed, because trimming
  // would quietly reshape a system prompt whose whitespace is deliberate.
  if (config.instructions !== undefined && config.instructions !== '') {
    out.instructions = config.instructions;
  }

  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * Read an agent's config file, or null when it has none.
 *
 * A missing file is the ordinary state for an agent nobody has configured, so
 * it reads as null. Anything else — a malformed file, an unreadable one —
 * throws, because continuing would mean launching the agent without
 * instructions its owner believes it has.
 */
export async function readAgentConfigFile(
  fs: PluginFs,
  slug: string
): Promise<AgentConfigFile | null> {
  const raw = await fs.read(agentConfigRelativePath(slug));
  if (raw === null) return null;
  return parseAgentConfigFile(raw);
}

/**
 * Write an agent's config file, preserving keys this version does not model.
 *
 * Read-modify-write rather than clobber: the file is checked in and may have
 * been written by a different version of the app.
 */
export async function writeAgentConfigFile(
  fs: PluginFs,
  slug: string,
  config: AgentConfigFile
): Promise<void> {
  const relativePath = agentConfigRelativePath(slug);
  const existingRaw = await fs.read(relativePath);

  let unknownKeys: Record<string, unknown> = {};
  if (existingRaw !== null) {
    const parsed: unknown = JSON.parse(existingRaw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      unknownKeys = parsed as Record<string, unknown>;
    }
  }

  await fs.write(relativePath, serialiseAgentConfigFile(config, unknownKeys));
}
