import { beforeEach, describe, expect, it, vi } from 'vitest';

const getLocalStatus = vi.hoisted(() => vi.fn());
const getRemoteStatus = vi.hoisted(() => vi.fn());

vi.mock('./local-server-service', () => ({
  localServerService: { getStatus: getLocalStatus },
}));
vi.mock('./remote-server-service', () => ({
  remoteServerService: { getStatus: getRemoteStatus },
}));

const { isManagedServerRunning } = await import('./managed-server-status');

function server(overrides: Record<string, unknown>) {
  return {
    id: 'srv',
    name: 'S',
    gatewayUrl: 'http://localhost:3300',
    apiUrl: 'http://localhost:8000',
    managed: true,
    managementKind: 'local',
    sshHost: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  } as never;
}

describe('isManagedServerRunning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false for an external (non-managed) server without probing any service', () => {
    expect(isManagedServerRunning(server({ managed: false }))).toBe(false);
    expect(getLocalStatus).not.toHaveBeenCalled();
    expect(getRemoteStatus).not.toHaveBeenCalled();
  });

  it('reads the local status for a local-managed server', () => {
    getLocalStatus.mockReturnValue({ phase: 'running' });
    expect(isManagedServerRunning(server({ managementKind: 'local' }))).toBe(true);

    getLocalStatus.mockReturnValue({ phase: 'stopped' });
    expect(isManagedServerRunning(server({ managementKind: 'local' }))).toBe(false);
  });

  it('treats a legacy managed row (null kind) as local', () => {
    getLocalStatus.mockReturnValue({ phase: 'running' });
    expect(isManagedServerRunning(server({ managementKind: null }))).toBe(true);
    expect(getRemoteStatus).not.toHaveBeenCalled();
  });

  it('reads the per-host status for a remote-managed server', () => {
    getRemoteStatus.mockReturnValue({ phase: 'running' });
    expect(isManagedServerRunning(server({ managementKind: 'remote', sshHost: 'host-a' }))).toBe(
      true
    );
    expect(getRemoteStatus).toHaveBeenCalledWith('host-a');

    getRemoteStatus.mockReturnValue({ phase: 'stopped' });
    expect(isManagedServerRunning(server({ managementKind: 'remote', sshHost: 'host-a' }))).toBe(
      false
    );
  });

  it('returns false for a remote-managed server with no ssh host', () => {
    expect(isManagedServerRunning(server({ managementKind: 'remote', sshHost: null }))).toBe(false);
    expect(getRemoteStatus).not.toHaveBeenCalled();
  });

  it('treats non-running phases (starting/stopping/error) as not running', () => {
    for (const phase of ['starting', 'stopping', 'error']) {
      getLocalStatus.mockReturnValue({ phase });
      expect(isManagedServerRunning(server({ managementKind: 'local' }))).toBe(false);
    }
  });
});
