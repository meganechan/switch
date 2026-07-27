/**
 * Migration 0041 — deletes leaked / misidentified sessions (CHOO-1440 follow-up).
 *
 * A session used to freeze its agent identity as a `config.agentName` (legacy
 * `subagentName`) tag while its `agent_id` pointed at the wrong agent. Identity
 * now resolves from `agent_id -> agents.definition_name`, so every tagged row is
 * unrepairable and is wiped. Plain-agent sessions (no tag) keep their correct
 * `agent_id` and must survive.
 *
 * openFixture('empty') already applied 0041 over an empty dataset (a no-op), so
 * this test seeds representative pre-0041 rows and re-applies the committed
 * migration SQL to assert the transform.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFixture } from '@tooling/utils/db';
import { afterEach, describe, expect, it } from 'vitest';

const MIGRATION_SQL = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../../drizzle/0041_delete_leaked_tagged_sessions.sql'
  ),
  'utf8'
);

describe('migration 0041: delete leaked tagged sessions', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  afterEach(() => {
    fixture?.close();
  });

  function seedLocationAndAgent(): void {
    fixture.sqlite
      .prepare(`INSERT INTO locations (id, name, ssh_host, dir) VALUES (?, ?, '', ?)`)
      .run('loc', 'loc', '/tmp/loc');
    fixture.sqlite
      .prepare(`INSERT INTO agents (id, location_id, name, provider_id) VALUES (?, ?, ?, 'claude')`)
      .run('agent', 'loc', 'agent');
  }

  function seedSession(id: string, config: Record<string, unknown> | null): void {
    fixture.sqlite
      .prepare(`INSERT INTO sessions (id, agent_id, title, config) VALUES (?, 'agent', ?, ?)`)
      .run(id, id, config === null ? null : JSON.stringify(config));
  }

  function sessionIds(): string[] {
    return (
      fixture.sqlite.prepare(`SELECT id FROM sessions ORDER BY id`).all() as { id: string }[]
    ).map((r) => r.id);
  }

  it('deletes sessions carrying an identity tag and keeps the rest', async () => {
    fixture = await openFixture('empty');
    seedLocationAndAgent();

    seedSession('tagged-current', { agentName: 'room-orchestrator', autoApprove: true });
    seedSession('tagged-legacy', { subagentName: 'room-orchestrator' });
    seedSession('plain-with-config', { autoApprove: true });
    seedSession('plain-null-config', null);

    fixture.sqlite.exec(MIGRATION_SQL);

    expect(sessionIds()).toEqual(['plain-null-config', 'plain-with-config']);
  });

  it('is a no-op when there are no tagged sessions', async () => {
    fixture = await openFixture('empty');
    seedLocationAndAgent();
    seedSession('plain', { autoApprove: false });

    fixture.sqlite.exec(MIGRATION_SQL);

    expect(sessionIds()).toEqual(['plain']);
  });
});
