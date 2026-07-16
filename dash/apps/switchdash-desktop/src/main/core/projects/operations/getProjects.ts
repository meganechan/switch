import { desc, eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import type { LocalProject } from '@shared/projects';

function rowToLocalProject(row: typeof projects.$inferSelect): LocalProject {
  return {
    type: 'local' as const,
    id: row.id,
    name: row.name,
    path: row.path,
    repositoryWorkspaceId: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getProjects(): Promise<LocalProject[]> {
  const rows = await db.select().from(projects).orderBy(desc(projects.updatedAt));
  return rows.map(rowToLocalProject);
}

export async function getProjectById(projectId: string): Promise<LocalProject | undefined> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row) return undefined;
  return rowToLocalProject(row);
}

export async function getLocalProjectByPath(path: string): Promise<LocalProject | undefined> {
  const [row] = await db.select().from(projects).where(eq(projects.path, path)).limit(1);
  if (!row) return undefined;
  return rowToLocalProject(row);
}
