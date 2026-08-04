/**
 * Turning a raw probe into an observation (CHOO-1809).
 *
 * Kept apart from the service that does the probing so the rules can be read
 * and tested on their own — the service reaches SSH, the database and the
 * dependency managers, and none of that is needed to say what a given
 * observation means.
 */

import type { DependencyCheckOutcome } from '@shared/core/remote-hosts/setup';
import type { GhAuthStatus } from '../gh-auth';
import type { StepCheckResult } from './host-setup-runner';

/**
 * Translate a probed dependency into an observation.
 *
 * The dependency manager collapses "installed but below minVersion" into
 * `status: 'error'` with a message; we recover the distinction here, because
 * "too old" is actionable (upgrade) in a way that "we could not tell" is not.
 * Anything else reporting `error` is genuinely undetermined and must surface as
 * `unknown` rather than being guessed at.
 */
export function outcomeForDependency(
  state: { status: string; version: string | null; error?: string },
  hasMinVersion: boolean
): { outcome: DependencyCheckOutcome; version: string | null; error?: string } {
  if (state.status === 'available') {
    return { outcome: 'satisfied', version: state.version };
  }
  if (state.status === 'missing') {
    return { outcome: 'missing', version: null };
  }
  if (hasMinVersion && state.version) {
    return { outcome: 'wrong-version', version: state.version, error: state.error };
  }
  return { outcome: 'unknown', version: state.version, error: state.error };
}

/**
 * Collapse a terminal transcript down to what a human would read.
 *
 * `apt-get` redraws a progress line with carriage returns hundreds of times;
 * captured verbatim that is a wall of `0% [Waiting for headers]` with the one
 * line that matters at the very bottom. Keep the last state of each redrawn
 * line rather than every frame of it.
 */
export function condenseCommandOutput(raw: string): string {
  return raw
    .split('\n')
    .map(
      (line) =>
        line
          .split('\r')
          .filter((frame) => frame.trim().length > 0)
          .pop() ?? ''
    )
    .filter((line) => line.trim().length > 0)
    .join('\n');
}

/** Package managers refusing because another one holds the lock. */
const PACKAGE_MANAGER_BUSY =
  /could not get lock|unable to acquire the dpkg frontend lock|waiting for cache lock|another process using it/i;

/** The pid apt names as the lock holder, when it names one. */
const LOCK_HOLDER_PID = /held by process (\d+)/i;

/**
 * Explain why an install failed, in terms the user can act on.
 *
 * The lock case is worth naming, because raw apt output does not explain it —
 * it says `E: Could not get lock`, buried under a screen of progress redraws.
 *
 * What it must *not* do is guess whose lock it is. An earlier version of this
 * message blamed the system's automatic updates and told the user to retry in a
 * few minutes. On a real host the holder turned out to be **our own** previous
 * install, stopped on a prompt it could never be given an answer to and holding
 * the lock indefinitely; retrying could not have worked, and that advice would
 * have been an infinite loop. So the message reports what apt actually said,
 * names the pid, and gives both plausible causes without picking one.
 */
export function describeInstallFailure(
  name: string,
  message: string,
  output: string | null
): string {
  if (PACKAGE_MANAGER_BUSY.test(message) || (output && PACKAGE_MANAGER_BUSY.test(output))) {
    const pid = LOCK_HOLDER_PID.exec(output ?? '')?.[1] ?? LOCK_HOLDER_PID.exec(message)?.[1];
    const holder = pid ? ` (pid ${pid})` : '';
    return `Could not install ${name}: another process${holder} on the host holds the package manager lock. That is usually the system's own automatic updates, which clear within a few minutes — but it can also be an earlier install left stuck, which will not clear on its own. If retrying keeps failing with the same pid, check that process on the host.`;
  }
  return message;
}

/**
 * Translate a probed GitHub login into an observation.
 *
 * Being logged in is not the same as being usable: without `read:packages`
 * every session this host starts fetches its MCP runtime from GitHub Packages
 * and gets a 403 several layers below anything that mentions `gh` (CHOO-1873).
 * Reporting that login as satisfied is the stale-green bug in another coat, so
 * the step stays outstanding and carries the reason.
 */
export function outcomeForGhAuth(status: GhAuthStatus): StepCheckResult {
  if (status.authenticated && status.canReadPackages) {
    return { outcome: 'satisfied', version: status.account };
  }
  return { outcome: 'missing', error: status.detail ?? undefined };
}
