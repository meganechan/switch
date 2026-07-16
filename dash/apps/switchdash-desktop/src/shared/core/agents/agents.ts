import type { AgentConnectionKind, AgentRemoteConfig } from '@shared/core/agents/agent-connection';
import type { AgentProviderId } from '@shared/core/providers/agent-provider-registry';

/**
 * A Switch agent: an agent identity bound to a single provider, living in a
 * project directory. Many agents may share a directory. `switchAgentId` /
 * `apiEndpoint` carry the Switch identity detected from the directory's
 * `.claude/settings.local.json`. `serverId` is the registered Switch server the
 * agent belongs to (resolved from `apiEndpoint`); null means unlinked — the
 * server it points at is not registered in this app.
 */
export type Agent = {
  id: string;
  projectId: string;
  name: string;
  providerId: AgentProviderId;
  switchAgentId: string | null;
  apiEndpoint: string | null;
  serverId: string | null;
  status: string | null;
  /** Where this agent's sessions run. New agents default to `local`. */
  connection: AgentConnectionKind;
  /** SSH host + remote working dir; null unless `connection === 'remote'`. */
  remoteConfig: AgentRemoteConfig | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateAgentParams = {
  id: string;
  projectId: string;
  name: string;
  providerId: AgentProviderId;
  switchAgentId: string | null;
  apiEndpoint: string | null;
  /** The Switch server this agent belongs to. Every agent must have one — it is
   * chosen and verified at onboarding (legacy rows may still be null until the
   * user assigns one). */
  serverId: string;
};

export type RenameAgentParams = {
  agentId: string;
  newName: string;
};
