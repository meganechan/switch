import os from 'node:os';
import path from 'node:path';
import type { AgentDefaults } from '@shared/core/switch-servers/switch-servers';

/**
 * Slugify a string into the Switch agent-name charset: lowercase letters,
 * digits, `.`, `-`, `_`. Any other character becomes `-`; runs of `-` collapse
 * and leading/trailing `-` are stripped. Mirrors the `configure` skill's slug
 * rule so desktop-registered agents are named the same way.
 */
export function slugifyAgentNamePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Suggest a default name and description for a new Claude Code agent in `dir`.
 * The name is `claude-code.<repo-slug>.<user-slug>` — the per-user suffix keeps
 * two developers registering from the same repo from colliding (see the
 * `configure` skill). Falls back to a bare `claude-code` if both parts slug to
 * empty.
 */
export function suggestAgentDefaults(dir: string): AgentDefaults {
  const repoSlug = slugifyAgentNamePart(path.basename(dir));
  let userSlug = '';
  try {
    userSlug = slugifyAgentNamePart(os.userInfo().username);
  } catch {
    userSlug = '';
  }

  const parts = ['claude-code', repoSlug, userSlug].filter((p) => p.length > 0);
  const name = parts.length > 1 ? parts.join('.') : 'claude-code';
  const repoLabel = path.basename(dir) || 'this directory';
  return { name, description: `Claude Code running in ${repoLabel}` };
}
