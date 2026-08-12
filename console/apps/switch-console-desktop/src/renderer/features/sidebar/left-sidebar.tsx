import { ArrowUpRight, BookOpen, FolderInput, Server, Settings } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { SidebarOnboardingChecklist } from '@renderer/features/onboarding/sidebar-onboarding-checklist';
import { isCurrentView, useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useWorkspaceSlots } from '@renderer/lib/layout/workspace-slots';
import { openExternalUrl } from '@renderer/lib/open-external';
import { SwitchConsoleAppIcon } from '@renderer/lib/switch-console-app-icon';
import { BoundShortcut } from '@renderer/lib/ui/shortcut';
import { cn } from '@renderer/utils/utils';
import { SWITCH_CONSOLE_DOCS_URL } from '@shared/urls';
import { ServersSidebarSection } from '../switch-servers/ServersSidebarSection';
import { LocationsGroupLabel } from './locations-group-label';
import { SidebarPinnedSessionList } from './pinned-session-list';
import { SidebarGroupedList } from './sidebar-grouped-list';
import {
  SidebarContainer,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
} from './sidebar-primitives';
import { SidebarSearchTrigger } from './sidebar-search-trigger';
import { SidebarSpace } from './sidebar-space';
import { UpdateSection } from './update-section';
import { useSidebarDrop } from './use-sidebar-drop';

export const LeftSidebar: React.FC = observer(function LeftSidebar() {
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();

  const { isDragOver, onDragOver, onDragEnter, onDragLeave, onDrop } = useSidebarDrop();

  return (
    <div
      className={cn(
        'relative flex flex-col h-full bg-background-tertiary text-foreground-tertiary-muted transition-colors',
        isDragOver && 'bg-accent/10 ring-2 ring-inset ring-accent/50'
      )}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-background-tertiary/80 backdrop-blur-sm">
          <FolderInput className="size-8 text-foreground" />
          <span className="text-xs font-medium text-foreground">Drop to add agent</span>
        </div>
      )}
      <SidebarSpace />
      <SidebarContainer className="min-h-0 w-full flex-1 border-r-0">
        <SidebarContent className="flex flex-col">
          <SidebarPinnedSessionList />
          <ServersSidebarSection />
          <SidebarGroup className="mb-0 flex min-h-0 flex-1 flex-col">
            <LocationsGroupLabel />
            <SidebarGroupContent className="flex min-h-0 flex-1 flex-col">
              <SidebarMenu className="flex min-h-0 flex-1 flex-col">
                <SidebarGroupedList />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarOnboardingChecklist />
        <SidebarFooter>
          <SidebarMenu>
            <SidebarSearchTrigger />
            <SidebarMenuButton
              isActive={
                isCurrentView(currentView, 'remoteHosts') ||
                isCurrentView(currentView, 'remoteHost')
              }
              onClick={() => navigate('remoteHosts')}
              aria-label="Remote hosts"
              className="w-full justify-between"
            >
              <span className="flex items-center gap-2">
                <Server className="h-5 w-5 sm:h-4 sm:w-4" />
                Remote hosts
              </span>
            </SidebarMenuButton>
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'settings')}
              onClick={() => navigate('settings')}
              aria-label="Settings"
              className="w-full justify-between"
            >
              <span className="flex items-center gap-2">
                <Settings className="h-5 w-5 sm:h-4 sm:w-4" />
                Settings
              </span>
              <BoundShortcut settingsKey="settings" />
            </SidebarMenuButton>
            <SidebarMenuButton
              onClick={() =>
                openExternalUrl(SWITCH_CONSOLE_DOCS_URL, 'Could not open the documentation')
              }
              aria-label="Docs"
              className="w-full justify-between"
            >
              <span className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 sm:h-4 sm:w-4" />
                Docs
              </span>
              <ArrowUpRight className="size-3 text-foreground-muted" />
            </SidebarMenuButton>
          </SidebarMenu>
        </SidebarFooter>
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
          {/* The mark doubles as the way back to the welcome screen — the one
              view with no other entry point once you have navigated away. */}
          <button
            type="button"
            onClick={() => navigate('home')}
            aria-label="Go to home"
            title="Home"
            className="rounded-md opacity-70 transition-opacity hover:opacity-100"
          >
            <SwitchConsoleAppIcon size={18} className="rounded-[4px]" />
          </button>
          <UpdateSection />
        </div>
      </SidebarContainer>
    </div>
  );
});
