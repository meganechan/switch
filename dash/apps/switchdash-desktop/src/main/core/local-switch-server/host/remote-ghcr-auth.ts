import type { IExecutionContext } from '@main/core/execution-context/types';
import { log } from '@main/lib/logger';
import { GHCR_REGISTRY } from '../constants';
import { getLocalGithubIdentity } from '../ghcr-auth';

/** The GitHub login of an authenticated `gh` on the remote host, or null when
 * `gh` is missing or not signed in (`gh api user` needs an auth token). */
async function remoteGhUsername(ctx: IExecutionContext): Promise<string | null> {
  try {
    const { stdout } = await ctx.exec('gh', ['api', 'user', '--jq', '.login'], { timeout: 15_000 });
    const login = stdout.trim();
    return login.length > 0 ? login : null;
  } catch {
    return null;
  }
}

/**
 * Authenticate a remote host's Docker to GHCR so private release images pull
 * before the public-repo flip (CHOO-1260) — CHOO-1432 decision #2:
 *
 * 1. If `gh` is authenticated on the host, log in with its own token, piped
 *    `gh auth token | docker login --password-stdin` entirely on the remote so
 *    the token never lands in argv.
 * 2. Otherwise forward the desktop's `gh` token: write it to a 0600 temp file on
 *    the host, `docker login --password-stdin < file`, then delete it.
 * 3. If neither is available, warn and proceed — a public image is then a no-op
 *    and a private one fails loudly on the subsequent pull.
 */
export async function ensureRemoteGhcrLogin(host: {
  ctx: IExecutionContext;
  writeFile: (relPath: string, content: string, mode?: number) => Promise<void>;
  label: string;
}): Promise<void> {
  const { ctx, label } = host;

  const remoteUser = await remoteGhUsername(ctx);
  if (remoteUser) {
    await ctx.exec('sh', [
      '-c',
      `gh auth token | docker login ${GHCR_REGISTRY} -u ${remoteUser} --password-stdin`,
    ]);
    log.info(`remote-switch-server: authenticated ${label} Docker to GHCR via its own gh login`);
    return;
  }

  const identity = await getLocalGithubIdentity();
  if (!identity) {
    log.warn(
      `remote-switch-server: no gh login on ${label} and no desktop gh token; skipping GHCR login (private image pulls will fail)`
    );
    return;
  }

  const tokenFile = '.ghcr-token';
  await host.writeFile(tokenFile, identity.token, 0o600);
  try {
    await ctx.exec('sh', [
      '-c',
      `docker login ${GHCR_REGISTRY} -u ${identity.username} --password-stdin < ${tokenFile}`,
    ]);
    log.info(`remote-switch-server: authenticated ${label} Docker to GHCR via forwarded token`);
  } finally {
    // Remove the token file whether or not the login succeeded.
    await ctx.exec('rm', ['-f', tokenFile]).catch(() => {});
  }
}
