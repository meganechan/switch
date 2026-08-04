import { describe, expect, it } from 'vitest';
import type { GhAuthStatus } from '../gh-auth';
import {
  condenseCommandOutput,
  describeInstallFailure,
  outcomeForDependency,
  outcomeForGhAuth,
} from './step-outcomes';

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

describe('describeInstallFailure', () => {
  // Trimmed from a real failure on an EC2 Ubuntu host: the distro's own
  // automatic-updates timer held the lock while we tried to install git.
  const APT_LOCK_OUTPUT = [
    'Hit:1 http://us-east-2.ec2.archive.ubuntu.com/ubuntu jammy InRelease',
    'Reading package lists... Done',
    'E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process 4030760 (apt-get)',
    'N: Be aware that removing the lock file is not a solution and may break your system.',
    'E: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), is another process using it?',
  ].join('\n');

  it('names the package-manager lock instead of leaving apt to explain itself', () => {
    const message = describeInstallFailure(
      'Git',
      'Command failed with exit code 100',
      APT_LOCK_OUTPUT
    );

    expect(message).toContain('another process on the host is using the package manager');
    expect(message).toContain('retry');
    expect(message).toContain('Git');
  });

  it('recognises the lock from the message alone', () => {
    expect(
      describeInstallFailure('Git', 'E: Could not get lock /var/lib/dpkg/lock-frontend', null)
    ).toContain('package manager');
  });

  it('leaves an error it does not recognise exactly as the installer put it', () => {
    // Guessing at an unfamiliar failure would be worse than quoting it.
    expect(describeInstallFailure('tmux', 'E: Unable to locate package tmux', 'some output')).toBe(
      'E: Unable to locate package tmux'
    );
  });
});

describe('condenseCommandOutput', () => {
  it('keeps the final state of a redrawn progress line, not every frame', () => {
    const raw = '0% [Working]\r50% [Working]\r100% [Working]\nFetched 6649 B\n';

    expect(condenseCommandOutput(raw)).toBe('100% [Working]\nFetched 6649 B');
  });

  it('drops the blank padding apt uses to erase the previous frame', () => {
    const raw = '0% [Waiting for headers]\r                         \rHit:7 security.ubuntu.com\n';

    expect(condenseCommandOutput(raw)).toBe('Hit:7 security.ubuntu.com');
  });

  it('keeps the error, which is what the user is looking for', () => {
    const raw =
      '0% [Waiting]\r0% [Waiting]\r          \rReading package lists... Done\n' +
      'E: Could not get lock /var/lib/dpkg/lock-frontend\n';

    expect(condenseCommandOutput(raw)).toBe(
      'Reading package lists... Done\nE: Could not get lock /var/lib/dpkg/lock-frontend'
    );
  });

  it('leaves output with no redraws alone', () => {
    expect(condenseCommandOutput('line one\nline two')).toBe('line one\nline two');
  });
});
