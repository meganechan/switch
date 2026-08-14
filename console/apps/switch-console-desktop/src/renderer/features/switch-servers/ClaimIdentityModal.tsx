import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Info } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { bridgePlatformLabel } from '@renderer/lib/components/bridge-platform';
import { useDebounce } from '@renderer/lib/hooks/useDebounce';
import { rpc } from '@renderer/lib/ipc';
import { type BaseModalProps, useModalContext } from '@renderer/lib/modal/modal-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Spinner } from '@renderer/lib/ui/spinner';
import type {
  BridgeDirectorySearchResult,
  BridgeDirectoryUser,
  ClaimIdentityResult,
  LinkedIdentity,
} from '@shared/core/switch-servers/switch-servers';
import { switchServersStore } from './switch-servers-store';
import { useMyIdentities } from './use-my-identities';

/** How long to wait after the last keystroke before asking the platform. Every
 * search is a live call out to Slack or Mattermost, so this is a courtesy to
 * their rate limits as much as to ours. */
const SEARCH_DEBOUNCE_MS = 300;

/** Below this the directory returns most of the workspace, which is neither
 * useful to scan nor cheap to fetch. */
const MIN_QUERY_LENGTH = 2;

type ClaimIdentityModalArgs = {
  /** Claim on this server instead of the active one. */
  serverId?: string;
  /** The messaging app to claim an account in. Required: an account is claimed
   * in one workspace, and every entry point knows which one it opened from —
   * asking again would be a question the caller has already answered. */
  bridgeId: string;
};

type Props = BaseModalProps<{ identity: LinkedIdentity }> & ClaimIdentityModalArgs;

/**
 * Link the signed-in Switch user to their own messaging-app account
 * (CHOO-2137).
 *
 * Until Switch knows which platform account is which person, an addressing rule
 * that names an agent's owner can never recognise them — so this is what makes
 * owner-only addressing work at all, and why it is offered straight after a
 * messaging app is connected.
 *
 * The search goes to the platform's own directory rather than Switch's record
 * of who has spoken, so a user can find themselves in a workspace they have
 * never posted in.
 */
export const ClaimIdentityModal = observer(function ClaimIdentityModal({
  serverId: overrideServerId,
  bridgeId,
  onSuccess,
  onClose,
}: Props) {
  const { setCloseGuard } = useModalContext();
  const queryClient = useQueryClient();

  const serverId = overrideServerId ?? switchServersStore.activeServerId ?? '';
  const currentUserId = switchServersStore.statusFor(serverId)?.user?.id ?? null;

  const [search, setSearch] = useState('');
  const [claiming, setClaiming] = useState<string | null>(null);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { identities, refresh: refreshIdentities } = useMyIdentities(serverId || null);

  const bridgesQuery = useQuery({
    queryKey: ['remote-bridges', serverId],
    queryFn: () => rpc.switchServers.listRemoteBridges(serverId),
    enabled: !!serverId,
  });
  const bridges = bridgesQuery.data ?? [];

  // Names the workspace being searched. Null only while the list is in flight
  // or when the named bridge has since been removed — the second is reported
  // rather than searched around.
  const selectedBridge = bridges.find((b) => b.id === bridgeId) ?? null;
  const bridgeIsGone = !bridgesQuery.isLoading && bridges.length > 0 && selectedBridge === null;
  const alreadyLinked = (identities ?? []).find((i) => i.bridgeId === bridgeId) ?? null;

  const debouncedQuery = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS);
  const searchable = !!serverId && debouncedQuery.length >= MIN_QUERY_LENGTH;
  const directoryQuery = useQuery({
    queryKey: ['bridge-directory', serverId, bridgeId, debouncedQuery],
    queryFn: () =>
      rpc.switchServers.searchBridgeDirectory({
        serverId,
        bridgeId,
        query: debouncedQuery,
      }),
    enabled: searchable,
  });

  const handleClaim = async (person: BridgeDirectoryUser) => {
    setClaiming(person.externalUserId);
    setCloseGuard(true);
    setError(null);
    try {
      const result = await rpc.switchServers.claimBridgeIdentity({
        serverId,
        bridgeId,
        externalUserId: person.externalUserId,
        username: person.username,
      });
      if (result.kind !== 'claimed') {
        setError(claimFailureText(result));
        return;
      }
      refreshIdentities();
      onSuccess({ identity: result.identity });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setClaiming(null);
      setCloseGuard(false);
    }
  };

  // Undo, in place: the row the user just linked is the row they look at when
  // they realise it is the wrong account, so the modal stays open and the
  // directory is re-read to show who is left holding the account.
  const handleRelease = async (person: BridgeDirectoryUser) => {
    if (person.knownExternalUserId === null) return;
    setReleasing(person.externalUserId);
    setCloseGuard(true);
    setError(null);
    try {
      await rpc.switchServers.releaseBridgeIdentity({
        serverId,
        bridgeId,
        identityId: person.knownExternalUserId,
        userId: currentUserId,
      });
      refreshIdentities();
      await queryClient.invalidateQueries({ queryKey: ['bridge-directory', serverId, bridgeId] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReleasing(null);
      setCloseGuard(false);
    }
  };

  return (
    <>
      <DialogHeader showCloseButton={false}>
        <DialogTitle>
          Link your {bridgePlatformLabel(selectedBridge?.type)} user account
        </DialogTitle>
      </DialogHeader>
      <DialogContentArea className="pt-0">
        <div className="flex w-full flex-col gap-5">
          <p className="text-xs text-foreground-muted">
            Tell Switch which account is you, so your own agents can tell it&apos;s you.
          </p>

          {!serverId && (
            <p className="text-destructive text-xs">
              No Switch server is selected. Choose a server in the sidebar first.
            </p>
          )}

          {bridgeIsGone && (
            <p className="text-destructive text-xs">
              That messaging app is no longer connected to this server.
            </p>
          )}

          {alreadyLinked && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-background-1 px-2 py-1.5 text-xs">
              <Info className="mt-0.5 size-3.5 shrink-0 text-foreground-muted" />
              <span>
                You are already linked to{' '}
                <span className="font-medium">{alreadyLinked.externalUsername}</span> on{' '}
                {alreadyLinked.bridgeDisplayName}. Linking another account here keeps that one too —
                search for it to unlink it, or use that app&apos;s row on the server page.
              </span>
            </div>
          )}

          {/* The workspace, not the platform: two of them on the same platform
              can be connected, and only the name tells them apart. */}
          <Field>
            <FieldLabel>Search {selectedBridge?.displayName ?? 'the workspace'}</FieldLabel>
            <Input
              autoFocus
              placeholder="Your name, handle or email"
              value={search}
              spellCheck={false}
              onChange={(e) => {
                setSearch(e.target.value);
                setError(null);
              }}
            />
          </Field>

          <DirectoryResults
            query={debouncedQuery}
            searchable={searchable}
            isFetching={directoryQuery.isFetching}
            result={directoryQuery.data ?? null}
            fetchError={directoryQuery.error}
            currentUserId={currentUserId}
            claimingId={claiming}
            releasingId={releasing}
            onClaim={(person) => void handleClaim(person)}
            onRelease={(person) => void handleRelease(person)}
          />

          {error && <p className="text-destructive text-xs">{error}</p>}
        </div>
      </DialogContentArea>
      <DialogFooter>
        {/* Skippable on purpose: this modal interrupts whatever the user came to
            do, and an unlinked account costs them nothing until they restrict an
            agent to its owner. */}
        <Button
          variant="outline"
          onClick={onClose}
          disabled={claiming !== null || releasing !== null}
        >
          Skip for now
        </Button>
      </DialogFooter>
    </>
  );
});

function DirectoryResults({
  query,
  searchable,
  isFetching,
  result,
  fetchError,
  currentUserId,
  claimingId,
  releasingId,
  onClaim,
  onRelease,
}: {
  query: string;
  searchable: boolean;
  isFetching: boolean;
  result: BridgeDirectorySearchResult | null;
  fetchError: unknown;
  currentUserId: string | null;
  /** The platform id of the account being linked, or null when none is. */
  claimingId: string | null;
  /** The platform id of the account being unlinked, or null when none is. */
  releasingId: string | null;
  onClaim: (person: BridgeDirectoryUser) => void;
  onRelease: (person: BridgeDirectoryUser) => void;
}) {
  if (!searchable) {
    return (
      <p className="text-xs text-foreground-muted">
        Type at least {MIN_QUERY_LENGTH} characters to search the workspace directory.
      </p>
    );
  }
  if (fetchError) {
    return (
      <p className="text-destructive text-xs">
        Could not search the directory:{' '}
        {fetchError instanceof Error ? fetchError.message : String(fetchError)}
      </p>
    );
  }
  if (isFetching && result === null) {
    return (
      <p className="flex items-center gap-2 text-xs text-foreground-muted">
        <Spinner className="size-3.5" />
        Searching…
      </p>
    );
  }
  if (result === null) return null;

  // A platform with no directory to search is not an empty result — the server
  // says what has to happen instead, and that is the only useful thing to show.
  if (result.kind === 'unsupported' || result.kind === 'bridge-unavailable') {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-background-1 px-2 py-1.5 text-xs">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
        <span>{result.message}</span>
      </div>
    );
  }
  if (result.kind === 'unauthenticated') {
    return (
      <p className="text-destructive text-xs">
        Your session for this server expired. Sign in again, then retry.
      </p>
    );
  }
  if (result.kind === 'error') {
    return <p className="text-destructive text-xs">{result.message}</p>;
  }
  if (result.users.length === 0) {
    return (
      <p className="text-xs text-foreground-muted">Nobody in this workspace matches “{query}”.</p>
    );
  }

  // Nothing here is disabled because someone else holds the account: several
  // people can be recognised on the same one, and the other claimants are shown
  // so a shared or misidentified account is visible rather than silent.
  const pending = claimingId !== null || releasingId !== null;
  return (
    <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
      {result.users.map((person) => {
        const linkedToMe = person.claimedBy.some((c) => c.userId === currentUserId);
        const others = person.claimedBy.filter((c) => c.userId !== currentUserId);
        return (
          <li
            key={person.externalUserId}
            className="flex items-center justify-between gap-3 rounded-md border border-border p-2"
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm text-foreground">{person.displayName}</span>
              <span className="truncate text-xs text-foreground-muted">
                @{person.username}
                {person.email ? ` · ${person.email}` : ''}
              </span>
              {others.length > 0 && (
                <span className="truncate text-xs text-foreground-muted">
                  Also linked to {others.map((c) => c.userName).join(', ')}
                </span>
              )}
            </div>
            {linkedToMe ? (
              <span className="flex shrink-0 items-center gap-2">
                <Badge variant="secondary">Linked to you</Badge>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending || person.knownExternalUserId === null}
                  onClick={() => onRelease(person)}
                >
                  {releasingId === person.externalUserId ? 'Unlinking…' : 'Unlink'}
                </Button>
              </span>
            ) : (
              <Button size="sm" disabled={pending} onClick={() => onClaim(person)}>
                {claimingId === person.externalUserId ? 'Linking…' : 'This is me'}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Turn a failed claim into something the user can act on. */
function claimFailureText(result: Exclude<ClaimIdentityResult, { kind: 'claimed' }>): string {
  switch (result.kind) {
    case 'unauthenticated':
      return 'Your session for this server expired. Sign in again, then retry.';
    case 'bridge-unavailable':
      return result.message;
    case 'error':
      return result.message;
  }
}
