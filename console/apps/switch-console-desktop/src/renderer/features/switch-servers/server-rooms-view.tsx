import { DoorOpen, ExternalLink, MoreVertical, Plus, UserPlus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import type { GuardResult, ViewDefinition } from '@renderer/app/view-registry';
import { refreshSidebarRoomState } from '@renderer/features/sidebar/sidebar-tree-data';
import { BridgeIcon, hasBridgeIcon } from '@renderer/lib/components/bridge-icon';
import { bridgePlatformLabel } from '@renderer/lib/components/bridge-platform';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { openExternalUrl } from '@renderer/lib/open-external';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import type { RemoteRoomSummary } from '@shared/core/switch-servers/switch-servers';
import { ServerPage, ServerTable, ServerTableEmpty } from './server-page';
import { ServerSectionTitlebar } from './server-section-titlebar';
import { switchRoomsStore } from './switch-rooms-store';
import { switchServersStore } from './switch-servers-store';

const COLUMNS = [
  { key: 'room', label: 'Room' },
  { key: 'bridge', label: 'Bridged to' },
  { key: 'agents', label: 'Agents', className: 'w-24' },
  { key: 'actions', label: 'Actions', className: 'w-28 text-right' },
] as const;

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

  useEffect(() => {
    void refreshSidebarRoomState(false);
  }, [serverId]);

  const rooms = switchRoomsStore.listedRoomsOnServer(serverId);
  const signedOut = switchRoomsStore.serversNotSignedIn.some((s) => s.id === serverId);
  const failed = switchRoomsStore.serversThatFailedToLoad.some((s) => s.id === serverId);

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
        <ServerTable columns={COLUMNS}>
          {rooms.map((room) => (
            <RoomRow key={room.id} room={room} serverId={serverId} />
          ))}
        </ServerTable>
      )}
    </ServerPage>
  );
});

const RoomRow = observer(function RoomRow({
  room,
  serverId,
}: {
  room: RemoteRoomSummary;
  serverId: string;
}) {
  const { navigate } = useNavigate();
  const showAddAgentsToRoomModal = useShowModal('addAgentsToRoomModal');

  const platform = bridgePlatformLabel(room.bridgeType);
  const gatewayUrl = switchRoomsStore.gatewayRoomUrl(room.id);
  const channelUrl = switchRoomsStore.roomChannelUrl(room.id);

  return (
    <tr className="text-sm">
      <td className="px-3 py-2">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 text-left hover:underline"
          onClick={() => navigate('room', { roomId: room.id })}
        >
          {hasBridgeIcon(room.bridgeType) ? (
            <BridgeIcon bridgeType={room.bridgeType} size={16} className="shrink-0" />
          ) : (
            <DoorOpen className="size-4 shrink-0 text-foreground-muted" />
          )}
          <span className="truncate">{room.name}</span>
        </button>
      </td>

      <td className="truncate px-3 py-2 text-foreground-muted">
        {room.bridgeType ? (room.bridgeDisplayName ?? platform) : 'Not bridged'}
      </td>

      <td className="px-3 py-2 text-foreground-muted">{room.agentCount}</td>

      <td className="px-3 py-2">
        <div className="flex items-center justify-end">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Add agents to ${room.name}`}
                  onClick={() => showAddAgentsToRoomModal({ roomId: room.id })}
                >
                  <Plus className="size-3" />
                </Button>
              }
            />
            <TooltipContent>Add agents</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-xs" aria-label={`${room.name} actions`}>
                  <MoreVertical className="size-3" />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => showAddAgentsToRoomModal({ roomId: room.id })}>
                <UserPlus className="size-4" />
                Add agents…
              </DropdownMenuItem>
              {channelUrl && (
                <DropdownMenuItem
                  onClick={() =>
                    void openExternalUrl(channelUrl, `Could not open the room in ${platform}`)
                  }
                >
                  <ExternalLink className="size-4" />
                  Open in {platform}
                </DropdownMenuItem>
              )}
              {gatewayUrl && (
                <DropdownMenuItem
                  onClick={() =>
                    void rpc.switchServers.openGatewayPage({ serverId, url: gatewayUrl })
                  }
                >
                  <ExternalLink className="size-4" />
                  Open in gateway
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </td>
    </tr>
  );
});

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
