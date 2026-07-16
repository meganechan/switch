/**
 * Migration 0030 — makes `projects.path` nullable so a remote-only Switch agent
 * (CHOO-1059) can be added without any local directory. Applies all migrations
 * on a fresh schema and asserts the column is nullable and round-trips a
 * null-path row alongside a normal local one.
 */

import { openFixture } from '@tooling/utils/db';
import { isNull } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { projects } from '@main/db/schema';

describe('migration 0030: nullable project path', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  afterEach(() => {
    fixture?.close();
  });

  it('makes the projects.path column nullable', async () => {
    fixture = await openFixture('empty');

    const columns = fixture.sqlite.prepare(`PRAGMA table_info('projects')`).all() as {
      name: string;
      notnull: number;
    }[];
    const pathColumn = columns.find((c) => c.name === 'path');

    expect(pathColumn).toBeDefined();
    expect(pathColumn!.notnull).toBe(0);
  });

  it('round-trips a remote-only project with a null path', async () => {
    fixture = await openFixture('empty');

    await fixture.db.insert(projects).values([
      { id: 'local-1', name: 'Local agent', path: '/home/me/repo' },
      { id: 'remote-1', name: 'Remote agent', path: null },
    ]);

    const nullPathRows = await fixture.db.select().from(projects).where(isNull(projects.path));

    expect(nullPathRows).toHaveLength(1);
    expect(nullPathRows[0]!.id).toBe('remote-1');
    expect(nullPathRows[0]!.path).toBeNull();
  });
});
