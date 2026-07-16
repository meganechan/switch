import type { ILifecycle } from '@switchdash/shared';
import { makeAutoObservable, reaction } from 'mobx';
import { log } from '@renderer/utils/logger';
import type { Session } from '@shared/core/sessions/sessions';
import { ConversationHydrationReconciler } from './conversation-hydration-reconciler';
import { conversationRegistry } from './conversation-registry';
import type { SessionStore } from './session-store';

/**
 * A switchdash session is a single `claude` terminal. The switchdash multi-pane
 * workspace (tabs, splits, diff/editor/browser, terminal drawer) has been
 * removed — this view model only keeps the session's one conversation hydrated,
 * which is what connects its PTY. The terminal itself is rendered by
 * `SessionTerminal`.
 */
export class WorkspaceViewModel implements ILifecycle {
  /** Which region of the session view has focus. Kept for the terminal pane. */
  focusedRegion: 'main' | 'bottom' = 'main';

  readonly sessionId: string;

  private readonly _hydration: ConversationHydrationReconciler;
  private _disposers: (() => void)[] = [];
  private _active = false;

  constructor(private readonly _sessionStore: SessionStore) {
    this.sessionId = (_sessionStore.data as Session).id;
    this._hydration = new ConversationHydrationReconciler({
      sessionId: this.sessionId,
      getConversations: () => conversationRegistry.get(this.sessionId),
      log,
    });
    makeAutoObservable<WorkspaceViewModel, '_hydration'>(this, { _hydration: false });
  }

  /** Called when the session becomes provisioned. */
  initialize(): void {
    if (this._active) return;
    this._active = true;

    // Keep every conversation for this session hydrated. Sessions have exactly one,
    // so this connects (and keeps connected) the single claude PTY.
    this._disposers.push(
      reaction(
        () => {
          const conversations = conversationRegistry.get(this.sessionId);
          return conversations ? [...conversations.conversations.keys()].sort() : [];
        },
        (ids) => this._hydration.sync(ids),
        { fireImmediately: true }
      )
    );
  }

  /** Called when the session becomes unprovisioned. */
  suspend(): void {
    for (const dispose of this._disposers) dispose();
    this._disposers = [];
    this._hydration.dispose();
    this._active = false;
  }

  dispose(): void {
    this.suspend();
  }

  setFocusedRegion(region: 'main' | 'bottom'): void {
    this.focusedRegion = region;
  }
}
