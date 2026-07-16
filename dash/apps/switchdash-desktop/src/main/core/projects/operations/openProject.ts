import { err, ok, type Result } from '@switchdash/shared';
import { projectManager } from '@main/core/projects/project-manager';
import type { OpenProjectError, OpenProjectSuccess } from '@shared/projects';
import { checkIsValidDirectory } from '../path-utils';
import { getProjectById } from './getProjects';

export async function openProject(
  projectId: string
): Promise<Result<OpenProjectSuccess, OpenProjectError>> {
  const project = await getProjectById(projectId);
  if (!project) return err({ type: 'error', message: `Project not found: ${projectId}` });
  // Remote-only projects have no local path — their working dir lives on the
  // host, so there is nothing to validate here; provisioning handles the remote.
  if (project.path !== null && !checkIsValidDirectory(project.path)) {
    return err({ type: 'path-not-found', path: project.path });
  }
  const result = await projectManager.openProject(project);
  if (!result.success) {
    return err({ type: 'error', message: result.error.message });
  }

  return ok({ repositoryWorkspaceId: null });
}
