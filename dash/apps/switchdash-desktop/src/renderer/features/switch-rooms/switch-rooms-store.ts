import { makeAutoObservable, runInAction } from 'mobx';
import { events, rpc } from '@renderer/lib/ipc';
import { sessionRoomChangedChannel } from '@shared/core/switch-rooms/switchRoomEvents';

/**
 * Renderer-side view of which Switch room each live session is connected to.
 * Seeded from the `switchRooms` RPC controller and kept current via the
 * `sessionRoomChangedChannel` event. Connections are runtime-only — a session
 * disappears here when it switches rooms or its session exits.
 */
class SwitchRoomsStore {
  /** conversationId → connected room id. */
  private roomByConversation = new Map<string, string>();
  private loaded = false;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });

    events.on(sessionRoomChangedChannel, ({ conversationId, roomId }) => {
      runInAction(() => {
        if (roomId) this.roomByConversation.set(conversationId, roomId);
        else this.roomByConversation.delete(conversationId);
      });
    });
  }

  /** Load the current connection set once (idempotent). */
  ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    void rpc.switchRooms.getConnections().then((connections) => {
      runInAction(() => {
        for (const { conversationId, roomId } of connections) {
          this.roomByConversation.set(conversationId, roomId);
        }
      });
    });
  }

  /** The room a session is currently connected to, or null. */
  roomForSession(conversationId: string): string | null {
    return this.roomByConversation.get(conversationId) ?? null;
  }
}

export const switchRoomsStore = new SwitchRoomsStore();
