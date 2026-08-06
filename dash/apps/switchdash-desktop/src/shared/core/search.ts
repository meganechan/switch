/**
 * Two populations, one item shape.
 *
 * `'session' | 'command' | 'file' | 'agent'` come from the SQLite FTS index —
 * high-cardinality local content worth indexing.
 *
 * `'room' | 'server' | 'host'` are matched in the renderer against sets it has
 * already loaded. Rooms are not mirrored into SQLite at all (the Switch server
 * owns them); servers and hosts are local tables, but small ones with no
 * lifecycle events, so indexing them would mean inventing change notifications
 * whose only job is to stop the index going stale. Matching a handful of rows
 * in the renderer is always fresh and has nothing to invalidate.
 */
export type SearchItemKind = 'session' | 'command' | 'file' | 'agent' | 'room' | 'server' | 'host';

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
