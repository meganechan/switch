/**
 * Migration 0041 — deletes leaked / misidentified sessions (CHOO-1440 follow-up).
 *
 * A session used to freeze its agent identity as a `config.agentName` (legacy
 * `subagentName`) tag while its `agent_id` pointed at the wrong agent. Identity
 * now resolves from `agent_id -> agents.definition_name`, so a session whose tag
 * disagrees with its owning agent's definition is unrepairable and is wiped. A
 * healthy session (tag == the owning agent's definition_name) and any untagged
 * session are kept, so live auto-started sessions are not churned.
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

describe('migration 0041: delete diverged tagged sessions', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  afterEach(() => {
    fixture?.close();
  });

  function seedLocation(): void {
    fixture.sqlite
      .prepare(`INSERT INTO locations (id, name, ssh_host, dir) VALUES (?, ?, '', ?)`)
      .run('loc', 'loc', '/tmp/loc');
  }

  function seedAgent(id: string, definitionName: string | null): void {
    fixture.sqlite
      .prepare(
        `INSERT INTO agents (id, location_id, name, provider_id, definition_name) VALUES (?, 'loc', ?, 'claude', ?)`
      )
      .run(id, id, definitionName);
  }

  function seedSession(id: string, agentId: string, config: Record<string, unknown> | null): void {
    fixture.sqlite
      .prepare(`INSERT INTO sessions (id, agent_id, title, config) VALUES (?, ?, ?, ?)`)
      .run(id, agentId, id, config === null ? null : JSON.stringify(config));
  }

  function sessionIds(): string[] {
    return (
      fixture.sqlite.prepare(`SELECT id FROM sessions ORDER BY id`).all() as { id: string }[]
    ).map((r) => r.id);
  }

  it('deletes only sessions whose tag diverges from their owning agent', async () => {
    fixture = await openFixture('empty');
    seedLocation();
    seedAgent('main', 'main'); // definition-backed agent
    seedAgent('orchestrator', 'room-orchestrator'); // another definition-backed agent
    seedAgent('bare', null); // a provider with no definition capability

    // Healthy: tag matches the owning agent's definition_name — kept.
    seedSession('healthy', 'main', { agentName: 'main', autoApprove: true });
    seedSession('healthy-legacy-key', 'orchestrator', { subagentName: 'room-orchestrator' });

    // Broken: owned by the representative ('main') but tagged as another
    // definition — the classic mis-assigned subagent session. Deleted.
    seedSession('mis-assigned', 'main', { agentName: 'room-orchestrator' });

    // Ghost: tagged as a definition whose agent row no longer exists. Deleted.
    seedSession('ghost', 'main', { agentName: 'vanished-agent' });

    // Untagged: nothing to reconcile — kept regardless of the agent's definition.
    seedSession('untagged-def', 'main', { autoApprove: false });
    seedSession('untagged-null-config', 'main', null);
    seedSession('untagged-bare', 'bare', null);

    fixture.sqlite.exec(MIGRATION_SQL);

    expect(sessionIds()).toEqual([
      'healthy',
      'healthy-legacy-key',
      'untagged-bare',
      'untagged-def',
      'untagged-null-config',
    ]);
  });

  it('is a no-op when every tagged session matches its agent', async () => {
    fixture = await openFixture('empty');
    seedLocation();
    seedAgent('main', 'main');
    seedSession('a', 'main', { agentName: 'main' });
    seedSession('b', 'main', null);

    fixture.sqlite.exec(MIGRATION_SQL);

    expect(sessionIds()).toEqual(['a', 'b']);
  });
});
