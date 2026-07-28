import { PlugZap, RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { HostReachability } from '@shared/core/remote-hosts/reachability';
import { hostReachabilityStore } from './host-reachability-store';

function relativeToNow(iso: string | null): string | null {
  if (!iso) return null;
  const deltaMs = new Date(iso).getTime() - Date.now();
  const seconds = Math.round(Math.abs(deltaMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m`;
}

/**
 * The single "this host is down" surface (CHOO-1682). Replaces the raw ssh2
 * message ("Connection lost before handshake") that used to reach the user with
 * the modeled state: what is wrong, that work is paused rather than silently
 * retrying forever, when the next automatic probe lands, and one button to
 * retry now.
 */
export const HostUnreachablePanel = observer(function HostUnreachablePanel({
  reachability,
}: {
  reachability: HostReachability;
}) {
  const { sshHost, status, lastError, nextProbeAt, lastReachableAt } = reachability;
  const retrying = hostReachabilityStore.isRetrying(sshHost) || reachability.probing;
  const nextProbe = relativeToNow(nextProbeAt);
  const lastSeen = relativeToNow(lastReachableAt);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <PlugZap className="h-6 w-6 text-foreground-warning" />
        <p className="font-mono text-sm font-medium text-foreground-warning">
          {status === 'suspended'
            ? `SSH authentication to ${sshHost} failed`
            : `Host ${sshHost} is unreachable`}
        </p>
        {lastError && <p className="font-mono text-xs text-foreground-passive">{lastError}</p>}
        <p className="font-mono text-xs text-foreground-passive">
          {status === 'suspended'
            ? 'Automatic retries are paused — a rejected credential will not fix itself. Fix the host’s SSH access, then retry.'
            : 'Work on this host is paused so it is not retried continuously.'}
          {status !== 'suspended' && nextProbe ? ` Next check in ${nextProbe}.` : ''}
        </p>
        {lastSeen && (
          <p className="font-mono text-xs text-foreground-passive">
            Last reachable {lastSeen} ago.
          </p>
        )}
        <button
          type="button"
          disabled={retrying}
          className="mt-1 inline-flex items-center gap-1.5 text-xs text-foreground-muted underline underline-offset-2 transition-colors hover:text-foreground disabled:opacity-50"
          onClick={() => {
            void hostReachabilityStore.retry(sshHost);
          }}
        >
          <RefreshCw className={retrying ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
          {retrying ? 'Checking…' : 'Retry connection'}
        </button>
      </div>
    </div>
  );
});
