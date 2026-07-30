/**
 * How a setup step is rendered (CHOO-1809).
 *
 * Kept as pure functions rather than inline JSX conditionals so the rules that
 * matter can be tested directly — above all: **nothing that was not observed to
 * be present is ever shown as done**. The previous page decided tone with
 * chained ternaries over booleans, which is how "we didn't check" came to look
 * identical to "we checked and it's fine".
 */

import type {
  DependencyCheckOutcome,
  HostSetupPlan,
  HostSetupStep,
} from '@shared/core/remote-hosts/setup';

/** Visual tone for a step row. `done` is green and is deliberately hard to earn. */
export type StepTone = 'done' | 'busy' | 'failed' | 'skipped' | 'waiting' | 'idle';

export function stepTone(step: HostSetupStep): StepTone {
  switch (step.state) {
    case 'satisfied':
      return 'done';
    case 'checking':
    case 'installing':
      return 'busy';
    case 'failed':
      return 'failed';
    case 'skipped':
      return 'skipped';
    case 'blocked':
      return 'waiting';
    case 'pending':
      return 'idle';
  }
}

/** Short status label for a step row. */
export function stepStatusLabel(step: HostSetupStep): string {
  switch (step.state) {
    case 'pending':
      return 'Not checked yet';
    case 'checking':
      return 'Checking…';
    case 'installing':
      return 'Installing…';
    case 'satisfied':
      return step.version ? `Ready · ${step.version}` : 'Ready';
    case 'failed':
      return outcomeLabel(step.outcome);
    case 'skipped':
      return 'Skipped';
    case 'blocked':
      return 'Waiting on an earlier step';
  }
}

/**
 * What a check observed, in words. `unknown` says so plainly rather than
 * borrowing the language of a definite answer.
 */
export function outcomeLabel(outcome: DependencyCheckOutcome | null): string {
  switch (outcome) {
    case 'satisfied':
      return 'Ready';
    case 'missing':
      return 'Not installed';
    case 'not-running':
      return 'Installed but not running';
    case 'wrong-version':
      return 'Installed but too old';
    case 'unknown':
      return 'Could not be checked';
    case null:
      return 'Not checked yet';
  }
}

/**
 * Whether a step may show a "done" affordance. Only a fresh `satisfied`
 * observation qualifies — a skipped step is explicitly not done, and neither is
 * one we failed to verify.
 */
export function showsAsComplete(step: HostSetupStep): boolean {
  return step.state === 'satisfied';
}

/** Steps whose failure the user can act on directly, rather than only retrying. */
export function canSkip(step: HostSetupStep): boolean {
  return step.state === 'failed';
}

export type PlanSummary = {
  /** Steps satisfied out of the required total. */
  done: number;
  total: number;
  /** True only when every required step is satisfied. */
  ready: boolean;
  /** One-line description of where the host stands. */
  headline: string;
  tone: 'ready' | 'blocked' | 'in-progress' | 'unstarted';
};

/**
 * Summarise a plan for the host list. Deliberately conservative: a host is only
 * described as ready when every required step is satisfied, and skipped or
 * unverifiable steps hold it back rather than rounding up.
 */
export function summarisePlan(plan: HostSetupPlan | null): PlanSummary {
  if (!plan || plan.steps.length === 0) {
    return { done: 0, total: 0, ready: false, headline: 'Setup not started', tone: 'unstarted' };
  }

  const required = plan.steps.filter((step) => !step.optional);
  const done = required.filter((step) => step.state === 'satisfied').length;
  const total = required.length;
  const ready = done === total;

  if (ready) {
    return { done, total, ready, headline: 'Ready', tone: 'ready' };
  }

  const failed = plan.steps.find((step) => step.state === 'failed' && !step.optional);
  if (failed) {
    return {
      done,
      total,
      ready,
      headline: `Stopped at ${failed.name}`,
      tone: 'blocked',
    };
  }

  if (plan.status === 'running') {
    const current = plan.steps.find((step) => step.id === plan.currentStepId);
    return {
      done,
      total,
      ready,
      headline: current ? `Setting up ${current.name}…` : 'Setting up…',
      tone: 'in-progress',
    };
  }

  if (done === 0) {
    return { done, total, ready, headline: 'Setup not started', tone: 'unstarted' };
  }

  return { done, total, ready, headline: `${done} of ${total} steps done`, tone: 'in-progress' };
}
