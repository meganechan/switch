import type { Result } from '@switchdash/shared';
import type { AgentRemoteConfig } from '@shared/core/agents/agent-connection';
import type { AgentProviderId } from '@shared/core/providers/agent-provider-registry';
import type { CreateProjectError } from '@shared/projects';

interface BaseModeData {
  name: string;
  /** Local working directory. Omitted for a remote agent (see `remoteConfig`). */
  path?: string;
}

export interface PickModeData extends BaseModeData {
  mode: 'pick';
  /** The registered Switch server the user chose for this agent. */
  serverId: string;
  /** The agent type (CLI provider) the user picked when onboarding. */
  providerId: AgentProviderId;
  /** When set, the agent runs remotely on this host instead of locally. */
  remoteConfig?: AgentRemoteConfig;
}

export type ModeData = PickModeData;

export type ProjectType = { type: 'local' };

export type ProjectCreationError = CreateProjectError;

export type ProjectCreationCompletion = Result<void, ProjectCreationError>;

export type StartProjectCreationResult =
  | { kind: 'existing'; projectId: string }
  | { kind: 'creating'; projectId: string; completion: Promise<ProjectCreationCompletion> };

export interface StartProjectCreationOptions {
  id?: string;
}
