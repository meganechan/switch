import { DoorOpen, ExternalLink } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { GuardResult, ViewDefinition } from '@renderer/app/view-registry';
import { switchRoomsStore } from '@renderer/features/switch-servers/switch-rooms-store';
import { BridgeIcon, hasBridgeIcon } from '@renderer/lib/components/bridge-icon';
import { bridgePlatformLabel } from '@renderer/lib/components/bridge-platform';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { TitlebarBreadcrumb } from '@renderer/lib/components/titlebar/titlebar-breadcrumb';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { openRoomChannel } from './room-links';

/**
 * Opens the room's channel in the messaging app it is bridged to. The embedded
 * view is a convenience, not a replacement — threads, search and notifications
 * live in the real client, so there is always a way out to it.
 *
 * Rendered only when the gateway supplied a deeplink; an unbridged room has no
 * messaging app to open, and a button that quietly does nothing is worse than
 * no button.
 */
const OpenInMessagingApp = observer(function OpenInMessagingApp({ roomId }: { roomId: string }) {
  const bridgeType = switchRoomsStore.roomBridgeTypeById(roomId);
  if (!switchRoomsStore.roomChannelUrl(roomId)) return null;

  const platform = bridgePlatformLabel(bridgeType);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="size-7 p-0"
            aria-label={`Open in ${platform}`}
            onClick={() => openRoomChannel(roomId)}
          >
            {hasBridgeIcon(bridgeType) ? (
              <BridgeIcon bridgeType={bridgeType} size={16} className="size-4" />
            ) : (
              <ExternalLink className="size-4" />
            )}
          </Button>
        }
      />
      <TooltipContent side="bottom">Open in {platform}</TooltipContent>
    </Tooltip>
  );
});

/**
 * A room opened on its own is its own root: it belongs to a server and to every
 * agent in it, and picking one of those to stand in front of it would be a
 * claim about how you got here rather than about where you are.
 */
const RoomTitlebar = observer(function RoomTitlebar() {
  const { params } = useParams('room');
  const name = switchRoomsStore.roomNameById(params.roomId);
  const bridgeType = switchRoomsStore.roomBridgeTypeById(params.roomId);

  return (
    <Titlebar
      leftSlot={
        <TitlebarBreadcrumb
          crumbs={[
            {
              key: 'room',
              icon: hasBridgeIcon(bridgeType) ? (
                <BridgeIcon bridgeType={bridgeType} size={14} className="shrink-0" />
              ) : (
                <DoorOpen className="size-3.5 shrink-0" />
              ),
              label: name ?? 'Room',
            },
          ]}
        />
      }
      rightSlot={
        <div className="mr-2 flex items-center gap-1">
          <OpenInMessagingApp roomId={params.roomId} />
        </div>
      }
    />
  );
});

export const roomView = {
  WrapView: ({ children }: { children: React.ReactNode; roomId: string }) => <>{children}</>,
  TitlebarSlot: RoomTitlebar,
  // The conversation itself is drawn by RoomEmbedLayer, which is mounted above
  // the view switch so its <webview> survives navigating away and back.
  MainPanel: () => null,
  canActivate: (params: unknown): GuardResult => {
    const roomId =
      typeof params === 'object' && params !== null
        ? (params as { roomId?: unknown }).roomId
        : undefined;
    if (typeof roomId !== 'string') {
      return { ok: false, redirect: 'home' };
    }
    return { ok: true };
  },
} satisfies ViewDefinition<{ roomId: string }>;
