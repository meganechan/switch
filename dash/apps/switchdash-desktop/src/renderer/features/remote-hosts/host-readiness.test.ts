import { describe, expect, it } from 'vitest';
import { deriveAgentTypeStatus, type HostStatus } from '@shared/core/remote-hosts/host-status';
import type {
  HostReachability,
  HostReachabilityStatus,
} from '@shared/core/remote-hosts/reachability';
import type {
  HostSetupPlan,
  HostSetupStep,
  HostSetupStepKind,
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

function step(
  id: string,
  state: HostSetupStepState,
  kind: HostSetupStepKind = 'core-dependency'
): HostSetupStep {
  return {
    id,
    kind,
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

const statusFor = (
  p: HostSetupPlan | null,
  agentId: string | null = null,
  r: HostReachabilityStatus = 'reachable'
): HostStatus => deriveAgentTypeStatus(reachability(r), p, agentId);

describe('resolveReadiness — the agent-creation gate', () => {
  it('blocks a host known to be missing something, and names it', () => {
    const p = plan([step('git', 'pending'), step('node', 'satisfied')]);

    const readiness = resolveReadiness(statusFor(p), p, null, false);

    expect(readiness.blocked).toBe(true);
    expect(readiness.missing).toEqual(['git']);
    expect(readiness.scope).toBe('host');
  });

  it('allows a ready host', () => {
    const p = plan([step('git', 'satisfied')]);

    expect(resolveReadiness(statusFor(p), p, null, false).blocked).toBe(false);
  });

  describe('never block on ignorance', () => {
    it('does not block while a probe is in flight — checking is not a verdict', () => {
      const p = plan([step('git', 'pending'), step('node', 'satisfied')]);

      const readiness = resolveReadiness(statusFor(p), p, null, true);

      expect(readiness.blocked).toBe(false);
      expect(readiness.checking).toBe(true);
    });

    it('does not block a host nobody has ever checked', () => {
      // Refusing here would be the false green inverted: a verdict we did not earn.
      expect(resolveReadiness(statusFor(null), null, null, false).blocked).toBe(false);
    });

    it('does not block a local run, which has no host', () => {
      expect(resolveReadiness(null, null, null, false).blocked).toBe(false);
    });
  });

  it('leaves an unreachable host to the reachability gate rather than calling it not-ready', () => {
    // The modal already refuses unreachable hosts and says something more
    // useful about them; reporting "missing dependencies" here would blame the
    // prerequisites for a network problem.
    const p = plan([step('git', 'pending')]);

    const readiness = resolveReadiness(statusFor(p, null, 'unreachable'), p, null, false);

    expect(readiness.blocked).toBe(false);
  });

  it('counts a skipped required step as still missing', () => {
    const p = plan([step('git', 'skipped')]);

    expect(resolveReadiness(statusFor(p), p, null, false).blocked).toBe(true);
  });

  /**
   * The regression this split exists for: main made Codex a Switch-supported
   * type, which added two required steps to every host, and the single verdict
   * meant a host without Codex refused to create a Claude Code agent that was
   * perfectly well installed.
   */
  describe('the gate judges the agent type being created, not all of them', () => {
    const twoAgentTypes = () =>
      plan([
        step('git', 'satisfied'),
        step('node', 'satisfied'),
        step('claude', 'satisfied', 'agent-cli'),
        step('claude:plugin', 'satisfied', 'agent-plugin'),
        step('codex', 'pending', 'agent-cli'),
        step('codex:plugin', 'pending', 'agent-plugin'),
      ]);

    it('allows creating an agent of an installed type while another type is missing', () => {
      const p = twoAgentTypes();

      const readiness = resolveReadiness(statusFor(p, 'claude'), p, 'claude', false);

      expect(readiness.blocked).toBe(false);
    });

    it('blocks the type that is actually missing, and names only its steps', () => {
      const p = twoAgentTypes();

      const readiness = resolveReadiness(statusFor(p, 'codex'), p, 'codex', false);

      expect(readiness.blocked).toBe(true);
      expect(readiness.scope).toBe('agent-type');
      expect(readiness.missing).toEqual(['codex', 'codex:plugin']);
    });

    it('reports an installed CLI with a missing connector as still not ready', () => {
      // The agent would start and have no Switch tools, which is the stale-green
      // this rewrite exists to remove.
      const p = plan([
        step('git', 'satisfied'),
        step('claude', 'satisfied', 'agent-cli'),
        step('claude:plugin', 'pending', 'agent-plugin'),
      ]);

      const readiness = resolveReadiness(statusFor(p, 'claude'), p, 'claude', false);

      expect(readiness.blocked).toBe(true);
      expect(readiness.scope).toBe('agent-type');
      expect(readiness.missing).toEqual(['claude:plugin']);
    });

    it('blames the host, not the agent type, when a prerequisite is missing', () => {
      // A host with no node cannot install any CLI, so every type inherits that
      // verdict rather than each reporting its own CLI as the problem.
      const p = plan([
        step('git', 'satisfied'),
        step('node', 'pending'),
        step('claude', 'pending', 'agent-cli'),
      ]);

      const readiness = resolveReadiness(statusFor(p, 'claude'), p, 'claude', false);

      expect(readiness.blocked).toBe(true);
      expect(readiness.scope).toBe('host');
      expect(readiness.missing).toEqual(['node']);
    });

    it('does not hold an unmanaged agent type against a ready host', () => {
      // A type whose connector switchdash does not manage has no steps; there is
      // nothing type-specific to satisfy, so the host's verdict stands.
      const p = plan([step('git', 'satisfied')]);

      expect(resolveReadiness(statusFor(p, 'mistral'), p, 'mistral', false).blocked).toBe(false);
    });
  });
});
