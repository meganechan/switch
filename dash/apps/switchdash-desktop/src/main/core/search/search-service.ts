import { eq } from 'drizzle-orm';
import { db, sqlite } from '@main/db/client';
import { agents, sessions } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { ALL_COMMAND_DEFS } from '@shared/commands';
import type { Agent } from '@shared/core/agents/agents';
import type {
  CommandPaletteQuery,
  SearchItem,
  SearchItemKind,
  SearchResult,
} from '@shared/core/search';
import type { Session } from '@shared/core/sessions/sessions';
import { agentEvents } from '../agents/agent-events';
import { sessionHooks } from '../sessions/session-hooks';
import { sessionService } from '../sessions/session-service';
import { locationFileIndexService } from './location-file-index-service';

type FtsRow = {
  item_type: string;
  item_id: string;
  location_id: string | null;
  session_id: string | null;
  title: string;
  rank: number;
};

type RecentSessionRow = {
  id: string;
  title: string;
  location_id: string;
};

class SearchService {
  initialize(): void {
    sessionService.on('session:created', (session) => this.upsertSession(session));
    sessionService.on('session:updated', (session) => this.upsertSession(session));
    sessionService.on('session:archived', (sessionId) => this.removeByType('session', sessionId));
    sessionService.on('session:deleted', (sessionId) => this.removeByType('session', sessionId));
    // Row deletions outside the sessionService path (e.g. the remote-session
    // reconciler pruning a VM session) must also leave the index.
    sessionHooks.on('session:deleted', (sessionId) => this.removeByType('session', sessionId));

    agentEvents.on('agent:created', (agent) => this.upsertAgent(agent));
    agentEvents.on('agent:updated', (agent) => this.upsertAgent(agent));
    agentEvents.on('agent:deleted', (agentId) => this.removeByType('agent', agentId));

    this.backfill();
    this.seedCommands();
  }

  search({ query, context }: CommandPaletteQuery): SearchResult {
    if (!query.trim()) return { items: this.recents(context), status: 'recents' };

    // Trigram tokenizer requires each term to be at least 3 characters, so
    // shorter terms are dropped. When nothing survives there is no query to
    // run: recents are returned, but reported as recents so the palette can
    // say so rather than presenting them as matches.
    const terms = query
      .trim()
      .split(/[\s\-_]+/)
      .filter((t) => t.length >= 3);

    if (terms.length === 0) {
      return { items: this.recents(context), status: 'query-too-short' };
    }

    const ftsQuery = terms.map((t) => `"${t}"`).join(' AND ');

    let rows: FtsRow[];
    try {
      rows = sqlite
        .prepare(
          `SELECT item_type, item_id, location_id, session_id, title, bm25(search_index) AS rank
           FROM search_index
           WHERE search_index MATCH ?
           ORDER BY rank
           LIMIT 30`
        )
        .all(ftsQuery) as FtsRow[];
    } catch (e) {
      log.error('SearchService: FTS query failed', { query, error: String(e) });
      return { items: [], status: 'failed' };
    }

    const results: SearchItem[] = rows.map((r) => ({
      kind: r.item_type as SearchItemKind,
      id: r.item_id,
      locationId: r.location_id,
      sessionId: r.session_id,
      title: r.title,
      subtitle: '',
      score: r.rank,
    }));

    // Only offered when a session is in context: opening a file navigates to a
    // session, so without one there is nothing to open and the hit would render
    // as a row that silently does nothing when clicked.
    if (context?.locationId && context.sessionId) {
      const fileHits = locationFileIndexService.search(context.locationId, query);
      for (const h of fileHits) {
        results.push({
          kind: 'file',
          id: h.path,
          locationId: context.locationId,
          sessionId: context.sessionId,
          title: h.filename,
          subtitle: h.path,
          score: 0,
        });
      }
    }

    return { items: results, status: 'ok' };
  }

  private recents(context?: CommandPaletteQuery['context']): SearchItem[] {
    const sessionStmt = context?.locationId
      ? sqlite.prepare(
          `SELECT s.id, s.title, a.location_id
           FROM sessions s
           JOIN agents a ON a.id = s.agent_id
           WHERE s.archived_at IS NULL AND a.location_id = ?
           ORDER BY s.last_interacted_at DESC
           LIMIT 10`
        )
      : sqlite.prepare(
          `SELECT s.id, s.title, a.location_id
           FROM sessions s
           JOIN agents a ON a.id = s.agent_id
           WHERE s.archived_at IS NULL
           ORDER BY s.last_interacted_at DESC
           LIMIT 10`
        );

    let sessionRows: RecentSessionRow[];
    try {
      sessionRows = (
        context?.locationId ? sessionStmt.all(context.locationId) : sessionStmt.all()
      ) as RecentSessionRow[];
    } catch (e) {
      log.warn('SearchService: recents query failed', { error: String(e) });
      return [];
    }

    return sessionRows.map((r) => ({
      kind: 'session' as const,
      id: r.id,
      locationId: r.location_id,
      sessionId: null,
      title: r.title,
      subtitle: '',
      score: 0,
    }));
  }

  /**
   * Replace one item's row.
   *
   * Delete-then-insert rather than `INSERT OR REPLACE`: an FTS5 virtual table
   * has no unique constraint for the conflict clause to fire on, so `OR REPLACE`
   * degrades to a plain insert and every update appends a duplicate row instead
   * of superseding the old one.
   */
  private replaceItem(
    itemType: SearchItemKind,
    itemId: string,
    locationId: string | null,
    title: string,
    keywords: string
  ): void {
    sqlite.transaction(() => {
      sqlite
        .prepare(`DELETE FROM search_index WHERE item_id = ? AND item_type = ?`)
        .run(itemId, itemType);
      sqlite
        .prepare(
          `INSERT INTO search_index(item_type, item_id, location_id, session_id, title, keywords)
           VALUES (?, ?, ?, NULL, ?, ?)`
        )
        .run(itemType, itemId, locationId, title, keywords);
    })();
  }

  private upsertSession(session: Session): void {
    try {
      const [agent] = db
        .select({ locationId: agents.locationId })
        .from(agents)
        .where(eq(agents.id, session.agentId))
        .all();
      if (!agent) return;
      this.replaceItem('session', session.id, agent.locationId, session.title, '');
    } catch (e) {
      log.warn('SearchService: upsertSession failed', { sessionId: session.id, error: String(e) });
    }
  }

  private upsertAgent(agent: Agent): void {
    try {
      this.replaceItem('agent', agent.id, agent.locationId, agent.name, agent.providerId);
    } catch (e) {
      log.warn('SearchService: upsertAgent failed', { agentId: agent.id, error: String(e) });
    }
  }

  private removeByType(itemType: string, itemId: string): void {
    try {
      sqlite
        .prepare(`DELETE FROM search_index WHERE item_id = ? AND item_type = ?`)
        .run(itemId, itemType);
    } catch (e) {
      log.warn('SearchService: removeByType failed', { itemType, itemId, error: String(e) });
    }
  }

  private seedCommands(): void {
    try {
      sqlite.transaction(() => {
        sqlite.prepare(`DELETE FROM search_index WHERE item_type = 'command'`).run();
        const stmt = sqlite.prepare(
          `INSERT INTO search_index (item_type, item_id, location_id, session_id, title, keywords)
           VALUES ('command', ?, NULL, NULL, ?, ?)`
        );
        for (const def of ALL_COMMAND_DEFS) {
          stmt.run(def.id, def.label, def.description ?? '');
        }
      })();
      log.info('SearchService: seeded commands', { count: ALL_COMMAND_DEFS.length });
    } catch (e) {
      log.warn('SearchService: seedCommands failed', { error: String(e) });
    }
  }

  private backfill(): void {
    try {
      const count = (
        sqlite.prepare(`SELECT count(*) as n FROM search_index`).get() as { n: number }
      ).n;

      if (count > 0) return;

      const allSessions = db
        .select({
          id: sessions.id,
          locationId: agents.locationId,
          title: sessions.title,
          archivedAt: sessions.archivedAt,
        })
        .from(sessions)
        .innerJoin(agents, eq(sessions.agentId, agents.id))
        .all();
      const allAgents = db
        .select({
          id: agents.id,
          locationId: agents.locationId,
          name: agents.name,
          providerId: agents.providerId,
        })
        .from(agents)
        .all();

      const upsertStmt = sqlite.prepare(
        `INSERT OR REPLACE INTO search_index(item_type, item_id, location_id, session_id, title, keywords)
         VALUES (?, ?, ?, ?, ?, ?)`
      );

      sqlite.transaction(() => {
        for (const t of allSessions) {
          if (t.archivedAt) continue;
          upsertStmt.run('session', t.id, t.locationId, null, t.title, '');
        }
        for (const a of allAgents) {
          upsertStmt.run('agent', a.id, a.locationId, null, a.name, a.providerId);
        }
      })();

      log.info('SearchService: backfilled search index', {
        sessions: allSessions.filter((t) => !t.archivedAt).length,
        agents: allAgents.length,
      });
    } catch (e) {
      log.warn('SearchService: backfill failed', { error: String(e) });
    }
  }
}

export const searchService = new SearchService();
