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

/**
 * Where a term matched, best first. `null` means "not usefully matched".
 *
 * The FTS index is trigram-tokenised, which matches any substring of three or
 * more characters anywhere in a column. That is far broader than anyone means
 * when they type: "age" matches *Man*age* and *stor*age*, "ion" matches
 * migrat*ion*-bot and Sess*ion*, "rat" matches mig*rat*ion. Every one of those
 * is a hit the index is happy with and a person is not.
 *
 * So the index is treated as a candidate generator and the results are held to
 * a stricter rule: a term must begin a word. That keeps "bot" finding
 * `reviewer-bot` and "ses" finding `New Session`, and drops the mid-word noise.
 *
 * The cost is deliberate and worth stating: a term that starts mid-word no
 * longer matches, so "dash" no longer finds `switchdash`. Precision is bought
 * with recall — there is no setting of this dial that gives both.
 */
export type MatchQuality = 'prefix' | 'word' | null;

/** Characters that separate words for matching. Covers the shapes names take
 *  here: `reviewer-bot`, `gpu_box`, `switch.local`, `host:port`, paths, URLs. */
const WORD_SEPARATORS = /[\s\-_./:@\\]+/;

/** How well `term` matches `text`: at its start, at the start of a word inside
 *  it, or not well enough to offer. */
export function matchQuality(text: string, term: string): MatchQuality {
  const haystack = text.toLowerCase();
  const needle = term.toLowerCase();
  if (!needle) return null;
  if (haystack.startsWith(needle)) return 'prefix';
  return haystack.split(WORD_SEPARATORS).some((word) => word.startsWith(needle)) ? 'word' : null;
}

export interface CommandPaletteQuery {
  query: string;
  context?: {
    sessionId?: string;
    locationId?: string;
  };
}
