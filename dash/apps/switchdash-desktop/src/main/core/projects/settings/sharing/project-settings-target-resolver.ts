import { eq } from 'drizzle-orm';
import type { FileSystemProvider } from '@main/core/fs/types';
import { db } from '@main/db/client';
import { projects as projectsTable } from '@main/db/schema';
import type {
  ProjectSettingsWriteTarget,
  ProjectSettingsWriteTargetOption,
  WriteProjectConfigRequest,
} from '@shared/core/project-settings/project-settings';
import type { ProjectProvider } from '../../project-provider';
import { resolveWorkspace } from '../../utils';

export type ProjectSettingsResolvedTarget = ProjectSettingsWriteTargetOption & {
  fs: FileSystemProvider;
};

function stripTarget(target: ProjectSettingsWriteTargetOption): ProjectSettingsWriteTarget {
  if (target.type === 'project') return { type: 'project' };
  if (target.type === 'session') return { type: 'session', sessionId: target.sessionId };
  return { type: 'workspace', workspaceId: target.workspaceId };
}

export function stripResolvedTarget(
  target: ProjectSettingsResolvedTarget
): ProjectSettingsWriteTargetOption {
  const { fs: _fs, ...option } = target;
  return option;
}

function targetKey(target: ProjectSettingsWriteTarget): string {
  if (target.type === 'project') return 'project';
  if (target.type === 'session') return `session:${target.sessionId}`;
  return `workspace:${target.workspaceId}`;
}

export async function resolveAllProjectSettingsTargets(
  project: ProjectProvider
): Promise<ProjectSettingsResolvedTarget[]> {
  const [projectRow] = await db
    .select({ name: projectsTable.name })
    .from(projectsTable)
    .where(eq(projectsTable.id, project.projectId))
    .limit(1);

  const projectTarget: ProjectSettingsResolvedTarget = {
    type: 'project',
    label: projectRow?.name ?? 'Project repository',
    path: project.repoPath,
    fs: project.fs,
  };
  // Every switchdash session runs in the project root, so there are no
  // session-scoped settings targets distinct from the project target.
  return [projectTarget];
}

export function getProjectSettingsWriteTargets(
  targets: ProjectSettingsResolvedTarget[]
): ProjectSettingsWriteTargetOption[] {
  return targets.map(stripResolvedTarget);
}

export async function resolveProjectSettingsTarget(
  project: ProjectProvider,
  request: Pick<WriteProjectConfigRequest, 'target'>,
  resolvedTargets: ProjectSettingsResolvedTarget[]
): Promise<ProjectSettingsResolvedTarget | null> {
  const target = resolvedTargets.find(
    (candidate) => targetKey(stripTarget(candidate)) === targetKey(request.target)
  );
  if (target) return target;

  if (request.target.type === 'workspace') {
    const workspace = resolveWorkspace(project.projectId, request.target.workspaceId);
    return workspace
      ? {
          type: 'workspace',
          workspaceId: request.target.workspaceId,
          label: 'Workspace',
          path: workspace.path,
          fs: workspace.fs,
        }
      : null;
  }

  return null;
}
