import { detectSwitchAgent } from '@main/core/agents/detect';
import type {
  CreateProjectParams,
  CreateProjectResult,
  InspectProjectPathParams,
  ProjectPathInspection,
} from '@shared/projects';
import { createLocalProject, getLocalProjectPathStatus } from './create-local-project';
import { getLocalProjectByPath } from './getProjects';

export async function createProject(params: CreateProjectParams): Promise<CreateProjectResult> {
  const { type: _type, ...localParams } = params;
  return createLocalProject(localParams);
}

export async function inspectProjectPath(
  params: InspectProjectPathParams
): Promise<ProjectPathInspection> {
  const [status, existingProject, switchAgent] = await Promise.all([
    getLocalProjectPathStatus(params.path),
    getLocalProjectByPath(params.path),
    detectSwitchAgent(params.path),
  ]);

  return { ...status, existingProject, switchAgent };
}
