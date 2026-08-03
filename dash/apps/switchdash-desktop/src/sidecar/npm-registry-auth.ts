import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { WatcherLogger } from './notification-watcher';

const execFileAsync = promisify(execFile);

/**
 * Registry access for sessions this sidecar starts on the VM.
 *
 * The Claude Code plugin fetches its MCP server with
 * `npx @sandbox-quantum/switch-agent-runtime`. That package is on GitHub
 * Packages and private, so npm needs to be told which registry serves the
 * scope and how to authenticate. Told neither, it asks npmjs.com, which has
 * never heard of it — the failure reads as a plain 404 for a package that does
 * not exist, rather than anything about registries or credentials.
 *
 * This is the VM-side counterpart of switchdash's `npmRegistryAuthEnv`. Same
 * two settings, same env-var indirection so no token is written to disk; the
 * only difference is that the token comes from the VM's own `gh`, which is a
 * core host dependency, rather than the desktop's.
 */

const REGISTRY = 'npm.pkg.github.com';
const SCOPE = '@sandbox-quantum';

const NPMRC_CONTENTS = [
  `${SCOPE}:registry=https://${REGISTRY}`,
  `//${REGISTRY}/:_authToken=\${SWITCHDASH_GITHUB_TOKEN}`,
  '',
].join('\n');

async function ghToken(log: WatcherLogger): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 10_000 });
    const token = stdout.trim();
    return token.length > 0 ? token : null;
  } catch (error) {
    log.warn('npmRegistryAuth: `gh auth token` failed on this host', {
      event: 'npm_registry_auth_no_gh',
      error: String(error),
    });
    return null;
  }
}

/**
 * Write the npmrc and return the environment that points npm at it.
 *
 * Returns an empty environment when the host has no usable `gh`. The session
 * still starts: it will fail to fetch the runtime and come up without tools,
 * which is bad, but strictly better than not starting at all — and the warning
 * here names the cause, which a bare npm 404 would not.
 */
export async function npmRegistryAuthEnv(
  repoDir: string,
  log: WatcherLogger
): Promise<Record<string, string>> {
  const token = await ghToken(log);
  if (!token) {
    log.warn('npmRegistryAuth: no GitHub token — the agent runtime will not resolve', {
      event: 'npm_registry_auth_missing_token',
      hint: 'run `gh auth login` on this host; the package is private and reads as 404 without it',
    });
    return {};
  }

  const dir = path.join(repoDir, '.switchdash');
  const npmrc = path.join(dir, 'npmrc');
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(npmrc, NPMRC_CONTENTS, { mode: 0o600 });
  } catch (error) {
    log.warn('npmRegistryAuth: could not write npmrc', {
      event: 'npm_registry_auth_write_failed',
      path: npmrc,
      error: String(error),
    });
    return {};
  }

  log.info('npmRegistryAuth: registry access configured for spawned sessions', {
    event: 'npm_registry_auth_ready',
    npmrc,
  });
  return {
    npm_config_userconfig: npmrc,
    SWITCHDASH_GITHUB_TOKEN: token,
  };
}
