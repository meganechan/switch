import { useQueryClient, useQuery } from '@tanstack/react-query';
import { ExternalLink, Link2, MessageSquare, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { BridgeIcon, hasBridgeIcon } from '@renderer/lib/components/bridge-icon';
import { bridgePlatformLabel } from '@renderer/lib/components/bridge-platform';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { openExternalUrl } from '@renderer/lib/open-external';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Spinner } from '@renderer/lib/ui/spinner';
import type { LinkedIdentity } from '@shared/core/switch-servers/switch-servers';
import { BundledChatSignIn } from './BundledChatSignIn';
import { switchRoomsStore } from './switch-rooms-store';
import { switchServersStore } from './switch-servers-store';
import { useMyIdentities } from './use-my-identities';

/**
 * The messaging apps bridged to a server, which account in each one is the
 * signed-in user, and — for an admin — the way to connect another
 * (CHOO-1784, CHOO-2137).
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
        Which account in each messaging app is you. Agents you own can be restricted to only answer
        their owner; that rule can recognise you on the apps listed here, and nowhere else.
      </p>

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
        <ul className="mt-3 space-y-2">
          {bridges.map((bridge) => (
            <li key={bridge.id} className="text-sm">
              <div className="flex items-center gap-2">
                {hasBridgeIcon(bridge.type) ? (
                  <BridgeIcon bridgeType={bridge.type} size={16} />
                ) : (
                  <MessageSquare className="size-4 text-foreground-muted" />
                )}
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {bridge.displayName}
                </span>
                {/* Offered only when the link resolves — an older server, or a
                  bridge that is down, reports none, and a button that cannot
                  do anything is worse than no button. */}
                {bridge.homeUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Open ${bridgePlatformLabel(bridge.type)}`}
                    onClick={() =>
                      void openExternalUrl(
                        bridge.homeUrl as string,
                        `Could not open ${bridgePlatformLabel(bridge.type)}`
                      )
                    }
                  >
                    <ExternalLink className="size-3.5" />
                    Open
                  </Button>
                )}
                {bridge.isDefault && <Badge variant="secondary">Default</Badge>}
                {/* Surfaced only when it is NOT active: a bridge that is down
                  cannot back a new room, and the room-creation picker silently
                  omits it, so this is where that becomes visible. */}
                {bridge.status !== 'active' && <Badge variant="destructive">{bridge.status}</Badge>}
              </div>
              {/* Nothing is drawn until the list arrives: "not linked" and
                "not known yet" look identical, and offering to link an account
                the user already has is the more confusing of the two. */}
              {identities !== null && (
                <BridgeIdentityLine
                  serverId={serverId}
                  bridgeId={bridge.id}
                  identity={identities.find((i) => i.bridgeId === bridge.id) ?? null}
                  currentUserId={currentUserId}
                  onReleased={refreshIdentities}
                />
              )}
              {isManaged && bridge.type === 'mattermost' && (
                <BundledChatSignIn serverId={serverId} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});

/**
 * Which account on one bridge is the signed-in user, and the way to link,
 * change or unlink it (CHOO-2137).
 *
 * A secondary line under the bridge name rather than another trailing button:
 * the row already carries Open, a default marker and a status badge, and this
 * is per-user state about the app above it rather than an action on the app.
 * Deliberately quiet — an unlinked account costs nothing until an agent is
 * restricted to its owner, and the addressing editor is where that gets a
 * warning.
 */
function BridgeIdentityLine({
  serverId,
  bridgeId,
  identity,
  currentUserId,
  onReleased,
}: {
  serverId: string;
  bridgeId: string;
  /** The account the signed-in user has claimed on this bridge, or null when
   * they have claimed none here. */
  identity: LinkedIdentity | null;
  currentUserId: string | null;
  onReleased: () => void;
}) {
  const showClaimIdentity = useShowModal('claimIdentityModal');
  const [releasing, setReleasing] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);

  const release = async (identityId: string) => {
    setReleasing(true);
    setReleaseError(null);
    try {
      await rpc.switchServers.releaseBridgeIdentity({
        serverId,
        bridgeId,
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
    <div className="mt-0.5 ml-6 flex flex-wrap items-center gap-x-1 text-xs text-foreground-muted">
      {identity === null ? (
        <>
          <span>You have not linked an account here</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-1 py-0.5 text-xs"
            onClick={() => showClaimIdentity({ serverId, bridgeId })}
          >
            <Link2 className="size-3.5" />
            Link
          </Button>
        </>
      ) : (
        <>
          <span>
            You are <span className="font-medium text-foreground">{handleOf(identity)}</span> here
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-1 py-0.5 text-xs"
            onClick={() => showClaimIdentity({ serverId, bridgeId })}
          >
            Change
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-1 py-0.5 text-xs"
            disabled={releasing}
            onClick={() => void release(identity.id)}
          >
            {releasing ? 'Unlinking…' : 'Unlink'}
          </Button>
        </>
      )}
      {releaseError !== null && <span className="text-destructive">{releaseError}</span>}
    </div>
  );
}

/** The claimed account as a handle. Platforms differ on whether the username
 * they report already carries the sigil, so add one only when it is missing. */
function handleOf(identity: LinkedIdentity): string {
  const username = identity.externalUsername;
  return username.startsWith('@') ? username : `@${username}`;
}
