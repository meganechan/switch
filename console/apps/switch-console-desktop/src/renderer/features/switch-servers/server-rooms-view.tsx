import { Bot, DoorOpen, MessageSquare, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import type { GuardResult, ViewDefinition } from '@renderer/app/view-registry';
import { agentsStore } from '@renderer/features/locations/stores/agents-store';
import { refreshSidebarRoomState } from '@renderer/features/sidebar/sidebar-tree-data';
import { openRoom } from '@renderer/features/switch-rooms/open-room';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { BridgeIcon, hasBridgeIcon } from '@renderer/lib/components/bridge-icon';
import { bridgePlatformLabel } from '@renderer/lib/components/bridge-platform';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import type { RemoteRoomSummary } from '@shared/core/switch-servers/switch-servers';
import { ServerPage, ServerTableEmpty } from './server-page';
import { ServerSectionTitlebar } from './server-section-titlebar';
import { switchRoomsStore } from './switch-rooms-store';
import { switchServersStore } from './switch-servers-store';

/** Group key for a room with no messaging app behind it. */
const UNBRIDGED = '';

function useServerId(): string {
  return useParams('serverRooms').params.serverId;
}

const ServerRoomsTitlebar = observer(function ServerRoomsTitlebar() {
  return <ServerSectionTitlebar serverId={useServerId()} icon={DoorOpen} label="Your Rooms" />;
});

const ServerRoomsPanel = observer(function ServerRoomsPanel() {
  const serverId = useServerId();
  const server = switchServersStore.servers.find((s) => s.id === serverId);
  const showCreateRoomModal = useShowModal('createRoomModal');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    void refreshSidebarRoomState(false);
  }, [serverId]);

  const rooms = switchRoomsStore.listedRoomsOnServer(serverId);
  const signedOut = switchRoomsStore.serversNotSignedIn.some((s) => s.id === serverId);
  const failed = switchRoomsStore.serversThatFailedToLoad.some((s) => s.id === serverId);

  const query = filter.trim().toLowerCase();
  const matching = query === '' ? rooms : rooms.filter((r) => r.name.toLowerCase().includes(query));
  const groups = groupByMessagingApp(matching);

  return (
    <ServerPage
      title="Your Rooms"
      description={`Rooms on ${server?.name ?? 'this server'}. Create one, see who is in it, and where it is bridged.`}
      action={
        <Button size="sm" disabled={signedOut} onClick={() => showCreateRoomModal({ serverId })}>
          <Plus className="size-4" />
          Create room
        </Button>
      }
    >
      {/* Three ways to have no rows, and only one of them means "there are no
        rooms". Saying that in the other two would send someone off to create a
        room they already have. */}
      {signedOut ? (
        <ServerTableEmpty>
          Sign in to {server?.name ?? 'this server'} to see its rooms.
        </ServerTableEmpty>
      ) : failed ? (
        <ServerTableEmpty>
          This server&apos;s room list could not be read. Refresh from Home to try again.
        </ServerTableEmpty>
      ) : rooms.length === 0 ? (
        <ServerTableEmpty>
          No rooms here yet. Create one to give your agents somewhere to work.
        </ServerTableEmpty>
      ) : (
        <div className="flex flex-col gap-6">
          <SearchInput
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter rooms by name…"
            aria-label="Filter rooms by name"
          />
          {/* The filter finding nothing is not the same as the server having no
            rooms, and the empty state above answers a question this user is not
            asking. */}
          {groups.length === 0 ? (
            <p className="py-2 text-sm text-foreground-muted">
              No room here matches “{filter.trim()}”.
            </p>
          ) : (
            groups.map((group) => (
              <MessagingAppGroup key={group.key} group={group} serverId={serverId} />
            ))
          )}
        </div>
      )}
    </ServerPage>
  );
});

type RoomGroup = {
  key: string;
  label: string;
  bridgeType: string | null;
  rooms: RemoteRoomSummary[];
};

/**
 * Rooms under the messaging app they are reachable in.
 *
 * Which app a room is in is the thing people scan this page for — it decides
 * where a conversation actually happens — so it is the heading rather than a
 * column. Grouped by the bridge's own display name, because a server can have
 * two of the same platform (two Slack workspaces) and calling both "Slack"
 * would merge two different places into one list. Rooms in no app sort last:
 * they are the exception, and leading with them buries the rest.
 */
function groupByMessagingApp(rooms: RemoteRoomSummary[]): RoomGroup[] {
  const groups = new Map<string, RoomGroup>();
  for (const room of rooms) {
    const key = room.bridgeType ? (room.bridgeDisplayName ?? room.bridgeType) : UNBRIDGED;
    const existing = groups.get(key);
    if (existing) {
      existing.rooms.push(room);
      continue;
    }
    groups.set(key, {
      key,
      label: room.bridgeType
        ? (room.bridgeDisplayName ?? bridgePlatformLabel(room.bridgeType))
        : 'No messaging app',
      bridgeType: room.bridgeType ?? null,
      rooms: [room],
    });
  }
  for (const group of groups.values()) {
    group.rooms.sort((a, b) => a.name.localeCompare(b.name));
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === UNBRIDGED) return 1;
    if (b.key === UNBRIDGED) return -1;
    return a.label.localeCompare(b.label);
  });
}

const MessagingAppGroup = observer(function MessagingAppGroup({
  group,
  serverId,
}: {
  group: RoomGroup;
  serverId: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-0.5">
        {hasBridgeIcon(group.bridgeType) ? (
          <BridgeIcon bridgeType={group.bridgeType} size={16} />
        ) : (
          <MessageSquare className="size-4 text-foreground-muted" />
        )}
        <span className="truncate text-sm font-medium text-foreground">{group.label}</span>
        <span className="shrink-0 text-xs text-foreground-muted">
          {group.rooms.length} {group.rooms.length === 1 ? 'room' : 'rooms'}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {group.rooms.map((room) => (
          <RoomCard key={room.id} room={room} serverId={serverId} />
        ))}
      </div>
    </section>
  );
});

const RoomCard = observer(function RoomCard({
  room,
  serverId,
}: {
  room: RemoteRoomSummary;
  serverId: string;
}) {
  const members = switchRoomsStore.localMemberIds(room.id);
  const localAgents = agentsStore
    .agentsOnServer(serverId)
    .filter((agent) => agent.switchAgentId != null && members.includes(agent.switchAgentId));

  return (
    <button
      type="button"
      onClick={() => void openRoom(room.id)}
      className="flex w-full cursor-pointer items-center gap-3 rounded-[10px] border border-border bg-background px-4 py-3 text-left transition-colors hover:border-border-1 hover:bg-background-1"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-foreground">{roomTitle(room)}</span>
        <span className="text-xs text-foreground-muted">
          {room.agentCount} {room.agentCount === 1 ? 'agent' : 'agents'}
        </span>
      </div>

      {/* The agents of this install that are in the room, by the mark of what
        they run. Deliberately not a second count: the number above is the
        server's, other people's agents included, and only these are ones this
        app could open. The tooltip says so rather than leaving two numbers on
        one row disagreeing in silence. */}
      {localAgents.length > 0 && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="flex shrink-0 items-center gap-1.5">
                {localAgents.map((agent) =>
                  agent.providerId ? (
                    <AgentIcon key={agent.id} id={agent.providerId} size={14} />
                  ) : (
                    <Bot key={agent.id} className="size-3.5 text-foreground-muted" />
                  )
                )}
              </span>
            }
          />
          <TooltipContent>
            Your agents here: {localAgents.map((agent) => agent.name).join(', ')}
          </TooltipContent>
        </Tooltip>
      )}
    </button>
  );
});

/**
 * A room's name as it is written where the room actually lives.
 *
 * The `#` is the channel sigil of the apps these rooms are bridged into, and
 * the rooms are listed under those apps — so it says "this is that channel"
 * rather than decorating the name. Added only when the name does not already
 * carry one, and never to a room in no app at all, where there is no channel
 * for it to name.
 */
function roomTitle(room: RemoteRoomSummary): string {
  if (!room.bridgeType || room.name.startsWith('#')) return room.name;
  return `#${room.name}`;
}

export const serverRoomsView = {
  WrapView: ({ children }: { children: React.ReactNode; serverId: string }) => <>{children}</>,
  TitlebarSlot: ServerRoomsTitlebar,
  MainPanel: ServerRoomsPanel,
  canActivate: (params: unknown): GuardResult => {
    const serverId =
      typeof params === 'object' && params !== null
        ? (params as { serverId?: unknown }).serverId
        : undefined;
    if (typeof serverId !== 'string') return { ok: false, redirect: 'home' };
    return { ok: true };
  },
} satisfies ViewDefinition<{ serverId: string }>;
