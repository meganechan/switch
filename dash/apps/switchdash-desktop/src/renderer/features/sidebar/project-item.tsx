import { useQuery } from '@tanstack/react-query';
import {
  Bot,
  ChevronRight,
  ExternalLink,
  Loader2,
  Plus,
  Server,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useConfirmDeleteProject } from '@renderer/features/projects/hooks/use-confirm-delete-project';
import {
  isUnregisteredProject,
  type UnregisteredProject,
} from '@renderer/features/projects/stores/project';
import {
  getProjectStore,
  projectViewKind,
} from '@renderer/features/projects/stores/project-selectors';
import { switchRoomsStore } from '@renderer/features/switch-servers/switch-rooms-store';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { rpc } from '@renderer/lib/ipc';
import {
  useNavigate,
  useParams,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { BoundShortcut } from '@renderer/lib/ui/shortcut';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import {
  SidebarItemMiniButton,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuRow,
} from './sidebar-primitives';
import { depthIndent } from './sidebar-store';

const UNREGISTERED_PHASE_LABEL: Record<UnregisteredProject['phase'], string> = {
  'creating-repo': 'Creating repository…',
  cloning: 'Cloning…',
  registering: 'Registering…',
  error: 'Failed',
};

export const SidebarProjectItem = observer(function SidebarProjectItem({
  projectId,
  depth = 0,
}: {
  projectId: string;
  depth?: number;
}) {
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const { params: projectParams } = useParams('project');
  const { params: sessionParams } = useParams('session');
  const showCreateSessionModal = useShowModal('sessionModal');
  const showAssignServerModal = useShowModal('assignServerModal');
  const confirmDeleteProject = useConfirmDeleteProject();

  // Resolve the agent's Switch identity so the "go to" button can open its
  // detail page in the gateway web app (parallel to a room's "go to" button).
  const agentQuery = useQuery({
    queryKey: ['projectAgent', projectId],
    queryFn: async () => (await rpc.agents.getAgents(projectId))[0] ?? null,
    enabled: !!projectId,
  });

  const project = getProjectStore(projectId);

  const currentProjectId =
    currentView === 'session'
      ? sessionParams.projectId
      : currentView === 'project'
        ? projectParams.projectId
        : null;
  const currentSessionId = currentView === 'session' ? sessionParams.sessionId : null;
  // A subagent of this project is scoped by subagentName on the project view;
  // the parent row is active only when no subagent is selected.
  const currentSubagentName = currentView === 'project' ? projectParams.subagentName : undefined;

  const isProjectActive =
    currentProjectId === projectId && !currentSessionId && !currentSubagentName;

  const isExpanded = sidebarStore.expandedProjectIds.has(projectId);

  if (!project) return null;

  const iconClass =
    'absolute h-4 w-4 opacity-100 transition-opacity duration-150 group-hover/row:opacity-0';
  const projectLabel = project.name ?? 'agent';
  const toggleExpanded = () => sidebarStore.toggleProjectExpanded(projectId);

  // Clicking the row opens the agent's page (Sessions / Subagents / Settings),
  // mirroring subagent rows; the chevron button below toggles expansion. An
  // unregistered agent has no page yet, so there we just expand.
  const openProject = () => {
    if (isUnregisteredProject(project)) {
      toggleExpanded();
      return;
    }
    sidebarStore.ensureProjectExpanded(projectId);
    navigate('project', { projectId });
  };

  const agent = agentQuery.data ?? null;
  // The project's agent type drives its icon; fall back to a generic icon until
  // the agent (and its providerId) is available.
  const providerId = agent?.providerId ?? null;
  const gatewayUrl =
    agent?.serverId && agent?.switchAgentId
      ? switchRoomsStore.gatewayAgentUrl(agent.serverId, agent.switchAgentId)
      : null;
  const openInGateway = () => {
    if (gatewayUrl) void rpc.app.openExternal(gatewayUrl);
  };

  const renderSpinnerWithTooltip = () => {
    if (!isUnregisteredProject(project)) return null;
    const label = UNREGISTERED_PHASE_LABEL[project.phase] ?? 'Loading…';
    return (
      <Tooltip>
        <TooltipTrigger>
          <SidebarItemMiniButton type="button" disabled aria-label="Loading">
            <Loader2 className="h-4 w-4 animate-spin text-foreground/60" />
          </SidebarItemMiniButton>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <SidebarMenuRow
          className={cn('group/row h-8 justify-between flex px-1')}
          style={depthIndent(depth)}
          data-active={isProjectActive || undefined}
          isActive={isProjectActive}
          onMouseDown={(e) => e.preventDefault()}
          onClick={openProject}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {project.state === 'unregistered' ? (
              renderSpinnerWithTooltip()
            ) : (
              <SidebarItemMiniButton
                type="button"
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${projectLabel}`}
                className="relative"
                onClick={(e) => {
                  e.stopPropagation();
                  sidebarStore.toggleProjectExpanded(projectId);
                }}
              >
                {providerId ? (
                  <AgentIcon id={providerId} size={16} className={iconClass} />
                ) : (
                  <Bot className={iconClass} />
                )}
                <ChevronRight
                  className={cn(
                    'absolute h-4 w-4 transition-all duration-150 opacity-0 group-hover/row:opacity-100',
                    isExpanded && 'rotate-90'
                  )}
                />
              </SidebarItemMiniButton>
            )}
            <SidebarMenuAction
              aria-label={`Open agent ${projectLabel}`}
              className={cn(
                'truncate transition-colors select-none',
                projectViewKind(getProjectStore(projectId)) === 'bootstrapping' &&
                  'text-foreground-tertiary-passive'
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{project.name}</span>
                {agent?.connection === 'remote' && (
                  <Tooltip>
                    <TooltipTrigger>
                      <Server className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
                    </TooltipTrigger>
                    <TooltipContent>
                      Runs remotely
                      {agent.remoteConfig?.sshHost ? ` on ${agent.remoteConfig.sshHost}` : ''}
                    </TooltipContent>
                  </Tooltip>
                )}
                {projectViewKind(project) === 'path_not_found' && (
                  <Tooltip>
                    <TooltipTrigger>
                      <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-foreground-destructive" />
                    </TooltipTrigger>
                    <TooltipContent>Agent not found at path</TooltipContent>
                  </Tooltip>
                )}
              </span>
            </SidebarMenuAction>
          </div>
          {gatewayUrl && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <SidebarItemMiniButton
                    type="button"
                    aria-label={`Open ${projectLabel} in gateway`}
                    className="opacity-0 transition-opacity duration-150 group-hover/row:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      openInGateway();
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </SidebarItemMiniButton>
                }
              />
              <TooltipContent>Open in gateway</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              className="h-6"
              render={
                <SidebarItemMiniButton
                  type="button"
                  aria-label={`New session for ${projectLabel}`}
                  className={
                    'opacity-0 transition-opacity duration-150 group-hover/row:opacity-100'
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    showCreateSessionModal({ projectId });
                  }}
                  disabled={project.state === 'unregistered'}
                >
                  <Plus className="h-4 w-4" />
                </SidebarItemMiniButton>
              }
            />
            <TooltipContent>
              New Session
              <BoundShortcut settingsKey="newSession" variant="badge" />
            </TooltipContent>
          </Tooltip>
        </SidebarMenuRow>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => showAssignServerModal({ projectId })}>
          <Server className="size-4" />
          Assign server
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          onClick={() => {
            void confirmDeleteProject({
              projectId,
              projectLabel: project.name ?? 'this agent',
              onDeleted: () => {
                if (isProjectActive) navigate('home');
              },
            });
          }}
        >
          <Trash2 className="size-4" />
          Remove Agent
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

interface BaseProjectItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isActive: boolean;
}

export function BaseProjectItem({ isActive, className, ...props }: BaseProjectItemProps) {
  return (
    <SidebarMenuButton
      className={cn('justify-between flex item px-1 py-1', className)}
      isActive={isActive}
      {...props}
    />
  );
}
