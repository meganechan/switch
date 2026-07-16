import type { Result } from '@switchdash/shared';
import type { AgentRemoteConfig } from '@shared/core/agents/agent-connection';
import type { AgentProviderId } from '@shared/core/providers/agent-provider-registry';
import type { SwitchAgentConfig } from '@shared/switch-agents';

export type ProjectPathStatus = {
  isDirectory: boolean;
};

export type LocalProject = {
  type: 'local';
  id: string;
  name: string;
  /** The local working directory. Null for remote-only agents, whose working
   * directory lives on an SSH host (see the agent's `remoteConfig`). */
  path: string | null;
  /** The workspace ID of this project's repository-root workspace. Set on first mount. */
  repositoryWorkspaceId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Project = LocalProject;

export type CreateLocalProjectParams = {
  type: 'local';
  id?: string;
  /** The local working directory. Omit for a remote agent, which has no local
   * directory — its working directory is `remoteConfig.remoteRepoDir` on the host. */
  path?: string;
  name: string;
  /** The registered Switch server the user chose for this agent. The agent must
   * exist on it — verified server-side at create time. */
  serverId: string;
  /** The agent type (CLI provider) the user picked when onboarding. Persisted on
   * the project's agent row and used to render its agent-type icon. */
  providerId: AgentProviderId;
  /** When set, the new agent runs remotely: its connection is set to `remote`
   * with this config and its Switch credentials are copied to the host. Omit for
   * a local agent (the default). */
  remoteConfig?: AgentRemoteConfig;
};

export type CreateProjectParams = CreateLocalProjectParams;

export type CreateProjectError =
  | { type: 'invalid-directory'; path: string; message: string }
  | { type: 'not-repository'; path: string }
  | { type: 'init-failed'; path: string; message: string }
  | { type: 'open-repository-failed'; path: string; message: string }
  /** The chosen Switch server does not have this agent — the user picked the
   * wrong server, or the directory's `SWITCH_AGENT_ID` isn't registered there. */
  | {
      type: 'switch-agent-not-on-server';
      path: string;
      serverId: string;
      serverName: string;
      agentId: string;
    }
  /** The chosen Switch server is registered but this app is not signed in to it. */
  | {
      type: 'switch-server-unauthenticated';
      path: string;
      serverId: string;
      serverName: string;
    };

export type CreateProjectResult = Result<Project, CreateProjectError>;

export type InspectLocalProjectPathParams = {
  type: 'local';
  path: string;
};

export type InspectProjectPathParams = InspectLocalProjectPathParams;

export type ProjectPathInspection = ProjectPathStatus & {
  existingProject?: Project;
  /**
   * The Switch agent configured in this directory, if any (read from the dir's
   * `.claude/settings.local.json`). switchdash only allows adding directories
   * that resolve a Switch agent. Always `null` for SSH paths in v0.
   */
  switchAgent?: SwitchAgentConfig | null;
};

export type OpenProjectError =
  | { type: 'path-not-found'; path: string }
  | { type: 'error'; message: string };

export type OpenProjectSuccess = {
  repositoryWorkspaceId: string | null;
};

export type UpdateProjectSettingsError =
  | { type: 'project-not-found' }
  | { type: 'invalid-settings' }
  | { type: 'invalid-worktree-directory' }
  | { type: 'write-config-failed'; message: string }
  | { type: 'error' };

export type ProjectRemoteState = {
  hasRemote: boolean;
  selectedRemoteUrl: string | null;
};
