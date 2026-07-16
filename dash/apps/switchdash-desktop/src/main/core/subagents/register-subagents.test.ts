import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPlugin = vi.hoisted(() => vi.fn());
const getServer = vi.hoisted(() => vi.fn());
const registerSubagentsBulk = vi.hoisted(() => vi.fn());
const parseSwitchAgentCredentials = vi.hoisted(() => vi.fn());
const readSwitchAgentCredentials = vi.hoisted(() => vi.fn());
const openRemoteSubagentFs = vi.hoisted(() => vi.fn());
const writeSettings = vi.hoisted(() => vi.fn(async () => {}));
const remoteClose = vi.hoisted(() => vi.fn());
const remoteRead = vi.hoisted(() => vi.fn());

vi.mock('@main/core/providers/plugin-registry', () => ({ getPlugin }));
vi.mock('@main/core/providers/plugin-fs', () => ({ createPluginFs: vi.fn() }));
vi.mock('@main/core/switch-servers/servers-store', () => ({ getServer }));
vi.mock('@main/core/switch-servers/gateway-client', () => ({ registerSubagentsBulk }));
vi.mock('@main/core/switch-rooms/switch-credentials', () => ({
  parseSwitchAgentCredentials,
  readSwitchAgentCredentials,
}));
vi.mock('./resolve-workspace', () => ({ openRemoteSubagentFs }));
vi.mock('@main/lib/logger', () => ({ log: { warn: vi.fn(), error: vi.fn() } }));

const { registerSubagentsRemote } = await import('./register-subagents');

const REMOTE = {
  providerId: 'claude',
  serverId: 'srv-1',
  sshHost: 'box',
  remoteRepoDir: '/home/dev/r',
};

describe('registerSubagentsRemote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPlugin.mockReturnValue({ behavior: { subagents: { writeSettings } } });
    getServer.mockResolvedValue({ id: 'srv-1', apiUrl: 'https://switch.example.com' });
    openRemoteSubagentFs.mockResolvedValue({
      fs: { read: remoteRead },
      close: remoteClose,
    });
  });

  it('returns early without connecting when there are no subagents', async () => {
    const result = await registerSubagentsRemote({ ...REMOTE, subagents: [] });
    expect(result).toEqual({ registered: [] });
    expect(openRemoteSubagentFs).not.toHaveBeenCalled();
  });

  it('reads parent creds from the remote settings, registers, writes creds, and closes', async () => {
    remoteRead.mockResolvedValueOnce('{"env":{"SWITCH_AGENT_ID":"sw-parent"}}');
    parseSwitchAgentCredentials.mockReturnValueOnce({
      agentId: 'sw-parent',
      apiEndpoint: 'https://switch.example.com',
      token: 'tok',
    });
    registerSubagentsBulk.mockResolvedValueOnce([
      { subagentName: 'code-reviewer', id: 'child-1', apiKey: 'key-1' },
    ]);

    const result = await registerSubagentsRemote({
      ...REMOTE,
      subagents: [{ name: 'code-reviewer', description: 'reviews' }],
    });

    expect(remoteRead).toHaveBeenCalledWith('.claude/settings.local.json');
    expect(registerSubagentsBulk).toHaveBeenCalledWith(
      expect.objectContaining({ apiUrl: 'https://switch.example.com' }),
      {
        parentAgentId: 'sw-parent',
        subagents: [{ subagentName: 'code-reviewer', description: 'reviews' }],
      }
    );
    expect(writeSettings).toHaveBeenCalledWith(
      { read: remoteRead },
      expect.objectContaining({
        subagentName: 'code-reviewer',
        apiToken: 'key-1',
        agentId: 'child-1',
      })
    );
    expect(result).toEqual({ registered: ['code-reviewer'] });
    expect(remoteClose).toHaveBeenCalledTimes(1);
  });

  it('fails loud (and still closes) when the remote host has no parent creds', async () => {
    remoteRead.mockResolvedValueOnce(null);
    parseSwitchAgentCredentials.mockReturnValueOnce(null);

    await expect(
      registerSubagentsRemote({
        ...REMOTE,
        subagents: [{ name: 'x', description: 'y' }],
      })
    ).rejects.toThrow(/No Switch agent configured/);

    expect(registerSubagentsBulk).not.toHaveBeenCalled();
    expect(remoteClose).toHaveBeenCalledTimes(1);
  });
});
