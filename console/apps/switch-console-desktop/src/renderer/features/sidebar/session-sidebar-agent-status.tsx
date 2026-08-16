import { observer } from 'mobx-react-lite';
import { AgentStatusIndicator } from '@renderer/features/sessions/components/agent-status-indicator';
import { sessionAgentStatus } from '@renderer/features/sessions/stores/session-selectors';
import { type SessionStore } from '@renderer/features/sessions/stores/session-store';
import { useDelayedBoolean } from '@renderer/lib/hooks/use-delay-boolean';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Spinner } from '@renderer/lib/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { getSortInstant, sortKindFor } from './sidebar-store';

/**
 * Sidebar trailing slot: a spinner while the session is being created or its
 * agent is working, otherwise the relative timestamp. The whole metadata
 * cluster is right-aligned by the parent, so the slot just hugs its content —
 * no fixed width to avoid an empty gap between the timestamp and the
 * line-changes / PR icon to its left.
 */
function Slot({ children }: { children: React.ReactNode }) {
  return <span className="flex w-[3ch] shrink-0 items-center justify-end">{children}</span>;
}

export const SessionSidebarTrailingSlot = observer(function SessionSidebarTrailingSlot({
  session,
}: {
  session: SessionStore;
}) {
  const delayedIsBootstrapping = useDelayedBoolean(session.isBootstrapping, 500);

  if (delayedIsBootstrapping) {
    return (
      <Slot>
        <Tooltip>
          <TooltipTrigger>
            <span className="flex size-6 items-center justify-center">
              <Spinner className="size-3.5 text-foreground-muted" />
            </span>
          </TooltipTrigger>
          <TooltipContent>Creating session…</TooltipContent>
        </Tooltip>
      </Slot>
    );
  }

  // Only a working agent takes the slot from the timestamp. The other non-idle
  // states no longer draw anything, so testing for "not idle" here would hand
  // the slot to an indicator that renders nothing and blank the time instead.
  if (sessionAgentStatus(session) === 'working') {
    return (
      <Slot>
        <AgentStatusIndicator status="working" />
      </Slot>
    );
  }

  const instant = getSortInstant(session, sortKindFor(sidebarStore.sessionSortBy));
  if (!instant) return null;

  return (
    <Slot>
      <RelativeTime
        value={instant}
        className="font-mono text-xs text-foreground-passive tabular-nums"
        compact
      />
    </Slot>
  );
});
