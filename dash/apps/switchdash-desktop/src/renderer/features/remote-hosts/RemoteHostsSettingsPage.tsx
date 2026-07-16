import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, ChevronRight, Plus, Server, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '@renderer/lib/components/page-header';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Spinner } from '@renderer/lib/ui/spinner';
import { log } from '@renderer/utils/logger';
import { hostSetupQueryKey } from './query-keys';
import { RemoteHostDetail } from './remote-host-detail';

export const REMOTE_HOSTS_QUERY_KEY = ['remote-hosts'];

/** Compact readiness badge for a host row, backed by getHostSetup. */
function HostSetupBadge({ sshHost }: { sshHost: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: hostSetupQueryKey(sshHost),
    queryFn: () => rpc.remoteHosts.getHostSetup(sshHost),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <span className="flex items-center gap-1 text-xs text-foreground-muted">
        <Spinner /> Checking…
      </span>
    );
  }
  if (isError || !data?.reachable) {
    return (
      <span className="flex items-center gap-1 text-xs text-foreground-muted">
        <AlertTriangle className="size-3.5 text-amber-500" /> Unreachable
      </span>
    );
  }
  if (data.ready) {
    return (
      <span className="flex items-center gap-1 text-xs text-green-500">
        <CheckCircle2 className="size-3.5" /> Ready
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-amber-500" title={data.issues.join('; ')}>
      <AlertTriangle className="size-3.5" /> Setup needed
    </span>
  );
}

/**
 * Host-level management surface (switchdash remote host connection management).
 * Lists onboarded SSH hosts; selecting one opens its detail — host tool
 * dependencies and per-agent-type Switch connector plugin status, each with
 * install/update actions. Onboarding picks a `~/.ssh/config` alias; switchdash
 * stores no credentials.
 */
export function RemoteHostsSettingsPage() {
  const queryClient = useQueryClient();
  const [selectedHost, setSelectedHost] = useState<string | null>(null);

  const { data: hosts, isLoading } = useQuery({
    queryKey: REMOTE_HOSTS_QUERY_KEY,
    queryFn: () => rpc.remoteHosts.listHosts(),
  });

  const list = hosts ?? [];

  return (
    <div className="space-y-8 pb-10">
      <PageHeader
        sticky
        title="Remote hosts"
        description="Onboard SSH hosts to run agents remotely. Manage each host's tool dependencies and the Switch connector plugin for every agent type."
      >
        <OnboardHostForm
          onboarded={list.map((h) => h.sshHost)}
          onOnboarded={(sshHost) => {
            void queryClient.invalidateQueries({ queryKey: REMOTE_HOSTS_QUERY_KEY });
            setSelectedHost(sshHost);
          }}
        />
      </PageHeader>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-foreground-muted">
          <Spinner /> Loading hosts…
        </div>
      ) : list.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          No remote hosts onboarded yet. Add one above to get started.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {list.map((host) => (
            <div
              key={host.sshHost}
              className="flex flex-col gap-3 rounded-lg border border-border p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() =>
                    setSelectedHost((cur) => (cur === host.sshHost ? null : host.sshHost))
                  }
                >
                  <ChevronRight
                    className={`size-4 shrink-0 text-foreground-muted transition-transform ${
                      selectedHost === host.sshHost ? 'rotate-90' : ''
                    }`}
                  />
                  <Server className="size-4 shrink-0 text-foreground-muted" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{host.name}</span>
                    <span className="truncate text-xs text-foreground-muted">{host.sshHost}</span>
                  </span>
                </button>
                <HostSetupBadge sshHost={host.sshHost} />
                <RemoveHostButton
                  sshHost={host.sshHost}
                  onRemoved={() => {
                    if (selectedHost === host.sshHost) setSelectedHost(null);
                    void queryClient.invalidateQueries({ queryKey: REMOTE_HOSTS_QUERY_KEY });
                  }}
                />
              </div>
              {selectedHost === host.sshHost && <RemoteHostDetail sshHost={host.sshHost} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OnboardHostForm({
  onboarded,
  onOnboarded,
}: {
  onboarded: string[];
  onOnboarded: (sshHost: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sshHost, setSshHost] = useState('');
  const [name, setName] = useState('');

  const { data: configHosts } = useQuery({
    queryKey: ['ssh-config-hosts'],
    queryFn: () => rpc.remoteHosts.listSshConfigHosts(),
    enabled: open,
  });

  const available = useMemo(
    () => (configHosts ?? []).filter((h) => !onboarded.includes(h)),
    [configHosts, onboarded]
  );

  const mutation = useMutation({
    mutationFn: () => rpc.remoteHosts.onboardHost({ sshHost: sshHost.trim(), name: name.trim() }),
    onError: (error) => log.error('Failed to onboard remote host', { sshHost, error }),
    onSuccess: (host) => {
      setOpen(false);
      setSshHost('');
      setName('');
      onOnboarded(host.sshHost);
    },
  });

  if (!open) {
    return (
      <div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus className="size-4" /> Add host
        </Button>
      </div>
    );
  }

  const canSubmit = sshHost.trim().length > 0 && name.trim().length > 0 && !mutation.isPending;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-col gap-1">
        <Label className="text-xs">SSH host</Label>
        <p className="text-xs text-foreground-muted">
          A Host alias from your ~/.ssh/config. Auth uses your SSH agent — switchdash stores no
          credentials.
        </p>
        {available.length > 0 ? (
          <Select value={sshHost} onValueChange={(v) => setSshHost(v ?? '')}>
            <SelectTrigger>
              <SelectValue placeholder="Select a host alias" />
            </SelectTrigger>
            <SelectContent>
              {available.map((alias) => (
                <SelectItem key={alias} value={alias}>
                  {alias}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={sshHost}
            placeholder="dev-vm"
            onChange={(e) => setSshHost(e.target.value)}
          />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Display name</Label>
        <Input value={name} placeholder="Dev VM" onChange={(e) => setName(e.target.value)} />
      </div>
      {mutation.isError && (
        <p className="text-destructive text-xs">{(mutation.error as Error).message}</p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOpen(false)}
          disabled={mutation.isPending}
        >
          Cancel
        </Button>
        <Button size="sm" onClick={() => mutation.mutate()} disabled={!canSubmit}>
          {mutation.isPending ? 'Verifying…' : 'Add host'}
        </Button>
      </div>
    </div>
  );
}

function RemoveHostButton({ sshHost, onRemoved }: { sshHost: string; onRemoved: () => void }) {
  const mutation = useMutation({
    mutationFn: () => rpc.remoteHosts.removeHost(sshHost),
    onError: (error) => log.error('Failed to remove remote host', { sshHost, error }),
    onSuccess: onRemoved,
  });

  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={`Remove ${sshHost}`}
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      <Trash2 className="size-4" />
    </Button>
  );
}
