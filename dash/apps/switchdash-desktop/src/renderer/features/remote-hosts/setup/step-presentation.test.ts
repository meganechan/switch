import { describe, expect, it } from 'vitest';
import type { HostSetupPlan, HostSetupStep } from '@shared/core/remote-hosts/setup';
import {
  agentTypeBadge,
  canInstall,
  canSkip,
  groupPlanSteps,
  outcomeLabel,
  stepBadge,
} from './step-presentation';

function step(patch: Partial<HostSetupStep> = {}): HostSetupStep {
  return {
    id: 'node',
    kind: 'core-dependency',
    name: 'Node.js',
    state: 'pending',
    outcome: null,
    version: null,
    error: null,
    output: null,
    optional: false,
    dependsOn: [],
    updatedAt: '2026-02-02T00:00:00.000Z',
    ...patch,
  };
}

function plan(steps: HostSetupStep[], patch: Partial<HostSetupPlan> = {}): HostSetupPlan {
  return {
    sshHost: 'dev-vm',
    status: 'idle',
    steps,
    currentStepId: null,
    createdAt: '2026-02-02T00:00:00.000Z',
    updatedAt: '2026-02-02T00:00:00.000Z',
    ...patch,
  };
}

describe('stepBadge — green must be earned', () => {
  it('is success only for a satisfied step', () => {
    expect(stepBadge(step({ state: 'satisfied' }))).toEqual({
      tone: 'success',
      label: 'Installed',
    });
  });

  it.each(['pending', 'checking', 'installing', 'failed', 'skipped', 'blocked'] as const)(
    'is never success for %s',
    (state) => {
      expect(stepBadge(step({ state })).tone).not.toBe('success');
    }
  );

  it('does not show a skipped step as done even though the run moved past it', () => {
    expect(stepBadge(step({ state: 'skipped' }))).toEqual({ tone: 'neutral', label: 'Skipped' });
  });

  describe('"not checked" and "checked, and absent" are different facts', () => {
    it('says not checked when nothing has been observed', () => {
      expect(stepBadge(step({ state: 'pending', outcome: null }))).toEqual({
        tone: 'neutral',
        label: 'Not checked',
      });
    });

    it('reports what a probe-only pass observed, without claiming an attempt', () => {
      // Re-check leaves steps pending but records the outcome. Showing that as
      // "Not checked" would throw away the only thing the user asked for.
      expect(stepBadge(step({ state: 'pending', outcome: 'missing' }))).toEqual({
        tone: 'warning',
        label: 'Not installed',
      });
    });

    it('does not dress an undetermined probe up as a definite answer', () => {
      expect(stepBadge(step({ state: 'pending', outcome: 'unknown' })).label).toBe(
        'Could not be checked'
      );
    });
  });
});

describe('agentTypeBadge — a CLI alone is not usable', () => {
  const cli = (patch: Partial<HostSetupStep> = {}) =>
    step({ id: 'claude-code', kind: 'agent-cli', name: 'Claude Code', ...patch });
  const plugin = (patch: Partial<HostSetupStep> = {}) =>
    step({
      id: 'claude-code:plugin',
      kind: 'agent-plugin',
      name: 'Claude Code · Switch connector',
      ...patch,
    });
  const row = (c: HostSetupStep, p: HostSetupStep | null) => ({
    agentId: 'claude-code',
    name: 'Claude Code',
    cli: c,
    plugin: p,
  });

  it('is installed only when both the CLI and the connector are satisfied', () => {
    expect(
      agentTypeBadge(row(cli({ state: 'satisfied' }), plugin({ state: 'satisfied' })))
    ).toEqual({ tone: 'success', label: 'Installed' });
  });

  it('calls out the connector when the CLI is there but the connector is not', () => {
    // Without the connector the agent starts and has no Switch tools — rounding
    // this up to "Installed" is what makes that failure invisible.
    expect(agentTypeBadge(row(cli({ state: 'satisfied' }), plugin({ state: 'pending' })))).toEqual({
      tone: 'warning',
      label: 'Switch setup required',
    });
  });

  it('reports the CLI state when the CLI itself is missing', () => {
    expect(agentTypeBadge(row(cli({ state: 'pending', outcome: 'missing' }), plugin())).label).toBe(
      'Not installed'
    );
  });

  it('surfaces a failure from either half', () => {
    expect(
      agentTypeBadge(
        row(cli({ state: 'satisfied' }), plugin({ state: 'failed', outcome: 'missing' }))
      ).tone
    ).toBe('danger');
  });

  it('shows work in flight ahead of the resting state', () => {
    expect(
      agentTypeBadge(row(cli({ state: 'satisfied' }), plugin({ state: 'installing' }))).label
    ).toBe('Installing…');
  });
});

describe('groupPlanSteps', () => {
  it('splits prerequisites from agent types and pairs each CLI with its connector', () => {
    const grouped = groupPlanSteps(
      plan([
        step({ id: 'git', name: 'Git' }),
        step({ id: 'gh:auth', kind: 'gh-auth', name: 'GitHub CLI login' }),
        step({ id: 'claude-code', kind: 'agent-cli', name: 'Claude Code' }),
        step({
          id: 'claude-code:plugin',
          kind: 'agent-plugin',
          name: 'Claude Code · Switch connector',
        }),
      ])
    );

    expect(grouped.prerequisites.map((s) => s.id)).toEqual(['git', 'gh:auth']);
    expect(grouped.agentTypes).toHaveLength(1);
    expect(grouped.agentTypes[0]!.agentId).toBe('claude-code');
    expect(grouped.agentTypes[0]!.plugin?.id).toBe('claude-code:plugin');
  });

  it('keeps an agent type whose connector step is absent', () => {
    const grouped = groupPlanSteps(plan([step({ id: 'codex', kind: 'agent-cli', name: 'Codex' })]));

    expect(grouped.agentTypes[0]!.plugin).toBeNull();
  });

  it('is empty for a host with no plan', () => {
    expect(groupPlanSteps(null)).toEqual({ prerequisites: [], agentTypes: [] });
  });
});

describe('outcomeLabel', () => {
  it('says plainly when a check could not determine anything', () => {
    expect(outcomeLabel('unknown')).toBe('Could not be checked');
    expect(outcomeLabel(null)).toBe('Not checked yet');
  });

  it('distinguishes a stopped service from a missing one', () => {
    expect(outcomeLabel('not-running')).toBe('Installed but not running');
    expect(outcomeLabel('missing')).toBe('Not installed');
  });
});

describe('canSkip', () => {
  it('offers a skip on a failure', () => {
    expect(canSkip(step({ state: 'failed' }))).toBe(true);
  });

  it('offers a skip on something observed to be missing', () => {
    // After a re-check nothing has "failed" yet, but the user still needs a way
    // past it.
    expect(canSkip(step({ state: 'pending', outcome: 'missing' }))).toBe(true);
  });

  it('does not offer a skip for something never looked at, or already there', () => {
    expect(canSkip(step({ state: 'pending', outcome: null }))).toBe(false);
    expect(canSkip(step({ state: 'satisfied', outcome: 'satisfied' }))).toBe(false);
  });
});

describe('canInstall', () => {
  it('offers an install for anything outstanding', () => {
    expect(canInstall(step({ state: 'pending', outcome: 'missing' }))).toBe(true);
    expect(canInstall(step({ state: 'failed', outcome: 'missing' }))).toBe(true);
    expect(canInstall(step({ state: 'blocked' }))).toBe(true);
  });

  it('does not offer an install for something already there or in flight', () => {
    expect(canInstall(step({ state: 'satisfied' }))).toBe(false);
    expect(canInstall(step({ state: 'installing' }))).toBe(false);
    expect(canInstall(step({ state: 'checking' }))).toBe(false);
  });

  it('never offers an install for the GitHub login — it is a device flow, not a package', () => {
    expect(canInstall(step({ kind: 'gh-auth', state: 'pending', outcome: 'missing' }))).toBe(false);
  });
});
