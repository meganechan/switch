import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Field, FieldDescription, FieldTitle } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import { log } from '@renderer/utils/logger';
import type { Agent } from '@shared/core/agents/agents';

/**
 * Per-agent local/remote connection control (CHOO-1059). A remote agent runs
 * its sessions on an SSH host (resolved from `~/.ssh/config`) so it keeps
 * working and listening to its Switch rooms while switchdash is closed.
 * Toggling to remote reveals the SSH host + remote working dir; both are
 * required before the connection is saved. Saving remote also copies the
 * agent's Switch credentials to the host (option A); "Set up host" re-runs that
 * copy on demand. A connectivity/dependency preflight still runs when a remote
 * session is first provisioned.
 */
export function ConnectionSettingsSection({ projectId }: { projectId: string }) {
  const { data: agents } = useQuery({
    queryKey: ['project-agents', projectId],
    queryFn: () => rpc.agents.getAgents(projectId),
  });

  const list = agents ?? [];
  if (list.length === 0) return null;

  return (
    <Field>
      <FieldTitle>Run location</FieldTitle>
      <FieldDescription className="text-foreground-muted">
        Run an agent on a remote SSH host instead of this machine. A remote agent keeps working and
        listening to its Switch rooms even while switchdash is closed.
      </FieldDescription>
      <div className="flex flex-col gap-2">
        {list.map((agent) => (
          <ConnectionRow key={agent.id} projectId={projectId} agent={agent} />
        ))}
      </div>
    </Field>
  );
}

function ConnectionRow({ projectId, agent }: { projectId: string; agent: Agent }) {
  const queryClient = useQueryClient();
  const isRemote = agent.connection === 'remote';

  // Onboarded remote hosts drive the host picker so an agent is pointed at a
  // managed host (Settings → Remote hosts) rather than an arbitrary alias.
  const { data: remoteHosts } = useQuery({
    queryKey: ['remote-hosts'],
    queryFn: () => rpc.remoteHosts.listHosts(),
  });
  const onboardedHosts = remoteHosts ?? [];

  const [showRemote, setShowRemote] = useState(isRemote);
  const [sshHost, setSshHost] = useState(agent.remoteConfig?.sshHost ?? '');
  const [remoteRepoDir, setRemoteRepoDir] = useState(agent.remoteConfig?.remoteRepoDir ?? '');

  // Re-sync local form state when the agent record changes (e.g. after a save
  // invalidates the agents query and a fresh row arrives).
  useEffect(() => {
    setShowRemote(agent.connection === 'remote');
    setSshHost(agent.remoteConfig?.sshHost ?? '');
    setRemoteRepoDir(agent.remoteConfig?.remoteRepoDir ?? '');
  }, [agent.connection, agent.remoteConfig?.sshHost, agent.remoteConfig?.remoteRepoDir]);

  // Copies the agent's Switch creds to the host (CHOO-1059, option A). Runs
  // automatically right after the connection is saved remote, and can be re-run
  // manually (e.g. once the host is reachable, or after rotating creds).
  const setupMutation = useMutation({
    mutationFn: () => rpc.agents.setupRemoteAgent({ agentId: agent.id }),
    onError: (error) => {
      log.error('Failed to set up remote agent host', { agentId: agent.id, error });
    },
  });

  const mutation = useMutation({
    mutationFn: (params: Parameters<typeof rpc.agents.setAgentConnection>[0]) =>
      rpc.agents.setAgentConnection(params),
    onError: (error) => {
      log.error('Failed to update agent connection', { agentId: agent.id, error });
    },
    onSuccess: (_data, variables) => {
      if (variables.connection === 'remote') setupMutation.mutate();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['project-agents', projectId] });
    },
  });

  const onToggle = (checked: boolean) => {
    setShowRemote(checked);
    // Switching off persists immediately; switching on waits for a valid host +
    // dir (saved via the Save button) so we never write a half-formed config.
    if (!checked && isRemote) {
      mutation.mutate({ agentId: agent.id, connection: 'local' });
    }
  };

  const trimmedHost = sshHost.trim();
  const trimmedDir = remoteRepoDir.trim();
  const dirty =
    trimmedHost !== (agent.remoteConfig?.sshHost ?? '') ||
    trimmedDir !== (agent.remoteConfig?.remoteRepoDir ?? '');
  const canSave = trimmedHost.length > 0 && trimmedDir.length > 0 && dirty;

  const onSave = () => {
    mutation.mutate({
      agentId: agent.id,
      connection: 'remote',
      remoteConfig: { sshHost: trimmedHost, remoteRepoDir: trimmedDir },
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border px-2 py-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm">{agent.name}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-foreground-muted">{showRemote ? 'Remote' : 'Local'}</span>
          <Switch checked={showRemote} disabled={mutation.isPending} onCheckedChange={onToggle} />
        </div>
      </div>

      {showRemote && (
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`ssh-host-${agent.id}`} className="text-xs">
              SSH host
            </Label>
            <FieldDescription className="text-foreground-muted">
              {onboardedHosts.length > 0
                ? 'An onboarded remote host (manage them in Settings → Remote hosts).'
                : "A Host alias from your ~/.ssh/config — the same name you'd pass to ssh."}
            </FieldDescription>
            {onboardedHosts.length > 0 ? (
              <Select
                value={sshHost}
                onValueChange={(v) => setSshHost(v ?? '')}
                disabled={mutation.isPending}
              >
                <SelectTrigger id={`ssh-host-${agent.id}`}>
                  <SelectValue placeholder="Select a host" />
                </SelectTrigger>
                <SelectContent>
                  {onboardedHosts.map((host) => (
                    <SelectItem key={host.sshHost} value={host.sshHost}>
                      {host.name} ({host.sshHost})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={`ssh-host-${agent.id}`}
                value={sshHost}
                placeholder="dev-vm"
                disabled={mutation.isPending}
                onChange={(e) => setSshHost(e.target.value)}
              />
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`remote-dir-${agent.id}`} className="text-xs">
              Remote working directory
            </Label>
            <Input
              id={`remote-dir-${agent.id}`}
              value={remoteRepoDir}
              placeholder="/home/agent/repo"
              disabled={mutation.isPending}
              onChange={(e) => setRemoteRepoDir(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            {isRemote && !dirty && (
              <Button
                size="sm"
                variant="outline"
                disabled={setupMutation.isPending || mutation.isPending}
                onClick={() => setupMutation.mutate()}
              >
                {setupMutation.isPending ? 'Setting up…' : 'Set up host'}
              </Button>
            )}
            <Button
              size="sm"
              disabled={!canSave || mutation.isPending || setupMutation.isPending}
              onClick={onSave}
            >
              {isRemote ? 'Update' : 'Save'}
            </Button>
          </div>
          {setupMutation.isError && (
            <p className="text-destructive text-xs">
              Host setup failed: {(setupMutation.error as Error).message}
            </p>
          )}
          {setupMutation.isSuccess && !setupMutation.isPending && (
            <p className="text-xs text-foreground-muted">
              Host set up — credentials copied to the remote working directory.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
