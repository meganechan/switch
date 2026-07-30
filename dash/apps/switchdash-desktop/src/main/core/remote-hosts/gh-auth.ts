/**
 * GitHub CLI authentication on a remote host.
 *
 * `gh` being on PATH is not enough to use it — it must also be logged in, and
 * that login is an interactive device flow. Extracted from the remote-hosts
 * controller so the setup runner (CHOO-1809) can probe auth as its own step
 * rather than as a side effect of a dependency sweep.
 */

import { isTransportFailure } from '@switchdash/core/exec';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { sshConnectionIdForHost } from '@main/core/locations/location-transport';
import { ensureSshConnected } from '@main/core/ssh/connect/connect-agent-ssh';

export type GhAuthStatus = { authenticated: boolean; account: string | null };

/** Matches the account line of `gh auth status` across gh versions ("account NAME" / "as NAME"). */
const GH_AUTH_ACCOUNT_RE = /Logged in to \S+ (?:account|as) (\S+)/;

/**
 * Whether `gh` is authenticated on a remote host. Exit 0 means authenticated; a
 * non-zero exit (which SshExecutionContext throws on) means not logged in. A
 * transport failure propagates rather than being read as "not logged in" — a
 * dead connection is not evidence about the login state.
 */
export async function probeGhAuthStatus(sshHost: string): Promise<GhAuthStatus> {
  const proxy = await ensureSshConnected(sshConnectionIdForHost(sshHost), sshHost);
  const ctx = new SshExecutionContext(proxy);
  try {
    const { stdout, stderr } = await ctx.exec('gh', ['auth', 'status']);
    const account = GH_AUTH_ACCOUNT_RE.exec(`${stdout}\n${stderr}`)?.[1] ?? null;
    return { authenticated: true, account };
  } catch (error) {
    if (isTransportFailure(error)) throw error;
    return { authenticated: false, account: null };
  }
}
