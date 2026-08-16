import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { SwitchConsoleMark } from '@renderer/lib/switch-console-mark';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Spinner } from '@renderer/lib/ui/spinner';
import { cn } from '@renderer/utils/utils';
import type { SwitchServer } from '@shared/core/switch-servers/switch-servers';
import { localServerStore } from './local-server-store';
import { remoteServerStore } from './remote-server-store';
import { serverIcon } from './server-icon';
import {
  ServerAvatar,
  ServerDriftIndicator,
  ServerStatusDot,
  serverDrift,
  serverPlacementLabel,
  serverStatusLabel,
  serverSubtitleLabel,
} from './server-presentation';
import { switchServersStore } from './switch-servers-store';

/**
 * The workspace switcher at the top of the sidebar.
 *
 * A server is a workspace: the sidebar, its sessions and everything under them
 * are scoped to whichever one is active, so exactly one is on screen at a time
 * and the rest live behind this control. Before it, all servers were listed
 * side by side and the scoping was left to be inferred from a highlighted row.
 *
 * With no servers there is nothing to switch between, so it collapses to the
 * one action that leads anywhere.
 */
export const WorkspaceSwitcher = observer(function WorkspaceSwitcher() {
  const store = switchServersStore;
  const { navigate } = useNavigate();
  const showAddServerModal = useShowModal('addServerModal');

  useEffect(() => {
    void store.init();
    void localServerStore.init();
    void remoteServerStore.init();
    const onFocus = () => void store.recoverStale();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      localServerStore.dispose();
      remoteServerStore.dispose();
    };
  }, [store]);

  const active = store.activeServer;

  if (!active) {
    return (
      <div className="px-2">
        <LocalServerPendingButton />
        {localServerStore.phase === 'stopped' && (
          <button
            type="button"
            onClick={() => showAddServerModal({})}
            className="flex w-full items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-sm text-foreground-tertiary hover:bg-background-tertiary-1"
          >
            <Plus className="size-4 shrink-0 text-foreground-muted" />
            Add a server
          </button>
        )}
      </div>
    );
  }

  const ActiveIcon = serverIcon(active);
  const drift = serverDrift(active);

  return (
    <div className="px-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="Switch server"
              className="flex w-full items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-left hover:bg-background-tertiary-1"
            >
              <ServerAvatar server={active} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {active.name}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-foreground-muted">
                  <ActiveIcon className="size-3 shrink-0" />
                  <span className="truncate">{serverSubtitleLabel(active)}</span>
                  <ServerStatusDot server={active} />
                  {drift && <ServerDriftIndicator drift={drift} />}
                </span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-foreground-muted" />
            </button>
          }
        />
        <DropdownMenuContent align="start" className="min-w-72">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs font-medium text-foreground-passive">
              Servers
            </DropdownMenuLabel>
            {store.servers.map((server) => (
              <ServerMenuItem key={server.id} server={server} />
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => showAddServerModal({})}>
            <Plus className="size-4" />
            Add server
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* The welcome screen is what the app opens with before any server
              exists; once one does, this is how it stays reachable. */}
          <DropdownMenuItem onClick={() => navigate('home')}>
            <SwitchConsoleMark size={16} />
            About Switch
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});

/**
 * A managed local stack that is starting has no server record yet, so it would
 * otherwise be invisible until it is healthy — and a failed setup invisible
 * forever.
 */
const LocalServerPendingButton = observer(function LocalServerPendingButton() {
  const showAddServerModal = useShowModal('addServerModal');
  const phase = localServerStore.phase;
  if (phase === 'stopped') return null;
  const failed = phase === 'error';

  return (
    <button
      type="button"
      onClick={() => showAddServerModal({ mode: 'local' })}
      className="flex w-full items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-sm text-foreground-tertiary hover:bg-background-tertiary-1"
    >
      <span className="min-w-0 flex-1 truncate text-left">
        {failed ? 'Local server (setup failed)' : 'Local Switch server'}
      </span>
      <span
        aria-hidden
        className={cn('size-1.5 shrink-0 rounded-full', failed ? 'bg-red-500' : 'bg-amber-500')}
      />
      {phase === 'starting' && <Spinner className="size-3.5 shrink-0" />}
    </button>
  );
});

const ServerMenuItem = observer(function ServerMenuItem({ server }: { server: SwitchServer }) {
  const store = switchServersStore;
  const { navigate } = useNavigate();
  const Icon = serverIcon(server);
  const placement = serverPlacementLabel(server);
  const drift = serverDrift(server);
  const isActive = store.activeServerId === server.id;

  return (
    <DropdownMenuItem
      onClick={() => {
        void store.setActive(server.id);
        navigate('server', { serverId: server.id });
      }}
    >
      <ServerAvatar server={server} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{server.name}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-foreground-muted">
          <Icon className="size-3 shrink-0" />
          <span className="truncate">{serverStatusLabel(server)}</span>
          {placement && (
            <span className="shrink-0 rounded bg-background-tertiary px-1 py-px text-[10px] font-medium tracking-wide text-foreground-muted uppercase">
              {placement}
            </span>
          )}
        </span>
      </span>
      {drift && <ServerDriftIndicator drift={drift} />}
      <ServerStatusDot server={server} />
      {isActive && <Check className="size-3.5 shrink-0 text-foreground" />}
    </DropdownMenuItem>
  );
});
