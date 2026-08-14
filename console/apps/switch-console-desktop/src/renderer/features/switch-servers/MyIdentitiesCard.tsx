import { CircleAlert, Link2, MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { BridgeIcon, hasBridgeIcon } from '@renderer/lib/components/bridge-icon';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Spinner } from '@renderer/lib/ui/spinner';
import { useMyIdentities } from './use-my-identities';

/**
 * The messaging-app accounts the signed-in user has claimed on this server, and
 * the way to claim or release one (CHOO-2137).
 *
 * This is the durable home for the flow the connect-a-messaging-app modal
 * chains into: that prompt is skippable, so there has to be somewhere to do it
 * later — and somewhere to see what an agent's owner-only rule will actually
 * recognise.
 */
export const MyIdentitiesCard = observer(function MyIdentitiesCard({
  serverId,
  className,
}: {
  serverId: string;
  className?: string;
}) {
  const showClaimIdentity = useShowModal('claimIdentityModal');
  const { identities, isLoading, error, refresh } = useMyIdentities(serverId);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);

  const release = async (identityId: string, bridgeId: string) => {
    setReleasing(identityId);
    setReleaseError(null);
    try {
      await rpc.switchServers.releaseBridgeIdentity({ serverId, bridgeId, identityId });
      refresh();
    } catch (cause) {
      setReleaseError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReleasing(null);
    }
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">Your messaging accounts</h3>
          {isLoading && <Spinner className="size-3.5" />}
        </div>
        <Button variant="outline" size="sm" onClick={() => showClaimIdentity({ serverId })}>
          <Link2 className="size-4" />
          Link an account
        </Button>
      </div>

      <p className="mt-1 text-xs text-foreground-muted">
        Which account in each messaging app is you. Agents you own can be restricted to only answer
        their owner; that rule can recognise you on the apps listed here, and nowhere else.
      </p>

      {error ? (
        <p className="text-destructive mt-3 text-xs">
          Could not load your linked accounts:{' '}
          {error instanceof Error ? error.message : String(error)}
        </p>
      ) : identities !== null && identities.length === 0 ? (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-border bg-background-1 px-2 py-1.5 text-xs">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
          <span>
            No account is linked yet, so an agent restricted to its owner would answer nobody.
          </span>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {(identities ?? []).map((identity) => (
            <li key={identity.id} className="flex items-center gap-2 text-sm">
              {hasBridgeIcon(identity.bridgeType) ? (
                <BridgeIcon bridgeType={identity.bridgeType} size={16} />
              ) : (
                <MessageSquare className="size-4 text-foreground-muted" />
              )}
              <span className="min-w-0 flex-1 truncate text-foreground">
                {identity.externalUsername}
              </span>
              <span className="shrink-0 text-xs text-foreground-muted">
                {identity.bridgeDisplayName}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={releasing !== null}
                onClick={() => void release(identity.id, identity.bridgeId)}
              >
                {releasing === identity.id ? 'Unlinking…' : 'Unlink'}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {releaseError && <p className="text-destructive mt-2 text-xs">{releaseError}</p>}
    </div>
  );
});
