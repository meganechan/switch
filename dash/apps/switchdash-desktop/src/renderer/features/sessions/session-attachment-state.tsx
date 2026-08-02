import { Loader2, MonitorPlay, RefreshCw, TriangleAlert } from 'lucide-react';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import type { AttachState } from './stores/session-agent-store';

/**
 * What a remote session shows instead of a terminal.
 *
 * Only so many sessions per host keep a terminal open at once — they share one
 * SSH connection, and past a handful the slower tunnels stop answering. A
 * detached session is not stopped: its agent is running on the VM and its
 * status in the sidebar stays live. The copy has to say that, or an empty pane
 * reads as a broken session.
 */
export function SessionAttachmentState({
  state,
  sessionId,
  host,
}: {
  state: Exclude<AttachState, 'attached'>;
  sessionId: string;
  host: string | null;
}) {
  const attach = () => {
    void rpc.sessions.attachSession(sessionId).catch((error: unknown) => {
      log.warn('SessionAttachmentState: attach request failed', { sessionId, error });
    });
  };

  if (state === 'attaching') {
    return (
      <Centered>
        <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
        <p className="font-mono text-xs text-foreground-muted">
          {host ? `Attaching to ${host}…` : 'Attaching…'}
        </p>
      </Centered>
    );
  }

  if (state === 'failed') {
    return (
      <Centered>
        <TriangleAlert className="h-6 w-6 text-foreground-destructive" />
        <p className="font-mono text-sm font-medium text-foreground-destructive">
          Could not open the terminal
        </p>
        <p className="font-mono text-xs text-foreground-muted">
          The agent is still running{host ? ` on ${host}` : ''}. Only this view failed.
        </p>
        <ActionButton onClick={attach} icon={<RefreshCw className="h-3 w-3" />} label="Try again" />
      </Centered>
    );
  }

  return (
    <Centered>
      <MonitorPlay className="h-6 w-6 text-foreground-muted" />
      <p className="font-mono text-sm font-medium">Terminal not attached</p>
      <p className="font-mono text-xs text-foreground-muted">
        This agent is running{host ? ` on ${host}` : ''} and its status stays live. Attach to watch
        it or type to it.
      </p>
      <ActionButton
        onClick={attach}
        icon={<MonitorPlay className="h-3 w-3" />}
        label="Attach terminal"
      />
      <p className="font-mono text-[11px] text-foreground-muted">
        Scrollback from before attaching is not restored.
      </p>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="flex max-w-xs flex-col items-center gap-3 text-center">{children}</div>
    </div>
  );
}

function ActionButton({
  onClick,
  icon,
  label,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      className="mt-1 inline-flex items-center gap-1.5 text-xs text-foreground-muted underline underline-offset-2 transition-colors hover:text-foreground"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
