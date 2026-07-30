/**
 * Sequential, resumable setup runner for a remote host (CHOO-1809).
 *
 * Runs a host's setup plan one step at a time, persisting after every
 * transition so a run survives the app closing mid-install. Three rules drive
 * the design:
 *
 * 1. **One step in flight.** Dependencies install one after another, in order,
 *    never concurrently — the old page fired every probe and install
 *    independently and left the user to guess the sequence.
 * 2. **Halt on failure, hold position.** A failed required step stops the run.
 *    Steps already satisfied stay satisfied, the failure keeps its error and
 *    command output, and untried steps become `blocked` rather than being
 *    discarded. Resuming re-attempts the failure; it does not start over.
 * 3. **Reachability is not a dependency verdict.** The reachability gate is
 *    consulted before any probing, and an unreachable host aborts the run as
 *    *unreachable* instead of reporting every prerequisite as missing.
 *
 * Verification is explicit: after an install we re-check rather than assuming
 * the installer worked. A step is only `satisfied` on the strength of a fresh
 * observation.
 */

import {
  isInstallableOutcome,
  isPlanComplete,
  type DependencyCheckOutcome,
  type HostSetupPlan,
  type HostSetupStep,
  type HostSetupStepState,
} from '@shared/core/remote-hosts/setup';

/** What a probe observed for one step. */
export type StepCheckResult = {
  outcome: DependencyCheckOutcome;
  version?: string | null;
  /** Set when the outcome is `unknown` — why we could not tell. */
  error?: string;
};

/** Outcome of installing one step. */
export type StepInstallResult = { ok: true } | { ok: false; error: string; output?: string | null };

export type HostSetupRunnerDeps = {
  sshHost: string;
  /** Load the persisted plan. Null when the host has never been set up. */
  load: (sshHost: string) => Promise<HostSetupPlan | null>;
  save: (plan: HostSetupPlan) => Promise<void>;
  /** Push the plan to the renderer on every transition. */
  publish: (plan: HostSetupPlan) => void;
  check: (step: HostSetupStep) => Promise<StepCheckResult>;
  install: (step: HostSetupStep) => Promise<StepInstallResult>;
  /** Whether this step can be installed by switchdash at all on this host. */
  canInstall: (step: HostSetupStep) => boolean;
  /**
   * Throws when the host is not reachable. Wired to the central reachability
   * service (CHOO-1682/1780) — this runner never forms its own verdict.
   */
  requireReachable: (sshHost: string) => void;
  now?: () => Date;
};

/** Raised when a run is abandoned because the host itself is not reachable. */
export class HostSetupAbortedError extends Error {
  constructor(
    message: string,
    readonly cause: unknown
  ) {
    super(message);
    this.name = 'HostSetupAbortedError';
  }
}

export class HostSetupRunner {
  private running = false;

  constructor(private readonly deps: HostSetupRunnerDeps) {}

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString();
  }

  /**
   * Run (or resume) the plan. Returns as soon as the plan completes or halts.
   * Concurrent calls are rejected rather than interleaved — two runs against
   * one host would break the one-at-a-time guarantee.
   */
  async run(plan: HostSetupPlan): Promise<HostSetupPlan> {
    if (this.running) {
      throw new Error(`A setup run is already in progress for ${this.deps.sshHost}`);
    }
    this.running = true;
    try {
      return await this.drive(plan);
    } finally {
      this.running = false;
    }
  }

  private async drive(initial: HostSetupPlan): Promise<HostSetupPlan> {
    let plan = await this.transition(initial, { status: 'running' });

    for (const step of plan.steps) {
      if (step.state === 'satisfied' || step.state === 'skipped') continue;

      // Gate on reachability before every step, not just at the start: a host
      // can drop mid-run, and continuing would attribute the loss of the
      // transport to whichever dependency happened to be next in line.
      try {
        this.deps.requireReachable(this.deps.sshHost);
      } catch (error) {
        plan = await this.transition(plan, { status: 'halted' });
        throw new HostSetupAbortedError(
          `Setup for ${this.deps.sshHost} stopped: the host became unreachable.`,
          error
        );
      }

      plan = await this.runStep(plan, step.id);
      const current = findStep(plan, step.id);

      if (current.state === 'failed' && !current.optional) {
        return await this.haltAfter(plan, step.id);
      }
    }

    return await this.transition(plan, {
      status: isPlanComplete(plan) ? 'complete' : 'halted',
      currentStepId: null,
    });
  }

  /**
   * Check one step, install it if that is both needed and possible, then
   * re-check to verify. Never marks a step satisfied on the strength of an
   * installer's exit code alone.
   */
  async runStep(plan: HostSetupPlan, stepId: string): Promise<HostSetupPlan> {
    let next = await this.patchStep(plan, stepId, {
      state: 'checking',
      error: null,
      output: null,
    });
    next = await this.transition(next, { currentStepId: stepId });

    const checked = await this.observe(next, stepId);
    const step = findStep(checked, stepId);

    if (step.outcome === 'satisfied') return checked;

    // Nothing we can do automatically — surface the real outcome rather than
    // pretending an install would help. `not-running` and `unknown` land here.
    if (!isInstallableOutcome(step.outcome) || !this.deps.canInstall(step)) {
      return await this.patchStep(checked, stepId, {
        state: 'failed',
        error: describeUnactionable(step),
      });
    }

    const installing = await this.patchStep(checked, stepId, { state: 'installing' });
    const result = await this.deps.install(findStep(installing, stepId));

    if (!result.ok) {
      return await this.patchStep(installing, stepId, {
        state: 'failed',
        error: result.error,
        output: result.output ?? null,
      });
    }

    // Verify. An installer reporting success is a claim, not an observation.
    const verifying = await this.patchStep(installing, stepId, { state: 'checking' });
    const verified = await this.observe(verifying, stepId);
    const after = findStep(verified, stepId);

    if (after.outcome === 'satisfied') return verified;

    return await this.patchStep(verified, stepId, {
      state: 'failed',
      error:
        after.outcome === 'unknown'
          ? `${after.name} was installed but could not be verified afterwards.`
          : `${after.name} still reports "${after.outcome}" after installing.`,
    });
  }

  /** Probe one step and record what was actually observed. */
  private async observe(plan: HostSetupPlan, stepId: string): Promise<HostSetupPlan> {
    let result: StepCheckResult;
    try {
      result = await this.deps.check(findStep(plan, stepId));
    } catch (error) {
      // A probe that throws tells us nothing about the dependency — record
      // `unknown`, never `missing`.
      result = {
        outcome: 'unknown',
        error: error instanceof Error ? error.message : String(error),
      };
    }

    return await this.patchStep(plan, stepId, {
      outcome: result.outcome,
      version: result.version ?? null,
      state: result.outcome === 'satisfied' ? 'satisfied' : 'checking',
      error: result.error ?? null,
    });
  }

  /** Mark the plan halted and block everything downstream of the failure. */
  private async haltAfter(plan: HostSetupPlan, failedStepId: string): Promise<HostSetupPlan> {
    const failedIndex = plan.steps.findIndex((s) => s.id === failedStepId);
    const steps = plan.steps.map((step, index) =>
      index > failedIndex && (step.state === 'pending' || step.state === 'blocked')
        ? { ...step, state: 'blocked' as HostSetupStepState, updatedAt: this.now() }
        : step
    );
    return await this.commit({
      ...plan,
      steps,
      status: 'halted',
      currentStepId: failedStepId,
    });
  }

  /**
   * Move past a step the user has chosen not to fix. Unblocks the rest of the
   * plan so the run can continue, but is never reported as satisfied.
   */
  async skip(plan: HostSetupPlan, stepId: string): Promise<HostSetupPlan> {
    const skipped = await this.patchStep(plan, stepId, {
      state: 'skipped',
      error: null,
      output: null,
    });
    const steps = skipped.steps.map((step) =>
      step.state === 'blocked' ? { ...step, state: 'pending' as HostSetupStepState } : step
    );
    return await this.commit({ ...skipped, steps, status: 'idle' });
  }

  private async patchStep(
    plan: HostSetupPlan,
    stepId: string,
    patch: Partial<Omit<HostSetupStep, 'id'>>
  ): Promise<HostSetupPlan> {
    const steps = plan.steps.map((step) =>
      step.id === stepId ? { ...step, ...patch, updatedAt: this.now() } : step
    );
    return await this.commit({ ...plan, steps });
  }

  private async transition(
    plan: HostSetupPlan,
    patch: Partial<Pick<HostSetupPlan, 'status' | 'currentStepId'>>
  ): Promise<HostSetupPlan> {
    return await this.commit({ ...plan, ...patch });
  }

  /** Persist then publish. Every visible state change goes through here. */
  private async commit(plan: HostSetupPlan): Promise<HostSetupPlan> {
    const next = { ...plan, updatedAt: this.now() };
    await this.deps.save(next);
    this.deps.publish(next);
    return next;
  }
}

function findStep(plan: HostSetupPlan, stepId: string): HostSetupStep {
  const step = plan.steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`Setup step ${stepId} is not part of the plan for ${plan.sshHost}`);
  return step;
}

/** Why a step cannot be advanced automatically — stated in terms of what we saw. */
function describeUnactionable(step: HostSetupStep): string {
  // Not a failure of ours to fix: signing in to GitHub is a device flow the
  // user drives in a terminal. Say what they need to do rather than reporting
  // it as a missing install command.
  if (step.kind === 'gh-auth') {
    return 'Signing in to GitHub needs a one-time code you enter yourself. Use Sign in to start it.';
  }

  switch (step.outcome) {
    case 'not-running':
      return `${step.name} is installed but not running. Start it on the host, then retry.`;
    case 'unknown':
      return step.error ?? `Could not determine whether ${step.name} is available.`;
    case 'wrong-version':
      return `${step.name} is installed but too old, and switchdash has no upgrade command for this host.`;
    default:
      return `${step.name} is not installed, and switchdash has no install command for this host.`;
  }
}
