/**
 * The agent-creation readiness gate's decision (CHOO-1809).
 *
 * Split from the component so the rule can be tested without dragging in the
 * renderer's electron bridge — and because this rule is the whole point of the
 * gate, not an implementation detail of a notice.
 */

import type { HostStatus } from '@shared/core/remote-hosts/host-status';
import { outstandingRequiredSteps, type HostSetupPlan } from '@shared/core/remote-hosts/setup';

export type HostReadiness = {
  /** True when we know the host is missing something an agent needs. */
  blocked: boolean;
  /** True while a probe is in flight — not a verdict, just "ask again shortly". */
  checking: boolean;
  /** Required steps not yet satisfied. Empty unless `blocked`. */
  missing: string[];
};

const READY: HostReadiness = { blocked: false, checking: false, missing: [] };

/**
 * The gate's decision, as a pure function.
 *
 * `probing` withholds a verdict rather than being one: while we are looking, the
 * honest answer is "ask again shortly", not "no". And a host we could not
 * determine anything about is NOT blocked — refusing on ignorance is the same
 * mistake as the false green, inverted.
 */
export function resolveReadiness(
  status: HostStatus | null,
  plan: HostSetupPlan | null,
  probing: boolean
): HostReadiness {
  if (!status) return READY;
  if (probing) return { blocked: false, checking: true, missing: [] };
  if (status.kind !== 'setup-required') return READY;
  return {
    blocked: true,
    checking: false,
    missing: plan ? outstandingRequiredSteps(plan).map((step) => step.name) : [],
  };
}
