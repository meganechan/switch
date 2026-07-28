import { PlugZap, RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { hostReachabilityStore } from './host-reachability-store';

/**
 * Inline reachability warning for forms that target a remote host — the
 * add-agent modal above all (CHOO-1676). Validating up front means the user
 * learns the host is unreachable while they can still change it, instead of
 * creating an agent that immediately lands in a failing state.
 *
 * Renders nothing when the host is fine, so it can be dropped into a form
 * unconditionally.
 */
export const HostReachabilityNotice = observer(function HostReachabilityNotice({
  sshHost,
}: {
  sshHost: string;
}) {
  // Verify on selection rather than trusting a possibly stale record: the user
  // is about to commit to this host.
  useEffect(() => {
    void hostReachabilityStore.hydrate().then(() => {
      if (hostReachabilityStore.get(sshHost).status !== 'reachable') {
        void hostReachabilityStore.retry(sshHost);
      }
    });
  }, [sshHost]);

  const reachability = hostReachabilityStore.get(sshHost);
  const retrying = hostReachabilityStore.isRetrying(sshHost) || reachability.probing;

  if (retrying) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-foreground-muted">
        <RefreshCw className="h-3 w-3 animate-spin" />
        Checking that {sshHost} is reachable…
      </p>
    );
  }

  if (!hostReachabilityStore.isBlocked(sshHost)) return null;

  return (
    <div className="flex flex-col gap-1 rounded-md border border-border-warning bg-background-warning p-2">
      <p className="flex items-center gap-1.5 text-xs font-medium text-foreground-warning">
        <PlugZap className="h-3.5 w-3.5 shrink-0" />
        {reachability.status === 'suspended'
          ? `SSH authentication to ${sshHost} failed`
          : `Cannot reach ${sshHost}`}
      </p>
      {reachability.lastError && (
        <p className="text-xs text-foreground-passive">{reachability.lastError}</p>
      )}
      <button
        type="button"
        className="self-start text-xs text-foreground-muted underline underline-offset-2 transition-colors hover:text-foreground"
        onClick={() => void hostReachabilityStore.retry(sshHost)}
      >
        Retry
      </button>
    </div>
  );
});
