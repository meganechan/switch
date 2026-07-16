import type { IDisposable } from '@switchdash/shared';
import { makeObservable, observable } from 'mobx';
import type { PtySession } from '@renderer/lib/pty/pty-session';
import { type Terminal } from '@shared/core/terminals/terminals';

/**
 * In switchdash a session is 1:1 with its shell (`session.shellId`) — there is
 * no separate `terminals` table or RPC namespace. This store is retained only so
 * existing consumers (session view context, resource monitor) keep compiling; it
 * holds no terminals and performs no I/O. Per-session PTY hydration is driven by
 * the conversation manager instead.
 */
export class TerminalManagerStore implements IDisposable {
  readonly projectId: string;
  readonly sessionId: string;
  terminals = observable.map<string, TerminalStore>();
  sessions = observable.map<string, PtySession>();

  constructor(projectId: string, sessionId: string) {
    this.projectId = projectId;
    this.sessionId = sessionId;
    makeObservable(this, {
      terminals: observable,
      sessions: observable,
    });
  }

  get isLoaded(): boolean {
    return true;
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      session.destroy();
    }
  }
}

export class TerminalStore {
  data: Terminal;

  constructor(terminal: Terminal) {
    this.data = terminal;
    makeObservable(this, { data: observable });
  }
}
