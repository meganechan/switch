import { Search } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { getSessionStore } from '@renderer/features/sessions/stores/session-selectors';
import { useParams, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { BoundShortcut } from '@renderer/lib/ui/shortcut';
import { SidebarMenuButton } from './sidebar-primitives';

export const SidebarSearchTrigger = observer(function SidebarSearchTrigger() {
  const showCommandPalette = useShowModal('commandPaletteModal');
  const { currentView } = useWorkspaceSlots();
  const { params: sessionParams } = useParams('session');
  const { params: projectParams } = useParams('project');

  const currentProjectId =
    currentView === 'session'
      ? sessionParams.projectId
      : currentView === 'project'
        ? projectParams.projectId
        : undefined;
  const currentSessionId = currentView === 'session' ? sessionParams.sessionId : undefined;

  const currentWorkspaceId =
    currentProjectId && currentSessionId
      ? (getSessionStore(currentProjectId, currentSessionId)?.workspaceId ?? undefined)
      : undefined;

  return (
    <SidebarMenuButton
      isActive={false}
      onClick={() =>
        showCommandPalette({
          projectId: currentProjectId,
          sessionId: currentSessionId,
          workspaceId: currentWorkspaceId,
        })
      }
      aria-label="Search"
      className="w-full justify-between"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Search className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" />
        <span className="truncate">Search…</span>
      </span>
      <BoundShortcut settingsKey="commandPalette" />
    </SidebarMenuButton>
  );
});
