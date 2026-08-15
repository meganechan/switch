import { House } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { switchServersStore } from '@renderer/features/switch-servers/switch-servers-store';
import { isCurrentView, useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { useWorkspaceSlots } from '@renderer/lib/layout/workspace-slots';
import { SidebarMenu, SidebarMenuButton } from './sidebar-primitives';

/**
 * The active server's own destinations, under the workspace switcher.
 *
 * Home is the server's page. "Your agents" and "Your rooms" belong here too and
 * land in a later step; until then this is one row rather than a section, which
 * is why it stays this small.
 */
export const WorkspaceNav = observer(function WorkspaceNav() {
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const { params } = useParams('server');
  const active = switchServersStore.activeServer;
  if (!active) return null;

  const onHome = isCurrentView(currentView, 'server') && params?.serverId === active.id;

  return (
    <SidebarMenu className="px-2">
      <SidebarMenuButton
        isActive={onHome}
        onClick={() => navigate('server', { serverId: active.id })}
        className="h-7 px-2.5"
      >
        <House className="size-4 shrink-0" />
        Home
      </SidebarMenuButton>
    </SidebarMenu>
  );
});
