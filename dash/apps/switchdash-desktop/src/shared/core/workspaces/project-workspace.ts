import type { WorkspaceConfig } from './workspace-config';

/**
 * A workspace belonging to a project, as returned by `getProjectWorkspaces`.
 * In switchdash every workspace is the project's root directory.
 */
export type ProjectWorkspace = {
  id: string;
  path: string | null;
  config: WorkspaceConfig | null;
  linesAdded: number | null;
  linesDeleted: number | null;
  /** The session that owns this workspace, if any. Null for the project-root workspace. */
  sessionId: string | null;
  sessionName: string | null;
  /** Whether the workspace is currently acquired in the in-memory registry. */
  isLive: boolean;
  /** Number of non-archived sessions currently linked to this workspace. */
  linkedSessionCount: number;
};
