/**
 * Migration 0028 — adds `connection` + `remote_config_json` to `agents`
 * (CHOO-1059, remote-SSH agents). Applies the migration on top of the
 * pre-0028 fixture and asserts existing rows pick up the `local` default and
 * the new nullable remote-config column.
 */

import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { agents } from '@main/db/schema';

describe('migration 0028: agent connection', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  afterEach(() => {
    fixture?.close();
  });

  it('adds the connection columns to the agents table', async () => {
    fixture = await openFixture('pre-0028');

    const columns = fixture.sqlite.prepare(`PRAGMA table_info('agents')`).all() as {
      name: string;
    }[];
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain('connection');
    expect(columnNames).toContain('remote_config_json');
  });

  it('defaults pre-existing agents to local with no remote config', async () => {
    fixture = await openFixture('pre-0028');

    const rows = await fixture.db.select().from(agents);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.connection).toBe('local');
      expect(row.remoteConfigJson).toBeNull();
    }
  });

  it('round-trips a remote agent config through the versioned column', async () => {
    fixture = await openFixture('pre-0028');

    const [existing] = await fixture.db.select().from(agents).limit(1);
    expect(existing).toBeDefined();

    await fixture.db
      .update(agents)
      .set({
        connection: 'remote',
        remoteConfigJson: { sshHost: 'dev-vm', remoteRepoDir: '/home/agent/repo' },
      })
      .where(eq(agents.id, existing!.id));

    const [updated] = await fixture.db.select().from(agents).where(eq(agents.id, existing!.id));

    expect(updated!.connection).toBe('remote');
    expect(updated!.remoteConfigJson).toEqual({
      sshHost: 'dev-vm',
      remoteRepoDir: '/home/agent/repo',
    });
  });
});
