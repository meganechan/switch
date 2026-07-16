import { observable } from 'mobx';
import { TerminalManagerStore } from '@renderer/features/sessions/terminals/terminal-manager';

export class TerminalRegistry {
  private readonly entries = observable.map<string, TerminalManagerStore>();

  acquire(sessionId: string, projectId: string): TerminalManagerStore {
    const existing = this.entries.get(sessionId);
    if (existing) return existing;
    const store = new TerminalManagerStore(projectId, sessionId);
    this.entries.set(sessionId, store);
    return store;
  }

  get(sessionId: string): TerminalManagerStore | undefined {
    return this.entries.get(sessionId);
  }

  release(sessionId: string): void {
    const store = this.entries.get(sessionId);
    if (!store) return;
    store.dispose();
    this.entries.delete(sessionId);
  }
}

export const terminalRegistry = new TerminalRegistry();
