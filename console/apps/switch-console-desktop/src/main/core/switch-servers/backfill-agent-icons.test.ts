import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentAvatarUrlForName } from '@shared/core/agents/agent-avatar';
import type { RemoteAgentSummary, SwitchServer } from '@shared/core/switch-servers/switch-servers';

const fetchMe = vi.fn();
const fetchAgents = vi.fn();
const updateAgentIcon = vi.fn();

vi.mock('./gateway-client', () => ({
  fetchMe: (...args: unknown[]) => fetchMe(...args),
  fetchAgents: (...args: unknown[]) => fetchAgents(...args),
  updateAgentIcon: (...args: unknown[]) => updateAgentIcon(...args),
}));

vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const ME = 'user-me';

function agent(overrides: Partial<RemoteAgentSummary>): RemoteAgentSummary {
  return {
    id: 'a-1',
    name: 'worker',
    description: '',
    connectorType: 'claude-code',
    ownerId: ME,
    ownerName: 'me',
    knownAgentType: 'claude-code',
    addressingPolicy: null,
    iconUrl: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function server(id: string): SwitchServer {
  return { id } as SwitchServer;
}

/** Re-imported per test: the module remembers which servers it has done, which
 * is the behaviour under test in one case and interference in every other. */
async function loadFresh() {
  vi.resetModules();
  return (await import('./backfill-agent-icons')).backfillAgentIcons;
}

beforeEach(() => {
  fetchMe.mockReset().mockResolvedValue({ id: ME });
  fetchAgents.mockReset().mockResolvedValue([]);
  updateAgentIcon.mockReset().mockResolvedValue(agent({}));
});

describe('backfillAgentIcons', () => {
  it('gives an icon-less agent the avatar its name generates', async () => {
    fetchAgents.mockResolvedValue([agent({ id: 'a-1', name: 'switch_worker' })]);
    const backfill = await loadFresh();

    expect(await backfill(server('s-1'))).toBe(1);
    expect(updateAgentIcon).toHaveBeenCalledWith(
      expect.anything(),
      'a-1',
      agentAvatarUrlForName('switch_worker')
    );
  });

  it('leaves an agent that already has an icon alone', async () => {
    // The whole point of the feature is that a chosen icon is the owner's;
    // overwriting it with a generated one would undo their choice on startup.
    fetchAgents.mockResolvedValue([agent({ iconUrl: 'https://example.com/mine.png' })]);
    const backfill = await loadFresh();

    expect(await backfill(server('s-1'))).toBe(0);
    expect(updateAgentIcon).not.toHaveBeenCalled();
  });

  it("does not touch another user's agent", async () => {
    // Not ours to change, and the gateway would refuse — so asking would just
    // be a failed request per agent per launch.
    fetchAgents.mockResolvedValue([agent({ ownerId: 'someone-else' })]);
    const backfill = await loadFresh();

    expect(await backfill(server('s-1'))).toBe(0);
    expect(updateAgentIcon).not.toHaveBeenCalled();
  });

  it('leaves an unowned agent alone', async () => {
    fetchAgents.mockResolvedValue([agent({ ownerId: null })]);
    const backfill = await loadFresh();

    expect(await backfill(server('s-1'))).toBe(0);
    expect(updateAgentIcon).not.toHaveBeenCalled();
  });

  it('asks the gateway once per server however often it is called', async () => {
    fetchAgents.mockResolvedValue([agent({})]);
    const backfill = await loadFresh();

    await backfill(server('s-1'));
    await backfill(server('s-1'));
    await backfill(server('s-1'));

    expect(updateAgentIcon).toHaveBeenCalledTimes(1);
    expect(fetchAgents).toHaveBeenCalledTimes(1);
  });

  it('does not start a second pass while the first is still running', async () => {
    // Two sidebar refreshes can land together on startup; without this each
    // would see no icons yet and write every agent twice.
    let release = (_: RemoteAgentSummary[]) => {};
    fetchAgents.mockReturnValue(
      new Promise<RemoteAgentSummary[]>((resolve) => {
        release = resolve;
      })
    );
    const backfill = await loadFresh();

    const first = backfill(server('s-1'));
    const second = backfill(server('s-1'));
    release([agent({})]);
    await Promise.all([first, second]);

    expect(fetchAgents).toHaveBeenCalledTimes(1);
    expect(updateAgentIcon).toHaveBeenCalledTimes(1);
  });

  it('tries again after a failed pass', async () => {
    // A server unreachable at startup must not be written off for the rest of
    // the run — otherwise its agents keep the lettered avatar until a restart.
    fetchAgents.mockRejectedValueOnce(new Error('offline'));
    const backfill = await loadFresh();

    await expect(backfill(server('s-1'))).rejects.toThrow('offline');

    fetchAgents.mockResolvedValue([agent({})]);
    expect(await backfill(server('s-1'))).toBe(1);
  });

  it('keeps going when one agent is refused', async () => {
    fetchAgents.mockResolvedValue([
      agent({ id: 'a-1', name: 'one' }),
      agent({ id: 'a-2', name: 'two' }),
      agent({ id: 'a-3', name: 'three' }),
    ]);
    updateAgentIcon.mockRejectedValueOnce(new Error('refused'));
    const backfill = await loadFresh();

    expect(await backfill(server('s-1'))).toBe(2);
    expect(updateAgentIcon).toHaveBeenCalledTimes(3);
  });

  it('handles each server separately', async () => {
    fetchAgents.mockResolvedValue([agent({})]);
    const backfill = await loadFresh();

    await backfill(server('s-1'));
    await backfill(server('s-2'));

    expect(updateAgentIcon).toHaveBeenCalledTimes(2);
  });
});
