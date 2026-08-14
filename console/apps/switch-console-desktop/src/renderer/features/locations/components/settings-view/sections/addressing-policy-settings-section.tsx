import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { InfoTooltip } from '@renderer/features/settings/components/InfoTooltip';
import {
  AddressingPolicyEditor,
  type OptionItem,
  policyHasDeadRule,
} from '@renderer/features/switch-servers/addressing-policy-editor';
import { useMyIdentities } from '@renderer/features/switch-servers/use-my-identities';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Field, FieldDescription, FieldTitle } from '@renderer/lib/ui/field';
import { log } from '@renderer/utils/logger';
import type { AddressingPolicy } from '@shared/core/switch-servers/switch-servers';

/**
 * Per-Switch-agent scoped addressing policy (CHOO-1585) — who may address the
 * agent (@mention, targeted message, task delegation). One editor per
 * Switch-linked agent in the location; hidden when the location has none.
 */
export function AddressingPolicySettingsSection({
  locationId,
  agentId,
}: {
  locationId: string;
  /** Scope to a single agent; omit to show every Switch-linked agent. */
  agentId?: string;
}) {
  const { data: agents } = useQuery({
    queryKey: ['location-agents', locationId],
    queryFn: () => rpc.agents.getAgents(locationId),
  });

  const switchAgents = (agents ?? []).filter(
    (a) => a.serverId && a.switchAgentId && (!agentId || a.id === agentId)
  );
  if (switchAgents.length === 0) return null;

  return (
    <Field>
      <FieldTitle>
        <span className="flex items-center gap-1.5">
          Who can address this agent
          <InfoTooltip
            label="More info about addressing"
            content="Addressing means an @mention, a targeted message, or a delegated task. Open allows any room participant; restricted permits only senders matching a rule."
          />
        </span>
      </FieldTitle>
      <FieldDescription className="text-foreground-muted">
        Open to everyone, or restricted to matching senders.
      </FieldDescription>
      <div className="flex flex-col gap-4">
        {switchAgents.map((agent) => (
          <AddressingPolicyRow
            key={agent.id}
            serverId={agent.serverId as string}
            agentId={agent.switchAgentId as string}
            agentName={agent.name}
            showName={switchAgents.length > 1}
          />
        ))}
      </div>
    </Field>
  );
}

function AddressingPolicyRow({
  serverId,
  agentId,
  agentName,
  showName,
}: {
  serverId: string;
  agentId: string;
  agentName: string;
  showName: boolean;
}) {
  const queryClient = useQueryClient();
  const showClaimIdentity = useShowModal('claimIdentityModal');
  const { identities, refresh: refreshIdentities } = useMyIdentities(serverId);
  const [draft, setDraft] = useState<AddressingPolicy | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const policyKey = ['agent-addressing-policy', serverId, agentId];
  const { data: saved } = useQuery({
    queryKey: policyKey,
    queryFn: () => rpc.switchServers.getAddressingPolicy({ serverId, agentId }),
  });
  const rooms = useQuery({
    queryKey: ['remote-rooms', serverId],
    queryFn: () => rpc.switchServers.listRemoteRooms(serverId),
  });
  const groups = useQuery({
    queryKey: ['remote-room-groups', serverId],
    queryFn: () => rpc.switchServers.listRemoteRoomGroups(serverId),
  });
  const users = useQuery({
    queryKey: ['remote-external-users', serverId],
    queryFn: () => rpc.switchServers.listRemoteExternalUsers(serverId),
  });
  const remoteAgents = useQuery({
    queryKey: ['remote-agents', serverId],
    queryFn: () => rpc.switchServers.listRemoteAgents(serverId),
  });

  // Until the user edits, show the saved policy; once dirty, show the draft.
  const value = dirty ? draft : (saved ?? null);

  const mutation = useMutation({
    mutationFn: (policy: AddressingPolicy | null) =>
      rpc.switchServers.updateAddressingPolicy({ serverId, agentId, policy }),
    onSuccess: (_result, policy) => {
      queryClient.setQueryData(policyKey, policy);
      setDirty(false);
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to save policy');
      log.error('Failed to update addressing policy', { agentId, error: err });
    },
  });

  const roomOptions: OptionItem[] = (rooms.data ?? []).map((r) => ({ id: r.id, label: r.name }));
  const groupOptions: OptionItem[] = (groups.data ?? []).map((g) => ({ id: g.id, label: g.name }));
  const userOptions: OptionItem[] = (users.data ?? []).map((u) => ({
    id: u.id,
    label: u.username,
  }));
  const agentOptions: OptionItem[] = (remoteAgents.data ?? []).map((a) => ({
    id: a.id,
    label: a.name,
  }));
  // Prefer the registered Switch agent name over the local directory basename.
  const displayName = agentOptions.find((o) => o.id === agentId)?.label ?? agentName;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      {showName && <span className="text-sm font-medium">{displayName}</span>}
      <AddressingPolicyEditor
        value={value}
        onChange={(next) => {
          setDraft(next);
          setDirty(true);
        }}
        rooms={roomOptions}
        roomGroups={groupOptions}
        users={userOptions}
        agents={agentOptions}
        linkedIdentities={identities}
        onClaimIdentity={() =>
          showClaimIdentity({ serverId, onSuccess: () => refreshIdentities() })
        }
        disabled={mutation.isPending}
      />
      {error && <span className="text-destructive text-xs">{error}</span>}
      <div>
        <Button
          size="sm"
          disabled={!dirty || mutation.isPending || policyHasDeadRule(value)}
          onClick={() => mutation.mutate(value)}
        >
          Save policy
        </Button>
      </div>
    </div>
  );
}
