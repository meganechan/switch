import { describe, expect, it } from 'vitest';
import { deriveHostStatus, isHostUsable } from './host-status';
import type { HostReachability, HostReachabilityStatus } from './reachability';
import type { HostSetupPlan, HostSetupStep, HostSetupStepState } from './setup';

function reachability(status: HostReachabilityStatus): HostReachability {
  return {
    sshHost: 'dev-vm',
    status,
    lastError: null,
    lastCheckedAt: null,
    lastReachableAt: null,
    consecutiveFailures: 0,
    nextProbeAt: null,
    probing: false,
  };
}

function step(id: string, state: HostSetupStepState, optional = false): HostSetupStep {
  return {
    id,
    kind: 'core-dependency',
    name: id,
    state,
    outcome: state === 'satisfied' ? 'satisfied' : null,
    version: null,
    error: null,
    output: null,
    optional,
    dependsOn: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function plan(steps: HostSetupStep[], patch: Partial<HostSetupPlan> = {}): HostSetupPlan {
  return {
    sshHost: 'dev-vm',
    status: 'idle',
    steps,
    currentStepId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  };
}

describe('deriveHostStatus', () => {
  it('reports a fully satisfied reachable host as ready', () => {
    const status = deriveHostStatus(
      reachability('reachable'),
      plan([step('git', 'satisfied'), step('node', 'satisfied')])
    );

    expect(status.kind).toBe('ready');
    expect(status.done).toBe(2);
    expect(isHostUsable(status)).toBe(true);
  });

  it('does not hold an outstanding optional step against the verdict', () => {
    const status = deriveHostStatus(
      reachability('reachable'),
      plan([step('git', 'satisfied'), step('gh', 'pending', true)])
    );

    expect(status.kind).toBe('ready');
  });

  it('counts every step shown, so the tally cannot contradict the list', () => {
    // A count that quietly excluded optional steps is how a host came to read
    // "5 of 5 required" with two rows plainly saying Not installed.
    const status = deriveHostStatus(
      reachability('reachable'),
      plan([step('git', 'satisfied'), step('gh', 'pending', true)])
    );

    expect(status.done).toBe(1);
    expect(status.total).toBe(2);
  });

  describe('readiness is withheld when the host cannot be reached', () => {
    // The whole point of CHOO-1780: a network problem must not be reported as
    // a missing dependency, however good or bad the last setup run looked.
    it('reports unreachable, not setup-required, even with a failed plan', () => {
      const status = deriveHostStatus(
        reachability('unreachable'),
        plan([step('git', 'failed'), step('node', 'pending')])
      );

      expect(status.kind).toBe('unreachable');
      expect(status.readinessKnown).toBe(false);
      expect(isHostUsable(status)).toBe(false);
    });

    it('reports unreachable, not ready, even with a fully satisfied plan', () => {
      const status = deriveHostStatus(
        reachability('unreachable'),
        plan([step('git', 'satisfied')])
      );

      expect(status.kind).toBe('unreachable');
      expect(status.readinessKnown).toBe(false);
      expect(isHostUsable(status)).toBe(false);
    });

    it('distinguishes an auth failure, which never self-heals', () => {
      const status = deriveHostStatus(reachability('suspended'), null);

      expect(status.kind).toBe('auth-failed');
      expect(status.label).toBe('SSH auth failed');
    });
  });

  describe('not knowing is its own answer', () => {
    it('reports a host with no plan as unchecked, not as not-ready', () => {
      const status = deriveHostStatus(reachability('reachable'), null);

      expect(status.kind).toBe('unchecked');
      expect(status.readinessKnown).toBe(false);
    });

    it('reports a built-but-never-observed plan as unchecked', () => {
      // Building the plan lists what to check; it observes nothing. Calling
      // that "setup required" claims knowledge we do not have.
      const status = deriveHostStatus(
        reachability('reachable'),
        plan([step('git', 'pending'), step('node', 'pending')])
      );

      expect(status.kind).toBe('unchecked');
      expect(status.readinessKnown).toBe(false);
    });

    it('reports setup-required once something has actually been observed', () => {
      const status = deriveHostStatus(
        reachability('reachable'),
        plan([step('git', 'satisfied'), step('node', 'pending')])
      );

      expect(status.kind).toBe('setup-required');
      expect(status.readinessKnown).toBe(true);
      expect(status.done).toBe(1);
      expect(status.total).toBe(2);
    });

    it('treats an unknown-reachability host as checkable rather than blocked', () => {
      // `unknown` is deliberately not blocking elsewhere in the app; readiness
      // should follow the same convention.
      const status = deriveHostStatus(reachability('unknown'), plan([step('git', 'satisfied')]));

      expect(status.kind).toBe('ready');
    });
  });

  it('names the step in flight while an install is going', () => {
    const status = deriveHostStatus(
      reachability('reachable'),
      plan([step('git', 'satisfied'), step('node', 'installing')])
    );

    expect(status.kind).toBe('setting-up');
    expect(status.label).toBe('Setting up node…');
  });

  it('reports a skipped required step as still not ready', () => {
    // Skipping is the user moving past a problem, not the problem going away.
    const status = deriveHostStatus(reachability('reachable'), plan([step('git', 'skipped')]));

    expect(status.kind).toBe('setup-required');
    expect(isHostUsable(status)).toBe(false);
  });
});
