import { describe, expect, it } from 'vitest';
import type { GhAuthStatus } from '../gh-auth';
import { outcomeForDependency, outcomeForGhAuth } from './step-outcomes';

function ghStatus(overrides: Partial<GhAuthStatus>): GhAuthStatus {
  return {
    authenticated: true,
    account: 'octocat',
    canReadPackages: true,
    detail: null,
    ...overrides,
  };
}

describe('outcomeForGhAuth', () => {
  it('is satisfied only when the login can also read packages', () => {
    expect(outcomeForGhAuth(ghStatus({}))).toEqual({ outcome: 'satisfied', version: 'octocat' });
  });

  it('does not accept a login that lacks read:packages, and says why', () => {
    const result = outcomeForGhAuth(
      ghStatus({
        canReadPackages: false,
        detail: 'The GitHub token is missing the read:packages scope.',
      })
    );

    expect(result.outcome).toBe('missing');
    expect(result.error).toMatch(/read:packages/);
  });

  it('reports a host with no login at all as missing', () => {
    const result = outcomeForGhAuth(
      ghStatus({
        authenticated: false,
        account: null,
        canReadPackages: false,
        detail: 'Not logged in.',
      })
    );

    expect(result).toEqual({ outcome: 'missing', error: 'Not logged in.' });
  });
});

describe('outcomeForDependency', () => {
  it('reports an available dependency as satisfied with its version', () => {
    expect(outcomeForDependency({ status: 'available', version: '2.44.0' }, false)).toEqual({
      outcome: 'satisfied',
      version: '2.44.0',
    });
  });

  it('reports an absent dependency as missing', () => {
    expect(outcomeForDependency({ status: 'missing', version: null }, false)).toEqual({
      outcome: 'missing',
      version: null,
    });
  });

  it('recovers "too old" from the manager collapsing it into an error', () => {
    expect(
      outcomeForDependency({ status: 'error', version: '16.0.0', error: 'needs >= 20' }, true)
    ).toEqual({ outcome: 'wrong-version', version: '16.0.0', error: 'needs >= 20' });
  });

  it('reports an undetermined probe as unknown rather than guessing missing', () => {
    expect(
      outcomeForDependency({ status: 'error', version: null, error: 'channel closed' }, true)
    ).toEqual({ outcome: 'unknown', version: null, error: 'channel closed' });
  });
});
