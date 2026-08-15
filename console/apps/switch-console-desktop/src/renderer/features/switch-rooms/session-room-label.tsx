import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { switchRoomsStore as serverRoomsStore } from '@renderer/features/switch-servers/switch-rooms-store';
import { switchRoomsStore } from './switch-rooms-store';

/**
 * Which Switch room a session is talking in, as the session lists show it.
 *
 * Three answers, deliberately not collapsed into two: the room's name, "No
 * room", and nothing at all. The last covers a failed connection seed or a room
 * list that has not been read — a session whose room could not be looked up
 * must not be reported as being in none, since "no room" is the state someone
 * would go and fix.
 */
export const SessionRoomLabel = observer(function SessionRoomLabel({
  sessionId,
}: {
  sessionId: string;
}) {
  useEffect(() => {
    switchRoomsStore.ensureLoaded();
  }, []);

  if (switchRoomsStore.seedError) return null;

  const roomId = switchRoomsStore.roomForSession(sessionId);
  if (!roomId) {
    return <span className="shrink-0 text-xs text-foreground-passive">No room</span>;
  }

  const name = serverRoomsStore.roomNameById(roomId);
  if (!name) return null;

  return <span className="max-w-32 shrink-0 truncate text-xs text-foreground-muted">{name}</span>;
});
