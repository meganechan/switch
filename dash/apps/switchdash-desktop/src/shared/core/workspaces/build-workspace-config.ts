import type { WorkspaceConfig } from './workspace-config';

/**
 * Builds the WorkspaceConfig for a session, which always runs in the project's
 * root directory. switchdash has no worktrees: a session uses the project's
 * repository-instance workspace once it is known, falling back to a transient
 * placeholder before the project is mounted and its repositoryWorkspaceId exists.
 */
export function buildRepoRootWorkspaceConfig(repositoryWorkspaceId?: string): WorkspaceConfig {
  if (!repositoryWorkspaceId) {
    return { version: '3', workspace: { kind: 'new-worktree' } };
  }
  return {
    version: '3',
    workspace: { kind: 'repository-instance', workspaceId: repositoryWorkspaceId },
  };
}
