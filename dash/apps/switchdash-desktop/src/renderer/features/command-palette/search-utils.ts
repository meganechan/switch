import type { SearchItem } from '@shared/core/search';
import type { RemoteRoomSummary } from '@shared/core/switch-servers/switch-servers';

/**
 * Re-ranks FTS5 results by boosting items belonging to the active location.
 * Applied to DB results only — actions are already ordered by context relevance.
 */
export function applyContextAffinity(
  items: SearchItem[],
  context: { locationId?: string }
): SearchItem[] {
  return [...items].sort((a, b) => {
    const boost = (x: SearchItem) =>
      x.locationId === context.locationId && context.locationId != null ? 1 : 0;
    const diff = boost(b) - boost(a);
    // BM25: lower (more negative) is better
    return diff !== 0 ? diff : a.score - b.score;
  });
}

/** Rooms shown for one query. Enough to be useful, few enough that they cannot
 *  crowd out the rest of the palette. */
const ROOM_RESULT_LIMIT = 8;

/**
 * Matches Switch rooms for the palette.
 *
 * Rooms are not in the FTS index — the Switch server owns them and switchdash
 * deliberately does not mirror them into SQLite — so they are matched here
 * against the rooms already loaded in `switchRoomsStore`. Two consequences worth
 * knowing:
 *
 * - Matching is a plain case-insensitive substring, so rooms are findable at one
 *   or two characters, below the trigram tokenizer's three-character floor that
 *   the indexed kinds are subject to.
 * - `score` orders rooms against each other and nothing else. It is an ordinal,
 *   not a BM25 rank, so these items are rendered in their own group rather than
 *   merged into the ranked list — the two number spaces are not comparable and
 *   pretending otherwise would quietly corrupt the ordering of both.
 */
export function matchRooms(rooms: RemoteRoomSummary[], query: string): SearchItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  return rooms
    .flatMap((room) => {
      const name = room.name.toLowerCase();
      const at = name.indexOf(q);
      if (at === -1) return [];
      return [
        {
          kind: 'room' as const,
          id: room.id,
          locationId: null,
          sessionId: null,
          title: room.name,
          subtitle: room.description,
          // A name that starts with the query beats one that merely contains it;
          // ties break on the shorter name, which is the more exact match.
          score: at === 0 ? -room.name.length : 1000 + at,
        },
      ];
    })
    .sort((a, b) => a.score - b.score || a.title.localeCompare(b.title))
    .slice(0, ROOM_RESULT_LIMIT);
}
