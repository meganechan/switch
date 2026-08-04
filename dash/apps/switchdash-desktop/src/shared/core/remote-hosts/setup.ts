/**
 * Model of a remote host's setup run (CHOO-1809).
 *
 * Onboarding a host used to be a single boolean — a row existed, or it didn't —
 * with every prerequisite probed independently by whichever component happened
 * to render. There was no notion of *where a host got to*, so nothing could be
 * resumed, nothing could be ordered, and a failure halfway through left no
 * record beyond whatever the UI happened to be holding in memory.
 *
 * A setup plan is that missing object: an ordered list of steps, persisted per
 * host. It is the single answer to "what still needs to happen on this host,
 * and what went wrong last time we tried?".
 *
 * Nothing advances the plan on its own. Each step is installed when the user
 * asks for that step — there is no run-everything button, deliberately: the
 * ordering is guidance, not automation.
 */

import { defineEvent } from '@shared/lib/ipc/events';

/**
 * What a check actually observed. Deliberately richer than a boolean, because
 * the interesting failures are not "missing" (CHOO-1803):
 *
 * - `satisfied` — present, correct version, and usable.
 * - `missing` — not installed.
 * - `not-running` — installed but the daemon/service is not up (Docker being
 *   the motivating case: `docker` on PATH tells you nothing about dockerd).
 * - `wrong-version` — installed but below the minimum we require.
 * - `unknown` — **we could not determine this.** A first-class answer, never
 *   collapsed into satisfied. Reporting "fine" for something we failed to
 *   observe is the stale-green bug from CHOO-1780.
 */
export type DependencyCheckOutcome =
  | 'satisfied'
  | 'missing'
  | 'not-running'
  | 'wrong-version'
  | 'unknown';

/** Outcomes that mean the step's requirement is genuinely met. */
export function isSatisfiedOutcome(outcome: DependencyCheckOutcome | null): boolean {
  return outcome === 'satisfied';
}

/**
 * Whether an outcome is something installing could plausibly fix. `not-running`
 * is excluded on purpose — starting a daemon is not installing a package, and
 * silently running an installer over a stopped service would misreport the
 * cause.
 */
export function isInstallableOutcome(outcome: DependencyCheckOutcome | null): boolean {
  return outcome === 'missing' || outcome === 'wrong-version';
}

/**
 * Where a step sits in its own lifecycle. Each step owns its state — the whole
 * point of the rewrite is that step 3 failing says nothing about steps 1-2.
 *
 * - `pending` — not reached yet.
 * - `checking` — a probe is in flight.
 * - `installing` — an install is in flight.
 * - `satisfied` — verified present after the last observation.
 * - `failed` — the check or install failed; carries `error` (and `output` when
 *   a command produced any). The run halts here.
 * - `skipped` — the user chose to move past it. Never rendered as satisfied.
 */
export type HostSetupStepState =
  | 'pending'
  | 'checking'
  | 'installing'
  | 'satisfied'
  | 'failed'
  | 'skipped';

/** What kind of thing a step manages, for rendering and for install routing. */
export type HostSetupStepKind = 'core-dependency' | 'agent-cli' | 'agent-plugin' | 'gh-auth';

export type HostSetupStep = {
  /** Stable within a plan. Dependency id for deps; `<agentId>:plugin` for plugins. */
  id: string;
  kind: HostSetupStepKind;
  /** Display name, resolved when the plan is built. */
  name: string;
  state: HostSetupStepState;
  /** The last thing we actually observed. Null until first checked. */
  outcome: DependencyCheckOutcome | null;
  /** Detected version, when the probe found one. */
  version: string | null;
  /** Why this step failed. Null unless `state === 'failed'`. */
  error: string | null;
  /** Raw command output from a failed install — the detail users need. */
  output: string | null;
  /**
   * An optional step does not block the run or the host's usability. `gh` is
   * the motivating case: it needs an interactive device-flow login that a user
   * may reasonably defer without the host being unusable.
   */
  optional: boolean;
  /** Steps that must be satisfied before this one is attempted. */
  dependsOn: string[];
  /** ISO timestamp of the last state change. */
  updatedAt: string;
};

/**
 * Plan-level status.
 *
 * - `idle` — something required is still outstanding.
 * - `complete` — every required step is satisfied or skipped.
 *
 * Deliberately not a lifecycle: with no automated run there is nothing to be
 * "running" or "halted". Work in flight lives on the individual step.
 */
export type HostSetupPlanStatus = 'idle' | 'complete';

export type HostSetupPlan = {
  sshHost: string;
  status: HostSetupPlanStatus;
  steps: HostSetupStep[];
  /** The step currently in flight, or the one that halted the run. */
  currentStepId: string | null;
  createdAt: string;
  updatedAt: string;
};

/** True while any step is being checked or installed. */
export function isPlanBusy(plan: HostSetupPlan): boolean {
  return plan.steps.some((step) => step.state === 'checking' || step.state === 'installing');
}

/** The step currently being worked on, if any. */
export function inFlightStep(plan: HostSetupPlan): HostSetupStep | null {
  return (
    plan.steps.find((step) => step.state === 'checking' || step.state === 'installing') ?? null
  );
}

/** Required steps that are not yet satisfied — what stands between here and done. */
export function outstandingRequiredSteps(plan: HostSetupPlan): HostSetupStep[] {
  return plan.steps.filter((step) => !step.optional && step.state !== 'satisfied');
}

/**
 * Whether the host is usable for running agents. Optional steps and skipped
 * steps do not count against it; a step we could not verify does.
 */
export function isPlanComplete(plan: HostSetupPlan): boolean {
  return outstandingRequiredSteps(plan).length === 0;
}

/** Pushed to the renderer on every plan transition, so the UI never polls. */
export const hostSetupPlanEventChannel = defineEvent<HostSetupPlan>('remote-hosts:setup-changed');

/**
 * What a step is doing right now, in the running command's own words.
 *
 * A remote install can take minutes — fetching packages, unpacking, running
 * post-install hooks — and a spinner labelled "Installing…" for all of it is
 * indistinguishable from a hang. This carries the line the host is currently
 * printing so the user can see it is moving, and roughly on what.
 *
 * Deliberately not part of the plan: it is a live view of work in progress, not
 * a fact about the host. It is never persisted, and `line: null` means the work
 * has finished — whatever it concluded is then in the step itself.
 */
export type HostSetupActivity = {
  sshHost: string;
  stepId: string;
  line: string | null;
};

export const hostSetupActivityEventChannel = defineEvent<HostSetupActivity>(
  'remote-hosts:setup-activity'
);
