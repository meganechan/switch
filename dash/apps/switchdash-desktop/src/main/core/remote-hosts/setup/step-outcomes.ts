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
