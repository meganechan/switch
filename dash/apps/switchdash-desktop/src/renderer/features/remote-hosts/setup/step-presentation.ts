/**
 * How a setup step is rendered (CHOO-1809).
 *
 * Kept as pure functions rather than inline JSX conditionals so the rules that
 * matter can be tested directly — above all: **nothing that was not observed to
 * be present is ever shown as done**. The previous page decided tone with
 * chained ternaries over booleans, which is how "we didn't check" came to look
 * identical to "we checked and it's fine".
 */

import type { StatusTone } from '@renderer/lib/ui/status-badge';
import type {
  DependencyCheckOutcome,
  HostSetupPlan,
  HostSetupStep,
} from '@shared/core/remote-hosts/setup';

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

/** Steps whose failure the user can act on directly, rather than only retrying. */
export function canSkip(step: HostSetupStep): boolean {
  return step.state === 'failed';
}

export type BadgeSpec = { tone: StatusTone; label: string };

/**
 * The pill shown on a step row.
 *
 * `satisfied` is the only state that earns green, and `pending` says "not
 * checked" rather than borrowing the language of a negative result — we have
 * not looked, which is not the same as having looked and found nothing.
 */
export function stepBadge(step: HostSetupStep): BadgeSpec {
  switch (step.state) {
    case 'satisfied':
      return { tone: 'success', label: 'Installed' };
    case 'checking':
      return { tone: 'info', label: 'Checking…' };
    case 'installing':
      return { tone: 'info', label: 'Installing…' };
    case 'failed':
      return { tone: 'danger', label: outcomeLabel(step.outcome) };
    case 'skipped':
      return { tone: 'neutral', label: 'Skipped' };
    case 'blocked':
      return { tone: 'neutral', label: 'Waiting' };
    case 'pending':
      // A re-check leaves steps pending but records what it saw. "Not checked"
      // and "checked, and it isn't there" are different facts and must not
      // share a label.
      return step.outcome === null
        ? { tone: 'neutral', label: 'Not checked' }
        : { tone: 'warning', label: outcomeLabel(step.outcome) };
  }
}

/**
 * An agent type as one row: its CLI and its Switch connector are two steps, but
 * a user thinks of them as one thing being usable or not. Mirrors how the
 * agents settings page presents a local agent.
 */
export type AgentTypeRow = {
  agentId: string;
  name: string;
  cli: HostSetupStep;
  /** Null only if the plan predates connector steps. */
  plugin: HostSetupStep | null;
};

/**
 * Combined status for an agent type.
 *
 * An installed CLI is not usable on its own — without the Switch connector the
 * agent starts and has no Switch tools. That intermediate state gets its own
 * label rather than being rounded up to "installed".
 */
export function agentTypeBadge(row: AgentTypeRow): BadgeSpec {
  const inFlight = [row.cli, row.plugin].find(
    (step) => step?.state === 'checking' || step?.state === 'installing'
  );
  if (inFlight) return stepBadge(inFlight);

  const failed = [row.cli, row.plugin].find((step) => step?.state === 'failed');
  if (failed) return { tone: 'danger', label: outcomeLabel(failed.outcome) };

  if (row.cli.state !== 'satisfied') return stepBadge(row.cli);
  if (row.plugin && row.plugin.state !== 'satisfied') {
    return { tone: 'warning', label: 'Switch setup required' };
  }
  return { tone: 'success', label: 'Installed' };
}

export type GroupedPlan = {
  /** Host tools and the GitHub login — everything an agent needs before itself. */
  prerequisites: HostSetupStep[];
  agentTypes: AgentTypeRow[];
};

/** Split a plan into the two things a host page is actually about. */
export function groupPlanSteps(plan: HostSetupPlan | null): GroupedPlan {
  if (!plan) return { prerequisites: [], agentTypes: [] };

  const prerequisites = plan.steps.filter(
    (step) => step.kind === 'core-dependency' || step.kind === 'gh-auth'
  );

  const agentTypes = plan.steps
    .filter((step) => step.kind === 'agent-cli')
    .map((cli) => ({
      agentId: cli.id,
      name: cli.name,
      cli,
      plugin:
        plan.steps.find((s) => s.kind === 'agent-plugin' && s.id === `${cli.id}:plugin`) ?? null,
    }));

  return { prerequisites, agentTypes };
}
