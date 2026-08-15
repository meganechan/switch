import type { LucideIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { ServerAvatar, ServerStatusDot, serverStatusLabel } from './server-presentation';
import { switchServersStore } from './switch-servers-store';

/**
 * The titlebar shared by every page of a server's workspace: which server, then
 * which of its sections, then how the connection is doing.
 *
 * One component rather than one per page, because the breadcrumb is the only
 * thing telling you which workspace you are in — three copies of it are three
 * chances for the pages to disagree about that.
 */
export const ServerSectionTitlebar = observer(function ServerSectionTitlebar({
  serverId,
  icon: SectionIcon,
  label,
}: {
  serverId: string;
  icon: LucideIcon;
  label: string;
}) {
  const server = switchServersStore.servers.find((s) => s.id === serverId);
  return (
    <Titlebar
      leftSlot={
        <div className="flex min-w-0 items-center gap-1.5 px-2 text-sm">
          {server && <ServerAvatar server={server} size="sm" />}
          <span className="truncate text-foreground-muted">{server?.name ?? 'Server'}</span>
          <span className="text-foreground-passive">/</span>
          <SectionIcon className="size-3.5 shrink-0 text-foreground" />
          <span className="text-foreground">{label}</span>
        </div>
      }
      rightSlot={
        server && (
          <span className="mr-1 flex items-center gap-1.5 rounded-full bg-background-tertiary px-2 py-0.5 text-xs text-foreground-muted">
            <ServerStatusDot server={server} />
            {serverStatusLabel(server)}
          </span>
        )
      }
    />
  );
});
