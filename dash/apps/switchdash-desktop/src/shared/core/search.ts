/**
 * `'room'` is produced by the renderer, not the search service: rooms are not
 * mirrored into SQLite (the Switch server is their source of truth), so they are
 * matched against the already-loaded `switchRoomsStore` and rendered through the
 * same item shape as everything else.
 */
export type SearchItemKind = 'session' | 'location' | 'command' | 'file' | 'agent' | 'room';

export interface SearchItem {
  kind: SearchItemKind;
  id: string;
  locationId: string | null;
  sessionId: string | null;
  title: string;
  subtitle: string;
  score: number;
}

/**
 * Why the accompanying items are what they are. Without this the palette cannot
 * tell a result set from a consolation prize: an empty query, a query too short
 * for the trigram tokenizer, and a query whose search failed outright all used
 * to arrive as a bare array and render identically.
 */
export type SearchStatus =
  /** `items` are matches for the query. */
  | 'ok'
  /** No query was entered; `items` are recents, not matches. */
  | 'recents'
  /** A query was entered but no term survived the tokenizer's 3-char minimum;
   *  `items` are recents and must be labelled as such. */
  | 'query-too-short'
  /** The search itself failed; `items` is empty and that is not "no matches". */
  | 'failed';

export interface SearchResult {
  items: SearchItem[];
  status: SearchStatus;
}

export interface CommandPaletteQuery {
  query: string;
  context?: {
    sessionId?: string;
    locationId?: string;
  };
}
