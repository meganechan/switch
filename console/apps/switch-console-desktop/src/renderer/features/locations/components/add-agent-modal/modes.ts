import { useState } from 'react';
import type { AgentProviderId } from '@shared/core/providers/agent-provider-registry';
import { ownerOnlyPolicy } from '@shared/core/switch-servers/owner-policy';
import type { AddressingPolicy } from '@shared/core/switch-servers/switch-servers';

/** Switch agent-name charset, enforced server-side too: lowercase letters,
 * digits, `.`, `-`, `_`, starting with a letter or digit. */
export const AGENT_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function usePickMode() {
  const [path, setPath] = useState('');
  const [serverId, setServerId] = useState<string | null>(null);
  const [providerId, setProviderId] = useState<AgentProviderId | null>(null);

  return {
    path,
    handlePathChange: setPath,
    serverId,
    setServerId,
    providerId,
    setProviderId,
  };
}

export type PickModeState = ReturnType<typeof usePickMode>;

/**
 * Form state for creating a brand-new Switch agent in a directory. Collects the
 * Switch agent name and description (advanced definition attributes are gathered
 * separately in the Advanced section). Switch Console always registers the agent
 * as a managed, session-addressable identity — there is no run-mode or
 * notify-handle choice (CHOO-1440).
 *
 * Neither field is derived from the working directory. The name is how the
 * agent is addressed in rooms and the description is what other people read to
 * know what it is for; a directory basename answers neither question, and
 * rewriting both when the directory changed moved text the user had already
 * looked at and accepted.
 */
export function useConfigureAgentForm(defaultAutoApprove: boolean) {
  const [agentName, setAgentName] = useState('');
  const [description, setDescription] = useState('');
  const [autoSession, setAutoSession] = useState(true);
  const [autoApprove, setAutoApprove] = useState(defaultAutoApprove);
  // Scoped addressing policy (CHOO-1585). null = open; a new agent starts
  // owner-scoped (CHOO-2137). Applied via a follow-up PUT after creation.
  const [addressingPolicy, setAddressingPolicy] = useState<AddressingPolicy | null>(() =>
    ownerOnlyPolicy()
  );

  const nameIsValid = AGENT_NAME_PATTERN.test(agentName);
  const isValid = nameIsValid && description.trim().length > 0;

  return {
    agentName,
    setAgentName,
    nameIsValid,
    description,
    setDescription,
    autoSession,
    setAutoSession,
    autoApprove,
    setAutoApprove,
    addressingPolicy,
    setAddressingPolicy,
    isValid,
  };
}

export type ConfigureAgentFormState = ReturnType<typeof useConfigureAgentForm>;
