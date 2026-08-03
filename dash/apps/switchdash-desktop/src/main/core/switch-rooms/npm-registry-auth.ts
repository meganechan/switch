import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { getGithubTokenFromGhCli } from '@main/core/updates/github-token';
import { log } from '@main/lib/logger';

/**
 * Let a spawned session's `npx` resolve the Switch agent runtime.
 *
 * The Claude Code plugin runs its MCP server with
 * `npx @sandbox-quantum/switch-agent-runtime`. That package lives on GitHub
 * Packages and is private, so npm needs two things it does not have by default:
 * which registry serves the `@sandbox-quantum` scope, and a token for it.
 *
 * Both go in an `.npmrc`. Ours, not the user's — see below.
 *
 * A note on the failure this prevents: a private package you are not
 * authorised for returns **404, not 403**, because registries do not admit
 * that private packages exist. So a missing token is indistinguishable from a
 * missing package unless you already know to suspect auth.
 */

/** The registry serving our scope. */
const REGISTRY = 'npm.pkg.github.com';
const SCOPE = '@sandbox-quantum';

/**
 * The token is referenced, never written.
 *
 * npm expands `${VAR}` in `.npmrc` when it reads the file, so this holds a
 * pointer to an environment variable rather than a credential. The value is
 * put into the session's environment at spawn and lives only in that process.
 * Nothing secret reaches disk, so there is nothing to rotate or leak.
 */
const NPMRC_CONTENTS = [
  `${SCOPE}:registry=https://${REGISTRY}`,
  `//${REGISTRY}/:_authToken=\${SWITCHDASH_GITHUB_TOKEN}`,
  '',
].join('\n');

function npmrcPath(): string {
  return join(app.getPath('userData'), 'npm', 'npmrc');
}

/**
 * Write our `.npmrc` and return the environment that points npm at it.
 *
 * Deliberately not `~/.npmrc` and not a file in the user's project. The first
 * is their configuration, not ours, and editing it to make our plugin work is
 * a reach; the second shows up in their git status. `npm_config_userconfig`
 * makes npm read ours instead, so the footprint is confined to switchdash's
 * own directory.
 *
 * Returns an empty environment when `gh` has no token — the caller should let
 * the session start anyway. A session with no MCP server is worse than a
 * session whose agent cannot reach Switch, and `gh auth status` at host setup
 * is where this is supposed to be caught.
 */
export async function npmRegistryAuthEnv(): Promise<Record<string, string>> {
  const token = await getGithubTokenFromGhCli();
  if (!token) {
    log.warn('npmRegistryAuth: no GitHub token from `gh` — the agent runtime will not resolve', {
      event: 'npm_registry_auth_missing_token',
      hint: 'run `gh auth login`; a private package reads as 404 without it',
    });
    return {};
  }

  const path = npmrcPath();
  try {
    await mkdir(join(app.getPath('userData'), 'npm'), { recursive: true });
    // 0600: it carries no secret today, but it is npm auth configuration and
    // should not be world-readable if that ever changes.
    await writeFile(path, NPMRC_CONTENTS, { mode: 0o600 });
  } catch (error) {
    log.warn('npmRegistryAuth: could not write npmrc', {
      event: 'npm_registry_auth_write_failed',
      path,
      error: String(error),
    });
    return {};
  }

  return {
    npm_config_userconfig: path,
    SWITCHDASH_GITHUB_TOKEN: token,
  };
}
