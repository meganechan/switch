import { useQuery } from '@tanstack/react-query';
import { ChevronRight, CircleAlert } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useId, useState } from 'react';
import { InfoTooltip } from '@renderer/features/settings/components/InfoTooltip';
import { AddressingPolicyControl } from '@renderer/features/switch-servers/addressing-policy-control';
import type { OptionItem } from '@renderer/features/switch-servers/addressing-policy-editor';
import { switchServersStore } from '@renderer/features/switch-servers/switch-servers-store';
import { useMyIdentities } from '@renderer/features/switch-servers/use-my-identities';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Field, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';
import type { ConfigureAgentFormState } from './modes';

/**
 * Create form for a new Switch agent in a directory. Collects the target server,
 * Switch agent name, and description, then the managed-session options
 * (auto-session, bypass permissions, addressing policy). Switch Console always
 * registers the agent as a managed, session-addressable identity — there is no
 * run-mode or notify-handle choice (CHOO-1440); advanced definition attributes
 * live in the collapsed Advanced section.
 */
export const ConfigureAgentPanel = observer(function ConfigureAgentPanel({
  form,
  serverId,
  onAddServer,
}: {
  form: ConfigureAgentFormState;
  serverId: string | null;
  onAddServer: () => void;
}) {
  const nameId = useId();
  const descriptionId = useId();
  // Sessions, permissions and addressing are set once and rarely revisited, so
  // they start folded — the identity fields above are what the dialog is for.
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (switchServersStore.servers.length === 0) void switchServersStore.init();
  }, []);

  const servers = switchServersStore.servers;

  // Selector data for the addressing-policy editor, scoped to the chosen server.
  const roomsQuery = useQuery({
    queryKey: ['remote-rooms', serverId],
    queryFn: () => rpc.switchServers.listRemoteRooms(serverId as string),
    enabled: serverId !== null,
  });
  const groupsQuery = useQuery({
    queryKey: ['remote-room-groups', serverId],
    queryFn: () => rpc.switchServers.listRemoteRoomGroups(serverId as string),
    enabled: serverId !== null,
  });
  const usersQuery = useQuery({
    queryKey: ['remote-external-users', serverId],
    queryFn: () => rpc.switchServers.listRemoteExternalUsers(serverId as string),
    enabled: serverId !== null,
  });
  const agentsQuery = useQuery({
    queryKey: ['remote-agents', serverId],
    queryFn: () => rpc.switchServers.listRemoteAgents(serverId as string),
    enabled: serverId !== null,
  });
  const roomOptions: OptionItem[] = (roomsQuery.data ?? []).map((r) => ({
    id: r.id,
    label: r.name,
  }));
  const groupOptions: OptionItem[] = (groupsQuery.data ?? []).map((g) => ({
    id: g.id,
    label: g.name,
  }));
  const userOptions: OptionItem[] = (usersQuery.data ?? []).map((u) => ({
    id: u.id,
    label: u.username,
  }));
  const agentOptions: OptionItem[] = (agentsQuery.data ?? []).map((a) => ({
    id: a.id,
    label: a.name,
  }));

  // Read here rather than inside the editor so the owner-only default can be
  // questioned before the agent exists, not after it has gone quiet.
  const { identities } = useMyIdentities(serverId);

  if (servers.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-border bg-background-1 px-2 py-1.5 text-xs text-foreground-muted">
        <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span>
            No Switch servers are registered yet. Add the server to register this agent on.
          </span>
          <Button variant="outline" size="sm" className="self-start" onClick={onAddServer}>
            Add a server
          </Button>
        </div>
      </div>
    );
  }

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor={nameId}>Agent name</FieldLabel>
        <Input
          id={nameId}
          placeholder="claude-code.my-repo.me"
          value={form.agentName}
          onChange={(e) => form.setAgentName(e.target.value)}
          aria-invalid={form.agentName.length > 0 && !form.nameIsValid}
        />
        {form.agentName.length > 0 && !form.nameIsValid ? (
          <span className="text-destructive text-xs">
            Use lowercase letters, digits, <span className="font-mono">. - _</span>, starting with a
            letter or digit. No spaces or uppercase.
          </span>
        ) : (
          <span className="text-xs text-foreground-muted">
            Visible to everyone in the agent&apos;s rooms — include your name so it&apos;s clear
            which person&apos;s Claude Code this is.
          </span>
        )}
      </Field>

      <Field>
        <FieldLabel htmlFor={descriptionId}>Description</FieldLabel>
        <Input
          id={descriptionId}
          placeholder="Claude Code running in my-repo"
          value={form.description}
          onChange={(e) => form.setDescription(e.target.value)}
        />
      </Field>

      <div className="rounded-md border border-border">
        <button
          type="button"
          className="flex w-full items-center gap-1.5 px-2 py-2 text-sm text-foreground-muted"
          onClick={() => setSettingsOpen((v) => !v)}
        >
          <ChevronRight
            className={cn('h-4 w-4 transition-transform', settingsOpen && 'rotate-90')}
          />
          <span className="text-foreground">Settings</span>
          <span className="ml-auto text-xs">Sessions, permissions, who can address it</span>
        </button>
        {settingsOpen && (
          <FieldGroup className="border-t border-border px-3 py-3">
            <Field>
              <FieldLabel>Switch server</FieldLabel>
              <div className="rounded-md border border-border bg-background-1 px-3 py-1.5 text-sm">
                {serverId
                  ? (servers.find((s) => s.id === serverId)?.name ?? serverId)
                  : 'No server selected'}
              </div>
            </Field>

            <Field>
              <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md border border-border px-2 py-1.5">
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-sm">
                    Auto-create a session on notify
                    <InfoTooltip
                      label="More info about auto-creating a session"
                      content="Switch Console watches this agent's Switch rooms and starts a session — connected to the room and ready to reply — whenever it's addressed with no session running."
                    />
                  </span>
                  <span className="text-xs text-foreground-muted">
                    Start a session when this agent is addressed.
                  </span>
                </span>
                <Switch
                  className="mt-0.5"
                  checked={form.autoSession}
                  onCheckedChange={(checked) => form.setAutoSession(checked)}
                />
              </label>
            </Field>

            <Field>
              <label className="flex cursor-pointer items-start justify-between gap-3 rounded-md border border-border px-2 py-1.5">
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-sm">
                    Bypass permissions
                    <InfoTooltip
                      label="More info about bypassing permissions"
                      content="Sessions start with the provider's auto-approve flag, including ones started automatically. Turn it on only for agents you trust to run unattended."
                    />
                  </span>
                  <span className="text-xs text-foreground-muted">
                    Run this agent&apos;s sessions without permission prompts.
                  </span>
                </span>
                <Switch
                  className="mt-0.5"
                  checked={form.autoApprove}
                  onCheckedChange={(checked) => form.setAutoApprove(checked)}
                />
              </label>
            </Field>

            <Field>
              <FieldLabel>
                <span className="flex items-center gap-1.5">
                  Who can send instructions
                  <InfoTooltip
                    label="More info about addressing"
                    content="Sending instructions means an @mention, a targeted message, or a delegated task. A new agent answers only you; grant other agents to let them delegate to it. You can change this later from the agent's settings."
                  />
                </span>
              </FieldLabel>
              <AddressingPolicyControl
                value={form.addressingPolicy}
                onChange={form.setAddressingPolicy}
                rooms={roomOptions}
                roomGroups={groupOptions}
                users={userOptions}
                agents={agentOptions}
                linkedIdentities={identities}
                // No claim button: this panel is inside a modal, and the app shows one
                // at a time — opening the claim dialog here would throw away the form
                // the user is halfway through. The warning names where to go instead.
                onClaimIdentity={null}
              />
            </Field>
          </FieldGroup>
        )}
      </div>
    </FieldGroup>
  );
});
