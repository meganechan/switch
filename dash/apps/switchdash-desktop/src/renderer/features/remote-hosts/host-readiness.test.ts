import { describe, expect, it } from 'vitest';
import { deriveHostStatus, type HostStatus } from '@shared/core/remote-hosts/host-status';
import type {
  HostReachability,
  HostReachabilityStatus,
} from '@shared/core/remote-hosts/reachability';
import type {
  HostSetupPlan,
  HostSetupStep,
  HostSetupStepState,
} from '@shared/core/remote-hosts/setup';
import { resolveReadiness } from './host-readiness';

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

function step(id: string, state: HostSetupStepState): HostSetupStep {
  return {
    id,
    kind: 'core-dependency',
    name: id,
    state,
    outcome: state === 'satisfied' ? 'satisfied' : 'missing',
    version: null,
    error: null,
    output: null,
    optional: false,
    dependsOn: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
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

const statusFor = (p: HostSetupPlan | null, r: HostReachabilityStatus = 'reachable'): HostStatus =>
  deriveHostStatus(reachability(r), p);

describe('resolveReadiness — the agent-creation gate', () => {
  it('blocks a host known to be missing something, and names it', () => {
    const p = plan([step('git', 'pending'), step('node', 'satisfied')]);

    const readiness = resolveReadiness(statusFor(p), p, false);

    expect(readiness.blocked).toBe(true);
    expect(readiness.missing).toEqual(['git']);
  });

  it('allows a ready host', () => {
    const p = plan([step('git', 'satisfied')]);

    expect(resolveReadiness(statusFor(p), p, false).blocked).toBe(false);
  });

  describe('never block on ignorance', () => {
    it('does not block while a probe is in flight — checking is not a verdict', () => {
      const p = plan([step('git', 'pending'), step('node', 'satisfied')]);

      const readiness = resolveReadiness(statusFor(p), p, true);

      expect(readiness.blocked).toBe(false);
      expect(readiness.checking).toBe(true);
    });

    it('does not block a host nobody has ever checked', () => {
      // Refusing here would be the false green inverted: a verdict we did not earn.
      expect(resolveReadiness(statusFor(null), null, false).blocked).toBe(false);
    });

    it('does not block a local run, which has no host', () => {
      expect(resolveReadiness(null, null, false).blocked).toBe(false);
    });
  });

  it('leaves an unreachable host to the reachability gate rather than calling it not-ready', () => {
    // The modal already refuses unreachable hosts and says something more
    // useful about them; reporting "missing dependencies" here would blame the
    // prerequisites for a network problem.
    const p = plan([step('git', 'pending')]);

    const readiness = resolveReadiness(statusFor(p, 'unreachable'), p, false);

    expect(readiness.blocked).toBe(false);
  });

  it('counts a skipped required step as still missing', () => {
    const p = plan([step('git', 'skipped')]);

    expect(resolveReadiness(statusFor(p), p, false).blocked).toBe(true);
  });
});
