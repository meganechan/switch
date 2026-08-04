import { describe, expect, it, vi } from 'vitest';
import type { HostSetupPlan, HostSetupStep } from '@shared/core/remote-hosts/setup';
import {
  HostSetupAbortedError,
  HostSetupRunner,
  type StepCheckResult,
  type StepInstallResult,
} from './host-setup-runner';

function step(id: string, patch: Partial<HostSetupStep> = {}): HostSetupStep {
  return {
    id,
    kind: 'core-dependency',
    name: id,
    state: 'pending',
    outcome: null,
    version: null,
    error: null,
    output: null,
    optional: false,
    dependsOn: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

function plan(steps: HostSetupStep[]): HostSetupPlan {
  return {
    sshHost: 'dev-vm',
    status: 'idle',
    steps,
    currentStepId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

type Harness = {
  checks: Record<string, StepCheckResult[]>;
  installs: Record<string, StepInstallResult>;
  canInstall?: (id: string) => boolean;
  reachable?: boolean;
};

class Unreachable extends Error {}

function makeRunner(harness: Harness) {
  const saved: HostSetupPlan[] = [];
  const published: HostSetupPlan[] = [];
  const installOrder: string[] = [];
  const inFlight = { count: 0, max: 0 };

  const runner = new HostSetupRunner({
    sshHost: 'dev-vm',
    load: async () => null,
    save: async (p) => void saved.push(structuredClone(p)),
    publish: (p) => published.push(structuredClone(p)),
    check: async (s) => {
      const queue = harness.checks[s.id] ?? [{ outcome: 'satisfied' }];
      return queue.length > 1 ? queue.shift()! : queue[0]!;
    },
    install: async (s) => {
      installOrder.push(s.id);
      inFlight.count += 1;
      inFlight.max = Math.max(inFlight.max, inFlight.count);
      await Promise.resolve();
      inFlight.count -= 1;
      return harness.installs[s.id] ?? { ok: true };
    },
    canInstall: (s) => harness.canInstall?.(s.id) ?? true,
    requireReachable: () => {
      if (harness.reachable === false) throw new Unreachable('host down');
    },
    now: () => new Date('2026-02-02T00:00:00.000Z'),
  });

  return { runner, saved, published, installOrder, inFlight };
}

const stateOf = (p: HostSetupPlan, id: string) => p.steps.find((s) => s.id === id)!.state;

describe('HostSetupRunner', () => {
  it('marks already-satisfied steps satisfied without installing', async () => {
    const { runner, installOrder } = makeRunner({
      checks: { git: [{ outcome: 'satisfied', version: '2.43.0' }] },
      installs: {},
    });

    const result = await runner.run(plan([step('git')]));

    expect(result.status).toBe('complete');
    expect(stateOf(result, 'git')).toBe('satisfied');
    expect(installOrder).toEqual([]);
  });

  it('installs a missing dependency and verifies it afterwards', async () => {
    const { runner, installOrder } = makeRunner({
      checks: { node: [{ outcome: 'missing' }, { outcome: 'satisfied', version: '22.0.0' }] },
      installs: { node: { ok: true } },
    });

    const result = await runner.run(plan([step('node')]));

    expect(installOrder).toEqual(['node']);
    expect(stateOf(result, 'node')).toBe('satisfied');
    expect(result.steps[0]!.version).toBe('22.0.0');
    expect(result.status).toBe('complete');
  });

  it('fails the step when an install reports success but verification disagrees', async () => {
    // The installer's exit code is a claim; only the re-check is evidence.
    const { runner } = makeRunner({
      checks: { node: [{ outcome: 'missing' }, { outcome: 'missing' }] },
      installs: { node: { ok: true } },
    });

    const result = await runner.run(plan([step('node')]));

    expect(stateOf(result, 'node')).toBe('failed');
    expect(result.steps[0]!.error).toContain('still reports "missing" after installing');
    expect(result.status).toBe('halted');
  });

  it('installs strictly one at a time, in plan order', async () => {
    const { runner, installOrder, inFlight } = makeRunner({
      checks: {
        git: [{ outcome: 'missing' }, { outcome: 'satisfied' }],
        node: [{ outcome: 'missing' }, { outcome: 'satisfied' }],
        tmux: [{ outcome: 'missing' }, { outcome: 'satisfied' }],
      },
      installs: {},
    });

    await runner.run(plan([step('git'), step('node'), step('tmux')]));

    expect(installOrder).toEqual(['git', 'node', 'tmux']);
    expect(inFlight.max).toBe(1);
  });

  it('halts on failure, keeps earlier progress, and blocks later steps', async () => {
    const { runner, installOrder } = makeRunner({
      checks: {
        git: [{ outcome: 'satisfied' }],
        node: [{ outcome: 'missing' }],
        tmux: [{ outcome: 'missing' }],
      },
      installs: { node: { ok: false, error: 'apt-get failed', output: 'E: Unable to locate' } },
    });

    const result = await runner.run(plan([step('git'), step('node'), step('tmux')]));

    expect(result.status).toBe('halted');
    expect(stateOf(result, 'git')).toBe('satisfied'); // step 1 is not discarded
    expect(stateOf(result, 'node')).toBe('failed');
    expect(stateOf(result, 'tmux')).toBe('blocked'); // never attempted, and says so
    expect(installOrder).toEqual(['node']); // stopped; tmux was not installed
    expect(result.currentStepId).toBe('node');
  });

  it('preserves the failing step error and command output', async () => {
    const { runner } = makeRunner({
      checks: { node: [{ outcome: 'missing' }] },
      installs: { node: { ok: false, error: 'permission denied', output: 'sudo: no tty' } },
    });

    const result = await runner.run(plan([step('node')]));

    expect(result.steps[0]!.error).toBe('permission denied');
    expect(result.steps[0]!.output).toBe('sudo: no tty');
  });

  it('resumes from the failed step without redoing satisfied ones', async () => {
    // Each runner gets its own check queues — sharing them would let the first
    // run consume the second's answers and hide whether resume really re-probes.
    const first = makeRunner({
      checks: { git: [{ outcome: 'satisfied' }], node: [{ outcome: 'missing' }] },
      installs: { node: { ok: false, error: 'transient' } },
    });
    const halted = await first.runner.run(plan([step('git'), step('node')]));
    expect(halted.status).toBe('halted');

    // Resume with the persisted plan, exactly as a restart would. node is still
    // missing, so it must be re-attempted; git is satisfied and must not be.
    const second = makeRunner({
      checks: {
        git: [{ outcome: 'satisfied' }],
        node: [{ outcome: 'missing' }, { outcome: 'satisfied' }],
      },
      installs: { node: { ok: true } },
    });
    const resumed = await second.runner.run(halted);

    expect(resumed.status).toBe('complete');
    expect(second.installOrder).toEqual(['node']); // git was not re-installed
  });

  it('records unknown — never missing — when a probe throws', async () => {
    const runner = new HostSetupRunner({
      sshHost: 'dev-vm',
      load: async () => null,
      save: async () => {},
      publish: () => {},
      check: async () => {
        throw new Error('ssh channel closed');
      },
      install: async () => ({ ok: true }),
      canInstall: () => true,
      requireReachable: () => {},
      now: () => new Date('2026-02-02T00:00:00.000Z'),
    });

    const result = await runner.run(plan([step('docker')]));

    expect(result.steps[0]!.outcome).toBe('unknown');
    expect(result.steps[0]!.state).toBe('failed');
    expect(result.steps[0]!.error).toContain('ssh channel closed');
  });

  it('never reports an unverifiable step as satisfied', async () => {
    const { runner } = makeRunner({
      checks: { docker: [{ outcome: 'unknown', error: 'could not tell' }] },
      installs: {},
    });

    const result = await runner.run(plan([step('docker')]));

    expect(stateOf(result, 'docker')).not.toBe('satisfied');
    expect(result.status).toBe('halted');
  });

  it('does not try to install a dependency that is installed but not running', async () => {
    const { runner, installOrder } = makeRunner({
      checks: { docker: [{ outcome: 'not-running' }] },
      installs: {},
    });

    const result = await runner.run(plan([step('docker')]));

    expect(installOrder).toEqual([]);
    expect(result.steps[0]!.error).toContain('not running');
  });

  it('reports "no install command" rather than silently stalling', async () => {
    const { runner } = makeRunner({
      checks: { docker: [{ outcome: 'missing' }] },
      installs: {},
      canInstall: () => false,
    });

    const result = await runner.run(plan([step('docker')]));

    expect(result.steps[0]!.state).toBe('failed');
    expect(result.steps[0]!.error).toContain('no install command');
  });

  it('continues past a failed optional step', async () => {
    const { runner } = makeRunner({
      checks: { gh: [{ outcome: 'missing' }], node: [{ outcome: 'satisfied' }] },
      installs: { gh: { ok: false, error: 'nope' } },
    });

    const result = await runner.run(plan([step('gh', { optional: true }), step('node')]));

    expect(stateOf(result, 'gh')).toBe('failed');
    expect(stateOf(result, 'node')).toBe('satisfied');
    expect(result.status).toBe('complete'); // optional failure does not block the host
  });

  it('skipping unblocks the rest of the plan but is not satisfied', async () => {
    const { runner } = makeRunner({
      checks: { node: [{ outcome: 'missing' }], tmux: [{ outcome: 'satisfied' }] },
      installs: { node: { ok: false, error: 'nope' } },
    });

    const halted = await runner.run(plan([step('node'), step('tmux')]));
    expect(stateOf(halted, 'tmux')).toBe('blocked');

    const skipped = await runner.skip(halted, 'node');

    expect(stateOf(skipped, 'node')).toBe('skipped');
    expect(stateOf(skipped, 'tmux')).toBe('pending'); // unblocked
    expect(skipped.steps.find((s) => s.id === 'node')!.outcome).not.toBe('satisfied');
  });

  it('aborts as unreachable instead of blaming a dependency', async () => {
    const { runner, installOrder } = makeRunner({
      checks: { node: [{ outcome: 'missing' }] },
      installs: {},
      reachable: false,
    });

    await expect(runner.run(plan([step('node')]))).rejects.toBeInstanceOf(HostSetupAbortedError);
    expect(installOrder).toEqual([]);
  });

  it('persists and publishes every transition', async () => {
    const { runner, saved, published } = makeRunner({
      checks: { node: [{ outcome: 'missing' }, { outcome: 'satisfied' }] },
      installs: { node: { ok: true } },
    });

    await runner.run(plan([step('node')]));

    // running → checking → observed → installing → checking → satisfied → complete
    expect(saved.length).toBeGreaterThanOrEqual(6);
    expect(published.length).toBe(saved.length);
    expect(saved.at(-1)!.status).toBe('complete');
  });

  it('refuses a second concurrent run for the same host', async () => {
    const { runner } = makeRunner({
      checks: { node: [{ outcome: 'missing' }, { outcome: 'satisfied' }] },
      installs: { node: { ok: true } },
    });
    const p = plan([step('node')]);

    const first = runner.run(p);
    await expect(runner.run(p)).rejects.toThrow('already in progress');
    await first;
  });

  it('stops mid-run when the host drops', async () => {
    const harness: Harness = {
      checks: { git: [{ outcome: 'satisfied' }], node: [{ outcome: 'missing' }] },
      installs: {},
    };
    const reachable = { value: true };
    const runner = new HostSetupRunner({
      sshHost: 'dev-vm',
      load: async () => null,
      save: async () => {},
      publish: () => {},
      check: async (s) => harness.checks[s.id]![0]!,
      install: async () => ({ ok: true }),
      canInstall: () => true,
      requireReachable: () => {
        if (!reachable.value) throw new Unreachable('dropped');
        reachable.value = false; // drops after the first step
      },
      now: () => new Date('2026-02-02T00:00:00.000Z'),
    });

    await expect(runner.run(plan([step('git'), step('node')]))).rejects.toBeInstanceOf(
      HostSetupAbortedError
    );
  });

  it('clears a previous error when a step is retried', async () => {
    const { runner } = makeRunner({
      checks: { node: [{ outcome: 'missing' }, { outcome: 'satisfied' }] },
      installs: { node: { ok: true } },
    });
    const failed = plan([
      step('node', { state: 'failed', error: 'old failure', output: 'old output' }),
    ]);

    const result = await runner.run(failed);

    expect(stateOf(result, 'node')).toBe('satisfied');
    expect(result.steps[0]!.error).toBeNull();
    expect(result.steps[0]!.output).toBeNull();
  });
});

describe('plan helpers', () => {
  it('treats a skipped required step as outstanding, not done', async () => {
    const { isPlanComplete } = await import('@shared/core/remote-hosts/setup');
    expect(isPlanComplete(plan([step('node', { state: 'skipped' })]))).toBe(false);
  });

  it('ignores optional steps when deciding completeness', async () => {
    const { isPlanComplete } = await import('@shared/core/remote-hosts/setup');
    expect(
      isPlanComplete(
        plan([
          step('node', { state: 'satisfied' }),
          step('gh', { optional: true, state: 'failed' }),
        ])
      )
    ).toBe(true);
  });
});

describe('checkAll — looking without touching', () => {
  it('installs nothing, whatever it finds', async () => {
    const { runner, installOrder } = makeRunner({
      checks: { git: [{ outcome: 'satisfied' }], node: [{ outcome: 'missing' }] },
      installs: {},
    });

    await runner.checkAll(plan([step('git'), step('node')]));

    expect(installOrder).toEqual([]);
  });

  it('records what it saw on steps it leaves pending', async () => {
    // The distinction the UI depends on: "not checked" vs "checked, and absent".
    const { runner } = makeRunner({
      checks: { node: [{ outcome: 'missing' }] },
      installs: {},
    });

    const result = await runner.checkAll(plan([step('node')]));

    expect(stateOf(result, 'node')).toBe('pending');
    expect(result.steps[0]!.outcome).toBe('missing');
  });

  it('marks what is genuinely there as satisfied', async () => {
    const { runner } = makeRunner({
      checks: { git: [{ outcome: 'satisfied', version: '2.43.0' }] },
      installs: {},
    });

    const result = await runner.checkAll(plan([step('git')]));

    expect(stateOf(result, 'git')).toBe('satisfied');
    expect(result.status).toBe('complete');
  });

  it('checks every step rather than stopping at the first problem', async () => {
    // Unlike a run, there is nothing to halt for — the point is a full picture.
    const { runner } = makeRunner({
      checks: {
        git: [{ outcome: 'missing' }],
        node: [{ outcome: 'missing' }],
        tmux: [{ outcome: 'satisfied' }],
      },
      installs: {},
    });

    const result = await runner.checkAll(plan([step('git'), step('node'), step('tmux')]));

    expect(result.steps.map((s) => s.outcome)).toEqual(['missing', 'missing', 'satisfied']);
    expect(stateOf(result, 'tmux')).toBe('satisfied');
  });

  it('supersedes a previous failure rather than leaving its error behind', async () => {
    const { runner } = makeRunner({
      checks: { node: [{ outcome: 'satisfied', version: '22.0.0' }] },
      installs: {},
    });

    const result = await runner.checkAll(
      plan([step('node', { state: 'failed', error: 'apt-get failed', output: 'E: broken' })])
    );

    expect(stateOf(result, 'node')).toBe('satisfied');
    expect(result.steps[0]!.error).toBeNull();
    expect(result.steps[0]!.output).toBeNull();
  });

  it('aborts as unreachable rather than reporting everything missing', async () => {
    const { runner } = makeRunner({ checks: {}, installs: {}, reachable: false });

    await expect(runner.checkAll(plan([step('git')]))).rejects.toBeInstanceOf(
      HostSetupAbortedError
    );
  });
});

describe('gh-auth steps', () => {
  const ghStep = (patch: Partial<HostSetupStep> = {}) =>
    step('gh:auth', { kind: 'gh-auth', name: 'GitHub CLI login', optional: true, ...patch });

  it('tells the user to sign in rather than reporting a missing install command', async () => {
    const { runner, installOrder } = makeRunner({
      checks: { 'gh:auth': [{ outcome: 'missing' }] },
      installs: {},
      canInstall: () => false,
    });

    const result = await runner.run(plan([ghStep()]));

    expect(installOrder).toEqual([]);
    expect(result.steps[0]!.error).toMatch(/Use Sign in to start it/);
  });

  it('leads with why a login that already exists is still not enough', async () => {
    const { runner } = makeRunner({
      checks: {
        'gh:auth': [
          {
            outcome: 'missing',
            error: 'The GitHub token is missing the read:packages scope.',
          },
        ],
      },
      installs: {},
      canInstall: () => false,
    });

    const result = await runner.run(plan([ghStep()]));

    expect(result.steps[0]!.state).toBe('failed');
    expect(result.steps[0]!.error).toMatch(
      /^The GitHub token is missing the read:packages scope\./
    );
  });
});

describe('runner determinism', () => {
  it('does not mutate the plan it was given', async () => {
    const { runner } = makeRunner({ checks: { git: [{ outcome: 'satisfied' }] }, installs: {} });
    const original = plan([step('git')]);
    const snapshot = structuredClone(original);

    await runner.run(original);

    expect(original).toEqual(snapshot);
  });

  it('stamps updatedAt on every changed step', async () => {
    const { runner } = makeRunner({ checks: { git: [{ outcome: 'satisfied' }] }, installs: {} });
    vi.useFakeTimers();

    const result = await runner.run(plan([step('git')]));

    expect(result.steps[0]!.updatedAt).toBe('2026-02-02T00:00:00.000Z');
    vi.useRealTimers();
  });
});
