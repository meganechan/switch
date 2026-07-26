import { describe, expect, it } from 'vitest';
import type { SidecarRunStatus } from '@main/core/agent-runtime/impl/remote-sidecar-launcher';
import { verdictFor } from './verdict';

const CLIENT = 'client-hash';

const status = (over: Partial<SidecarRunStatus>): SidecarRunStatus => ({
  running: true,
  compatible: true,
  hash: CLIENT,
  protocolVersion: 1,
  epoch: 1,
  pid: 100,
  liveSessions: 0,
  ...over,
});

describe('verdictFor', () => {
  it('not-running when nothing is up', () => {
    expect(verdictFor(status({ running: false }), CLIENT)).toBe('not-running');
  });

  it('up-to-date when the host runs this exact build', () => {
    expect(verdictFor(status({ hash: CLIENT }), CLIENT)).toBe('up-to-date');
  });

  it('upgrade-available when a different build is running and idle', () => {
    expect(verdictFor(status({ hash: 'other', liveSessions: 0 }), CLIENT)).toBe(
      'upgrade-available'
    );
  });

  it('upgrade-pending when a different build is running but busy', () => {
    expect(verdictFor(status({ hash: 'other', liveSessions: 3 }), CLIENT)).toBe('upgrade-pending');
  });

  it('incompatible outranks any build comparison', () => {
    // Even the same hash is moot if we cannot speak its protocol — though in
    // practice an incompatible sidecar is a different build anyway.
    expect(verdictFor(status({ compatible: false, hash: 'other', liveSessions: 5 }), CLIENT)).toBe(
      'incompatible'
    );
  });
});
