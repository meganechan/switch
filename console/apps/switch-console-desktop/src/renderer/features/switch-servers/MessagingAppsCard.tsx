import { useQueryClient, useQuery } from '@tanstack/react-query';
import {
  CircleAlert,
  ExternalLink,
  Link2,
  MessageSquare,
  MoreVertical,
  Plus,
  Trash2,
  Unlink,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { BridgeIcon, hasBridgeIcon } from '@renderer/lib/components/bridge-icon';
import { bridgePlatformLabel } from '@renderer/lib/components/bridge-platform';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { openExternalUrl } from '@renderer/lib/open-external';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Spinner } from '@renderer/lib/ui/spinner';
import { log } from '@renderer/utils/logger';
import type { LinkedIdentity, RemoteBridge } from '@shared/core/switch-servers/switch-servers';
import { BundledChatSignIn } from './BundledChatSignIn';
import {
  hasUnlinkedMessagingApp,
  unrecognisedMessagingApps,
  unrecognisedMessagingAppsMessage,
} from './messaging-apps-warning';
import { switchRoomsStore } from './switch-rooms-store';
import { switchServersStore } from './switch-servers-store';
import { useMyIdentities } from './use-my-identities';

/**
 * The messaging apps bridged to a server, which account in each one is the
 * signed-in user, and — for an admin — the way to connect another
 * (CHOO-1784, CHOO-2137).
 *
 * One row per app, read as a table: the app on the left, your account on it in
 * a column of its own, its actions on the right. An app you have not linked
 * says so by offering a Link button and nothing else — the fact is worth one
 * control, not a sentence repeated down the card.
 *
 * Listing is offered on every server type, not just managed ones: a bridge is
 * registered through the server's own admin API, so there is nothing
 * Switch Console has to own locally for this to work. Attaching is gated on the
 * signed-in user being an admin, because the endpoint is; linking an account is
 * not, because claiming an identity is something every user does for themselves.
 */
export const MessagingAppsCard = observer(function MessagingAppsCard({
  serverId,
  className,
}: {
  serverId: string;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const showConnectMessagingApp = useShowModal('connectMessagingAppModal');
  const showClaimIdentity = useShowModal('claimIdentityModal');
  const showDisconnectMessagingApp = useShowModal('disconnectMessagingAppModal');
  const isAdmin = switchServersStore.statusFor(serverId)?.user?.role === 'admin';
  // Only a stack Switch Console runs has a chat whose credentials it generated and
  // can therefore show; anyone else's Mattermost is their own to hand out.
  const isManaged = !!switchServersStore.servers.find((s) => s.id === serverId)?.managed;

  const bridgesQuery = useQuery({
    queryKey: ['remote-bridges', serverId],
    queryFn: () => rpc.switchServers.listRemoteBridges(serverId),
    enabled: !!serverId,
  });

  const bridges = bridgesQuery.data ?? [];

  const {
    identities,
    error: identitiesError,
    refresh: refreshIdentities,
  } = useMyIdentities(serverId);
  // Whose claim to drop when unlinking. Every account here is one the signed-in
  // user claimed, and other people may hold the same one — so name the user
  // rather than let the server infer it. Null until the session is read back,
  // where the server falls back to the caller, which is the same person.
  const currentUserId = switchServersStore.statusFor(serverId)?.user?.id ?? null;

  // Whether an unlinked app actually costs this user anything. Asked only once
  // the cheap half of the condition holds — there is an app they have not
  // linked — because a user who has linked everywhere has nothing to be warned
  // about, so the answer would go nowhere. The probe itself is one agent-list
  // read, so it is not cached beyond that: linking an account or changing an
  // agent's policy should stop the warning on the next look, not a minute later.
  const anyUnlinked = hasUnlinkedMessagingApp(bridges, identities);
  const ownerAgentsQuery = useQuery({
    queryKey: ['owns-owner-addressed-agent', serverId],
    queryFn: () => rpc.switchServers.ownsOwnerAddressedAgent(serverId),
    enabled: !!serverId && anyUnlinked,
  });
  // The probe failing costs no data on screen, only the warning — so it is
  // logged rather than shown, and the card does not warn on a guess.
  const ownerAgentsError = ownerAgentsQuery.error;
  useEffect(() => {
    if (ownerAgentsError) {
      log.warn('Could not check for owner-addressed agents', {
        serverId,
        error: ownerAgentsError,
      });
    }
  }, [ownerAgentsError, serverId]);

  const unrecognisedIn = unrecognisedMessagingApps({
    bridges,
    identities,
    ownsOwnerAddressedAgent: ownerAgentsQuery.isSuccess ? ownerAgentsQuery.data : null,
  });

  // Which bridge's channel-creation switch is mid-flight, so only that row
  // disables rather than the whole list, and the surfaced error names the one
  // connection that failed.
  const [savingBridgeId, setSavingBridgeId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const handleToggleChannelCreation = async (bridge: RemoteBridge, enabled: boolean) => {
    setSavingBridgeId(bridge.id);
    setToggleError(null);
    try {
      const result = await rpc.switchServers.updateBridge({
        serverId,
        bridgeId: bridge.id,
        channelCreationEnabled: enabled,
      });
      if (result.kind !== 'updated') {
        setToggleError(`Could not update ${bridge.displayName}: ${messageForUpdate(result)}`);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['remote-bridges', serverId] });
    } catch (cause) {
      setToggleError(
        `Could not update ${bridge.displayName}: ${cause instanceof Error ? cause.message : String(cause)}`
      );
    } finally {
      setSavingBridgeId(null);
    }
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">Messaging apps</h3>
          {bridgesQuery.isLoading && <Spinner className="size-3.5" />}
        </div>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              showConnectMessagingApp({
                serverId,
                onSuccess: ({ bridgeId }) => {
                  // Refresh the bridge list everywhere it is consumed — this
                  // card and the room-creation picker share the query key.
                  void queryClient.invalidateQueries({ queryKey: ['remote-bridges', serverId] });
                  void switchRoomsStore.refreshRoomState();
                  // Step 2 of connecting a workspace: say which account in it
                  // is yours (CHOO-2137). Offered here because this is the one
                  // moment the workspace is on the user's mind, and it is
                  // skippable — the new bridge's own row reopens it later.
                  showClaimIdentity({ serverId, bridgeId });
                },
              })
            }
          >
            <Plus className="size-4" />
            Connect
          </Button>
        )}
      </div>

      <p className="mt-1 text-xs text-foreground-muted">
        Which account is you in each app, so your agents can recognise you.
      </p>

      {/* Same shape as the addressing editor's owner warning, so the two
        readings of one problem look like one problem. */}
      {unrecognisedIn.length > 0 && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-border bg-background-1 px-2 py-1.5 text-xs">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
          <span>{unrecognisedMessagingAppsMessage(unrecognisedIn)}</span>
        </div>
      )}

      {identitiesError !== null && (
        <p className="text-destructive mt-2 text-xs">
          Could not load your linked accounts:{' '}
          {identitiesError instanceof Error ? identitiesError.message : String(identitiesError)}
        </p>
      )}

      {bridgesQuery.isError ? (
        <p className="text-destructive mt-3 text-xs">
          Could not load messaging apps:{' '}
          {bridgesQuery.error instanceof Error
            ? bridgesQuery.error.message
            : String(bridgesQuery.error)}
        </p>
      ) : bridges.length === 0 && !bridgesQuery.isLoading ? (
        <p className="mt-3 text-xs text-foreground-muted">
          {isAdmin
            ? 'No messaging app is connected, so rooms created here would be unreachable. Connect one to get started.'
            : 'No messaging app is connected. An admin on this server can connect one.'}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {bridges.map((bridge) => (
            <MessagingAppRow
              key={bridge.id}
              serverId={serverId}
              bridge={bridge}
              /* Nothing is drawn in the identity column until the list
                arrives: "not linked" and "not known yet" look identical, and
                offering to link an account the user already has is the more
                confusing of the two. */
              identities={identities}
              currentUserId={currentUserId}
              onReleased={refreshIdentities}
              showBundledSignIn={isManaged && bridge.type === 'mattermost'}
              isAdmin={isAdmin}
              savingChannelCreation={savingBridgeId === bridge.id}
              onToggleChannelCreation={(enabled) =>
                void handleToggleChannelCreation(bridge, enabled)
              }
              onDisconnect={() =>
                showDisconnectMessagingApp({
                  serverId,
                  bridgeId: bridge.id,
                  bridgeDisplayName: bridge.displayName,
                  onSuccess: () => {
                    void queryClient.invalidateQueries({
                      queryKey: ['remote-bridges', serverId],
                    });
                    // The rooms on that bridge went with it, so the sidebar is
                    // stale in a way the bridge list alone does not repair.
                    void switchRoomsStore.refreshRoomState();
                  },
                })
              }
            />
          ))}
        </ul>
      )}
      {toggleError && <p className="text-destructive mt-2 text-xs">{toggleError}</p>}
    </div>
  );
});

/**
 * One app: its name, which account on it is the signed-in user, and a menu of
 * everything else.
 *
 * The row states one fact — which account here is you — and offers the one
 * action that changes it. Everything rarer or more dangerous (unlinking,
 * channel creation, disconnecting the app) sits behind the menu, so the common
 * reading is not competing with five controls. The identity column is a fixed
 * width and the trailing controls always occupy their slot, so several apps
 * line up as columns rather than as differently ragged lines.
 */
export function MessagingAppRow({
  serverId,
  bridge,
  identities,
  currentUserId,
  onReleased,
  showBundledSignIn,
  isAdmin,
  savingChannelCreation,
  onToggleChannelCreation,
  onDisconnect,
}: {
  serverId: string;
  bridge: RemoteBridge;
  /** Accounts the user has claimed on this server, or null while unknown. */
  identities: LinkedIdentity[] | null;
  currentUserId: string | null;
  onReleased: () => void;
  showBundledSignIn: boolean;
  isAdmin: boolean;
  savingChannelCreation: boolean;
  onToggleChannelCreation: (enabled: boolean) => void;
  onDisconnect: () => void;
}) {
  const showClaimIdentity = useShowModal('claimIdentityModal');
  const [releasing, setReleasing] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);

  const identity = identities?.find((i) => i.bridgeId === bridge.id) ?? null;
  const platform = bridgePlatformLabel(bridge.type);
  const claim = () => showClaimIdentity({ serverId, bridgeId: bridge.id });

  const release = async (identityId: string) => {
    setReleasing(true);
    setReleaseError(null);
    try {
      await rpc.switchServers.releaseBridgeIdentity({
        serverId,
        bridgeId: bridge.id,
        identityId,
        userId: currentUserId,
      });
      onReleased();
    } catch (cause) {
      setReleaseError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReleasing(false);
    }
  };

  return (
    <li className="py-1 text-sm">
      <div className="flex items-center gap-2">
        {/* The badges belong to the name, so they travel with it rather than
          drifting into the middle of the row on a wide card. */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {hasBridgeIcon(bridge.type) ? (
            <BridgeIcon bridgeType={bridge.type} size={16} />
          ) : (
            <MessageSquare className="size-4 text-foreground-muted" />
          )}
          <span className="truncate text-foreground">{bridge.displayName}</span>
          {bridge.isDefault && <Badge variant="secondary">Default</Badge>}
          {/* Surfaced only when it is NOT active: a bridge that is down cannot
            back a new room, and the room-creation picker silently omits it, so
            this is where that becomes visible. */}
          {bridge.status !== 'active' && <Badge variant="destructive">{bridge.status}</Badge>}
        </div>

        {/* One control in both states, so the column reads as a column: the
          handle when there is one, the invitation to supply it when not. */}
        <div className="flex w-40 shrink-0 items-center justify-end">
          {identities === null ? null : identity === null ? (
            <Button variant="outline" size="xs" onClick={claim}>
              <Link2 className="size-3" />
              Link
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              className="min-w-0 text-foreground-muted"
              title={`Change which ${bridge.displayName} account is you`}
              onClick={claim}
            >
              <span className="truncate">{handleOf(identity)}</span>
            </Button>
          )}
        </div>

        {/* Offered only when the link resolves — an older server, or a bridge
          that is down, reports none, and a button that cannot do anything is
          worse than no button. The slot is held either way so the rows keep a
          straight right edge. */}
        {bridge.homeUrl ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Open ${platform}`}
            title={`Open ${platform}`}
            onClick={() =>
              void openExternalUrl(bridge.homeUrl as string, `Could not open ${platform}`)
            }
          >
            <ExternalLink className="size-3" />
          </Button>
        ) : (
          <span aria-hidden className="size-6 shrink-0" />
        )}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`${bridge.displayName} actions`}
                disabled={releasing}
              >
                {releasing ? <Spinner className="size-3" /> : <MoreVertical className="size-3" />}
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={claim}>
              <Link2 className="size-4" />
              {identity === null ? 'Link my account…' : 'Change my account…'}
            </DropdownMenuItem>
            {identity !== null && (
              <DropdownMenuItem onClick={() => void release(identity.id)}>
                <Unlink className="size-4" />
                Unlink {handleOf(identity)}
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={bridge.canCreateChannels}
              disabled={!isAdmin || !bridge.channelCreationSupported || savingChannelCreation}
              onCheckedChange={(next) => onToggleChannelCreation(next)}
            >
              Can create channels
            </DropdownMenuCheckboxItem>
            {/* A disabled empty tick reads as "off", which is a different
              claim from "this platform cannot do it at all". */}
            {!bridge.channelCreationSupported && (
              <DropdownMenuLabel className="max-w-56 text-xs font-normal text-foreground-muted">
                {platform} cannot create channels from Switch. Make the chat in the app and add the
                bot to it.
              </DropdownMenuLabel>
            )}

            {isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={onDisconnect}>
                  <Trash2 className="size-4" />
                  Disconnect app…
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {releaseError !== null && (
        <p className="text-destructive mt-0.5 ml-6 text-xs">{releaseError}</p>
      )}
      {showBundledSignIn && <BundledChatSignIn serverId={serverId} />}
    </li>
  );
}

/** The claimed account as a handle. Platforms differ on whether the username
 * they report already carries the sigil, so add one only when it is missing. */
function handleOf(identity: LinkedIdentity): string {
  const username = identity.externalUsername;
  return username.startsWith('@') ? username : `@${username}`;
}

/** Turn a failed channel-creation toggle into something the user can act on. */
function messageForUpdate(result: { kind: string; message?: string }): string {
  switch (result.kind) {
    case 'unauthenticated':
      return 'Your session for this server expired. Sign in again, then retry.';
    case 'forbidden':
      return 'This requires an admin account on this server.';
    default:
      return result.message ?? 'The server rejected the change.';
  }
}
