/**
 * The agent-creation readiness gate's decision (CHOO-1809).
 *
 * Split from the component so the rule can be tested without dragging in the
 * renderer's electron bridge — and because this rule is the whole point of the
 * gate, not an implementation detail of a notice.
 */

import type { HostStatus } from '@shared/core/remote-hosts/host-status';
import {
  outstandingRequiredHostSteps,
  outstandingRequiredStepsFor,
  type HostSetupPlan,
} from '@shared/core/remote-hosts/setup';

/**
 * Whether the block is the machine or just the agent type asked for.
 *
 * The two lead to different places: a host-level block stops every agent and is
 * fixed on the host page, while an agent-type block can also be sidestepped by
 * choosing a type the host already has.
 */
export type ReadinessScope = 'host' | 'agent-type';

export type HostReadiness = {
  /** True when we know the host is missing something the chosen agent needs. */
  blocked: boolean;
  /** True while a probe is in flight — not a verdict, just "ask again shortly". */
  checking: boolean;
  /** Required steps not yet satisfied. Empty unless `blocked`. */
  missing: string[];
  /** What the block is about. Null unless `blocked`. */
  scope: ReadinessScope | null;
};

const READY: HostReadiness = { blocked: false, checking: false, missing: [], scope: null };

/**
 * The gate's decision, as a pure function.
 *
 * `status` is the agent-type-aware verdict, so passing the status for the type
 * being created is what makes this gate answer "is this host ready for *this*
 * agent?" rather than "is it ready for every type it could ever run?" — the
 * question it used to ask, which let a missing Codex block creating a Claude
 * Code agent.
 *
 * `probing` withholds a verdict rather than being one: while we are looking, the
 * honest answer is "ask again shortly", not "no". And a host we could not
 * determine anything about is NOT blocked — refusing on ignorance is the same
 * mistake as the false green, inverted.
 */
export function resolveReadiness(
  status: HostStatus | null,
  plan: HostSetupPlan | null,
  agentId: string | null,
  probing: boolean
): HostReadiness {
  if (!status) return READY;
  if (probing) return { blocked: false, checking: true, missing: [], scope: null };
  if (status.kind !== 'setup-required') return READY;
  if (!plan) return { blocked: true, checking: false, missing: [], scope: 'host' };

  const hostOutstanding = outstandingRequiredHostSteps(plan);
  return {
    blocked: true,
    checking: false,
    missing: outstandingRequiredStepsFor(plan, agentId).map((step) => step.name),
    scope: hostOutstanding.length > 0 ? 'host' : 'agent-type',
  };
}
