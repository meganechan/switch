import { describe, expect, it } from 'vitest';
import type { HostSetupPlan, HostSetupStep } from '@shared/core/remote-hosts/setup';
import {
  outcomeLabel,
  showsAsComplete,
  stepStatusLabel,
  stepTone,
  summarisePlan,
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

describe('showsAsComplete — the green tick must be earned', () => {
  it('is true only for a satisfied step', () => {
    expect(showsAsComplete(step({ state: 'satisfied' }))).toBe(true);
  });

  it.each(['pending', 'checking', 'installing', 'failed', 'skipped', 'blocked'] as const)(
    'is false for %s',
    (state) => {
      expect(showsAsComplete(step({ state }))).toBe(false);
    }
  );

  it('is false for a skipped step even though the run moved past it', () => {
    expect(showsAsComplete(step({ state: 'skipped' }))).toBe(false);
  });

  it('is false when the check could not determine anything', () => {
    expect(showsAsComplete(step({ state: 'failed', outcome: 'unknown' }))).toBe(false);
  });
});

describe('stepTone', () => {
  it('maps each state to a distinct tone', () => {
    expect(stepTone(step({ state: 'satisfied' }))).toBe('done');
    expect(stepTone(step({ state: 'checking' }))).toBe('busy');
    expect(stepTone(step({ state: 'installing' }))).toBe('busy');
    expect(stepTone(step({ state: 'failed' }))).toBe('failed');
    expect(stepTone(step({ state: 'skipped' }))).toBe('skipped');
    expect(stepTone(step({ state: 'blocked' }))).toBe('waiting');
    expect(stepTone(step({ state: 'pending' }))).toBe('idle');
  });

  it('never gives a non-satisfied step the done tone', () => {
    const states = ['pending', 'checking', 'installing', 'failed', 'skipped', 'blocked'] as const;
    for (const state of states) {
      expect(stepTone(step({ state }))).not.toBe('done');
    }
  });
});

describe('labels', () => {
  it('distinguishes "could not check" from "not installed"', () => {
    expect(outcomeLabel('unknown')).toBe('Could not be checked');
    expect(outcomeLabel('missing')).toBe('Not installed');
    expect(outcomeLabel('unknown')).not.toBe(outcomeLabel('missing'));
  });

  it('names the installed-but-unusable states specifically', () => {
    expect(outcomeLabel('not-running')).toBe('Installed but not running');
    expect(outcomeLabel('wrong-version')).toBe('Installed but too old');
  });

  it('says a pending step has not been checked, rather than implying a result', () => {
    expect(stepStatusLabel(step({ state: 'pending' }))).toBe('Not checked yet');
    expect(outcomeLabel(null)).toBe('Not checked yet');
  });

  it('shows the detected version on a ready step', () => {
    expect(stepStatusLabel(step({ state: 'satisfied', version: '22.0.0' }))).toBe('Ready · 22.0.0');
  });

  it('explains that a blocked step is waiting on something upstream', () => {
    expect(stepStatusLabel(step({ state: 'blocked' }))).toBe('Waiting on an earlier step');
  });

  it('reports the observed outcome for a failed step', () => {
    expect(stepStatusLabel(step({ state: 'failed', outcome: 'not-running' }))).toBe(
      'Installed but not running'
    );
  });
});

describe('summarisePlan', () => {
  it('treats a host with no plan as unstarted, not ready', () => {
    const summary = summarisePlan(null);
    expect(summary.ready).toBe(false);
    expect(summary.tone).toBe('unstarted');
  });

  it('is ready only when every required step is satisfied', () => {
    const summary = summarisePlan(
      plan([step({ id: 'git', state: 'satisfied' }), step({ id: 'node', state: 'satisfied' })])
    );
    expect(summary.ready).toBe(true);
    expect(summary.headline).toBe('Ready');
  });

  it('ignores optional steps when deciding readiness', () => {
    const summary = summarisePlan(
      plan([
        step({ id: 'node', state: 'satisfied' }),
        step({ id: 'gh', state: 'failed', optional: true }),
      ])
    );
    expect(summary.ready).toBe(true);
  });

  it('is not ready when a required step was skipped', () => {
    const summary = summarisePlan(
      plan([step({ id: 'node', state: 'skipped' }), step({ id: 'git', state: 'satisfied' })])
    );
    expect(summary.ready).toBe(false);
  });

  it('names the step a halted run stopped at', () => {
    const summary = summarisePlan(
      plan([
        step({ id: 'git', state: 'satisfied' }),
        step({ id: 'node', state: 'failed' }),
        step({ id: 'tmux', state: 'blocked' }),
      ])
    );
    expect(summary.tone).toBe('blocked');
    expect(summary.headline).toBe('Stopped at Node.js');
  });

  it('does not report an optional failure as blocking', () => {
    const summary = summarisePlan(
      plan([
        step({ id: 'node', state: 'satisfied' }),
        step({ id: 'gh', state: 'failed', optional: true, name: 'GitHub CLI' }),
      ])
    );
    expect(summary.tone).not.toBe('blocked');
  });

  it('names the step currently running', () => {
    const summary = summarisePlan(
      plan([step({ id: 'node', state: 'installing' })], {
        status: 'running',
        currentStepId: 'node',
      })
    );
    expect(summary.headline).toBe('Setting up Node.js…');
  });

  it('counts only required steps in the progress fraction', () => {
    const summary = summarisePlan(
      plan([
        step({ id: 'git', state: 'satisfied' }),
        step({ id: 'node', state: 'pending' }),
        step({ id: 'gh', state: 'pending', optional: true }),
      ])
    );
    expect(summary).toMatchObject({ done: 1, total: 2 });
  });

  it('reports partial progress once something is done', () => {
    const summary = summarisePlan(
      plan([step({ id: 'git', state: 'satisfied' }), step({ id: 'node', state: 'pending' })])
    );
    expect(summary.headline).toBe('1 of 2 steps done');
  });
});
