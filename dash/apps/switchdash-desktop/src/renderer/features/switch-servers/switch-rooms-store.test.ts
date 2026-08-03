import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteRoomSummary } from '@shared/core/switch-servers/switch-servers';

const listRemoteRooms = vi.hoisted(() => vi.fn());
const serversStore = vi.hoisted(() => ({
  servers: [] as { id: string }[],
  activeServerId: null as string | null,
  isConnected: () => true,
  statusFor: (serverId: string) => ({ user: { id: `user-of-${serverId}` } }),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: { on: vi.fn() },
  rpc: { switchServers: { listRemoteRooms } },
}));
vi.mock('./switch-servers-store', () => ({ switchServersStore: serversStore }));

const { SwitchRoomsStore } = await import('./switch-rooms-store');

function room(id: string, ownerId: string | null, overrides: Partial<RemoteRoomSummary> = {}) {
  return {
    id,
    name: id,
    description: '',
    channelType: 'channel_public',
    agentCount: 0,
    bridgeDisplayName: null,
    bridgeType: null,
    externalChannelUrl: null,
    ownerId,
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } satisfies RemoteRoomSummary;
}

describe('owned rooms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serversStore.servers = [{ id: 'srv-a' }, { id: 'srv-b' }];
    serversStore.activeServerId = null;
  });

  it('lists only rooms owned by that server’s signed-in user, excluding archived ones', async () => {
    listRemoteRooms.mockImplementation(async (serverId: string) =>
      serverId === 'srv-a'
        ? [
            room('mine', 'user-of-srv-a'),
            room('someone-elses', 'user-of-someone-else'),
            room('mine-but-archived', 'user-of-srv-a', { archived: true }),
            room('ownerless', null),
          ]
        : []
    );

    const store = new SwitchRoomsStore();
    await store.loadRoomNames();

    expect(store.ownedRoomsInActiveScope.map((r) => r.id)).toEqual(['mine']);
  });

  it('shows only the active server’s rooms, not every connected server’s', async () => {
    listRemoteRooms.mockImplementation(async (serverId: string) => [
      room(`${serverId}-room`, `user-of-${serverId}`),
    ]);

    const store = new SwitchRoomsStore();
    await store.loadRoomNames();
    serversStore.activeServerId = 'srv-b';

    expect(store.ownedRoomsInActiveScope.map((r) => r.id)).toEqual(['srv-b-room']);
  });

  it('hides nothing when no server is active, matching how locations are scoped', async () => {
    listRemoteRooms.mockImplementation(async (serverId: string) => [
      room(`${serverId}-room`, `user-of-${serverId}`),
    ]);

    const store = new SwitchRoomsStore();
    await store.loadRoomNames();

    expect(store.ownedRoomsInActiveScope.map((r) => r.id)).toEqual(['srv-a-room', 'srv-b-room']);
  });

  it('keeps a server that failed to respond from dropping the others', async () => {
    listRemoteRooms.mockImplementation(async (serverId: string) => {
      if (serverId === 'srv-a') throw new Error('unreachable');
      return [room('srv-b-room', 'user-of-srv-b')];
    });

    const store = new SwitchRoomsStore();
    await store.loadRoomNames();

    expect(store.ownedRoomsInActiveScope.map((r) => r.id)).toEqual(['srv-b-room']);
  });
});
