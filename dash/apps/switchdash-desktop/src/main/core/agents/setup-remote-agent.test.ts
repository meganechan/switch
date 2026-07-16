import { beforeEach, describe, expect, it, vi } from 'vitest';

const readSwitchAgentCredentials = vi.hoisted(() => vi.fn());
const ensureSshConnected = vi.hoisted(() => vi.fn(async () => ({ isConnected: true })));
const writeRemoteSwitchSettings = vi.hoisted(() => vi.fn(async () => {}));
const SshFileSystemCtor = vi.hoisted(() => vi.fn());

vi.mock('@main/core/switch-rooms/switch-credentials', () => ({ readSwitchAgentCredentials }));
vi.mock('@main/core/ssh/connect/connect-agent-ssh', () => ({ ensureSshConnected }));
vi.mock('./write-remote-switch-settings', () => ({ writeRemoteSwitchSettings }));
vi.mock('@main/core/fs/impl/ssh-fs', () => ({
  SshFileSystem: vi.fn(function (this: { close: () => void }, proxy: unknown, root: unknown) {
    SshFileSystemCtor(proxy, root);
    this.close = vi.fn();
  }),
}));
vi.mock('@main/lib/logger', () => ({ log: { warn: vi.fn() } }));

const { setupRemoteAgent } = await import('./setup-remote-agent');

const REMOTE = { sshHost: 'box', remoteRepoDir: '/home/dev/r' };

describe('setupRemoteAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads local creds and writes them to the remote working dir', async () => {
    readSwitchAgentCredentials.mockResolvedValueOnce({
      agentId: 'a-1',
      apiEndpoint: 'https://switch.example.com',
      token: 'tok',
    });

    await setupRemoteAgent({ remoteConfig: REMOTE, localDir: '/local/proj' });

    expect(readSwitchAgentCredentials).toHaveBeenCalledWith('/local/proj', expect.anything());
    expect(ensureSshConnected).toHaveBeenCalledWith('agent-ssh:box', 'box');
    expect(SshFileSystemCtor).toHaveBeenCalledWith(expect.anything(), '/home/dev/r');
    // token → apiToken mapping for the writer.
    expect(writeRemoteSwitchSettings).toHaveBeenCalledWith(expect.anything(), {
      apiEndpoint: 'https://switch.example.com',
      apiToken: 'tok',
      agentId: 'a-1',
    });
  });

  it('fails loud when the agent has no local creds to copy', async () => {
    readSwitchAgentCredentials.mockResolvedValueOnce(null);

    await expect(
      setupRemoteAgent({ remoteConfig: REMOTE, localDir: '/local/proj' })
    ).rejects.toThrow(/no Switch credentials/);
    expect(writeRemoteSwitchSettings).not.toHaveBeenCalled();
  });
});
