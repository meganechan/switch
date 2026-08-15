import type { ReactNode } from 'react';

/** The lifecycle states a managed stack reports, local or remote. */
export type StackPhase = 'stopped' | 'starting' | 'running' | 'stopping' | 'error' | 'unreachable';

const PHASE_LABEL: Record<StackPhase, string> = {
  stopped: 'Stopped',
  starting: 'Starting',
  running: 'Running',
  stopping: 'Stopping',
  error: 'Error',
  unreachable: 'Host unreachable',
};

const PHASE_DOT: Record<StackPhase, string> = {
  stopped: 'bg-foreground-muted',
  starting: 'bg-amber-500',
  running: 'bg-green-500',
  stopping: 'bg-amber-500',
  error: 'bg-red-500',
  unreachable: 'bg-amber-500',
};

/**
 * The managed stack's own section of a server page — a titled card holding a
 * status line and whatever the stack currently has to say for itself.
 *
 * Shared by the local and remote controls so the two read as the same thing in
 * two places rather than as two features that happen to look alike.
 */
export function StackSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <div className="bg-card divide-y divide-border rounded-lg border border-border">
        {children}
      </div>
    </section>
  );
}

/**
 * Where the stack is and what can be done about it, on one line.
 *
 * `detail` is deliberately terse and monospaced: it is the machine's answer,
 * not a sentence, and it sits beside the state rather than explaining it.
 */
export function StackStatusRow({
  phase,
  detail,
  actions,
}: {
  phase: StackPhase;
  detail: string;
  actions: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-background-tertiary px-2 py-0.5 text-xs text-foreground-muted">
          <span aria-hidden className={`size-1.5 rounded-full ${PHASE_DOT[phase]}`} />
          {PHASE_LABEL[phase]}
        </span>
        <span className="truncate font-mono text-xs text-foreground-muted">{detail}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </div>
  );
}
