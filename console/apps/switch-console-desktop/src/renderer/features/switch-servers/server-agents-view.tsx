import { Bot, ExternalLink, MoreVertical, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import type { GuardResult, ViewDefinition } from '@renderer/app/view-registry';
import { useConfirmDeleteAgent } from '@renderer/features/locations/hooks/use-confirm-delete-agent';
import { agentsStore } from '@renderer/features/locations/stores/agents-store';
import { getLocationStore } from '@renderer/features/locations/stores/location-selectors';
import { refreshSidebarRoomState } from '@renderer/features/sidebar/sidebar-tree-data';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import type { Agent } from '@shared/core/agents/agents';
import { ServerPage, ServerTable, ServerTableEmpty } from './server-page';
import { ServerSectionTitlebar } from './server-section-titlebar';
import { switchRoomsStore } from './switch-rooms-store';
import { switchServersStore } from './switch-servers-store';

const COLUMNS = [
  { key: 'agent', label: 'Agent' },
  { key: 'provider', label: 'Provider' },
  { key: 'rooms', label: 'Rooms', className: 'w-24' },
  { key: 'actions', label: 'Actions', className: 'w-28 text-right' },
] as const;

function useServerId(): string {
  return useParams('serverAgents').params.serverId;
}

const ServerAgentsTitlebar = observer(function ServerAgentsTitlebar() {
  return <ServerSectionTitlebar serverId={useServerId()} icon={Bot} label="Your Agents" />;
});

const ServerAgentsPanel = observer(function ServerAgentsPanel() {
  const serverId = useServerId();
  const server = switchServersStore.servers.find((s) => s.id === serverId);
  const showAddAgentModal = useShowModal('addAgentModal');

  // The sidebar reads the same two things, but this page must not be right only
  // when the sidebar happened to be open first.
  useEffect(() => {
    void refreshSidebarRoomState(false);
  }, [serverId]);

  const agents = agentsStore.agentsOnServer(serverId);

  return (
    <ServerPage
      title="Your Agents"
      description={`Agents on ${server?.name ?? 'this server'}. Add one, set how it is addressed, and start sessions.`}
      action={
        <Button size="sm" onClick={() => showAddAgentModal({})}>
          <Plus className="size-4" />
          Add agent
        </Button>
      }
    >
      {agents.length === 0 ? (
        <ServerTableEmpty>
          No agents are registered on this server yet. Add one to start sessions with it.
        </ServerTableEmpty>
      ) : (
        <ServerTable columns={COLUMNS}>
          {agents.map((agent) => (
            <AgentRow key={agent.id} agent={agent} serverId={serverId} />
          ))}
        </ServerTable>
      )}
    </ServerPage>
  );
});

const AgentRow = observer(function AgentRow({
  agent,
  serverId,
}: {
  agent: Agent;
  serverId: string;
}) {
  const { navigate } = useNavigate();
  const showCreateSessionModal = useShowModal('sessionModal');
  const showConfirmReset = useShowModal('resetAgentModal');
  const confirmDeleteAgent = useConfirmDeleteAgent();
  const { toastPromise } = useToast();

  const location = getLocationStore(agent.locationId);
  const sshHost = location?.data?.sshHost ?? null;
  const label = agent.name || 'Unnamed agent';

  const gatewayUrl =
    agent.switchAgentId && switchRoomsStore.gatewayAgentUrl(serverId, agent.switchAgentId);

  return (
    <tr className="text-sm">
      <td className="px-3 py-2">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 text-left hover:underline"
          onClick={() => navigate('location', { locationId: agent.locationId, agentName: label })}
        >
          {agent.providerId ? (
            <AgentIcon id={agent.providerId} size={16} className="shrink-0" />
          ) : (
            <Bot className="size-4 shrink-0 text-foreground-muted" />
          )}
          <span className="truncate">{label}</span>
        </button>
      </td>

      <td className="truncate px-3 py-2 text-foreground-muted">
        {agent.providerId ? `${agent.providerId} · ` : ''}
        {sshHost ?? 'this computer'}
      </td>

      <td className="px-3 py-2 text-foreground-muted">
        <AgentRoomCount agent={agent} serverId={serverId} />
      </td>

      <td className="px-3 py-2">
        <div className="flex items-center justify-end">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`New session for ${label}`}
                  onClick={() =>
                    showCreateSessionModal({ locationId: agent.locationId, agentName: label })
                  }
                >
                  <Plus className="size-3" />
                </Button>
              }
            />
            <TooltipContent>New session</TooltipContent>
          </Tooltip>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-xs" aria-label={`${label} actions`}>
                  <MoreVertical className="size-3" />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              {gatewayUrl && (
                <DropdownMenuItem
                  onClick={() =>
                    void rpc.switchServers.openGatewayPage({ serverId, url: gatewayUrl })
                  }
                >
                  <ExternalLink className="size-4" />
                  Open in gateway
                </DropdownMenuItem>
              )}
              {sshHost != null && (
                <DropdownMenuItem
                  onClick={() =>
                    showConfirmReset({
                      agentLabel: label,
                      onSuccess: () => {
                        void toastPromise(rpc.agents.resetRemoteAgent({ agentId: agent.id }), {
                          loading: `Resetting ${label}…`,
                          success: `${label} was reset`,
                          error: (error) =>
                            `Failed to reset agent: ${error instanceof Error ? error.message : String(error)}`,
                        });
                      },
                    })
                  }
                >
                  <RotateCcw className="size-4" />
                  Reset agent…
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  void confirmDeleteAgent({
                    locationId: agent.locationId,
                    agentId: agent.id,
                    locationLabel: label,
                    onDeleted: () => {},
                  });
                }}
              >
                <Trash2 className="size-4" />
                Remove agent…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </td>
    </tr>
  );
});

/**
 * How many of this server's rooms the agent is in.
 *
 * An agent whose membership has not been read yet shows an em dash, not a zero:
 * "in no rooms" is a thing you would go and fix, and it must not be said about
 * an agent we simply have not asked about.
 */
const AgentRoomCount = observer(function AgentRoomCount({
  agent,
  serverId,
}: {
  agent: Agent;
  serverId: string;
}) {
  if (!agent.switchAgentId) return <span>—</span>;
  const memberships = switchRoomsStore.roomsFor(serverId, agent.switchAgentId);
  if (memberships === undefined) return <span>—</span>;
  return <span>{memberships.filter((room) => !room.archived).length}</span>;
});

export const serverAgentsView = {
  WrapView: ({ children }: { children: React.ReactNode; serverId: string }) => <>{children}</>,
  TitlebarSlot: ServerAgentsTitlebar,
  MainPanel: ServerAgentsPanel,
  canActivate: (params: unknown): GuardResult => {
    const serverId =
      typeof params === 'object' && params !== null
        ? (params as { serverId?: unknown }).serverId
        : undefined;
    if (typeof serverId !== 'string') return { ok: false, redirect: 'home' };
    return { ok: true };
  },
} satisfies ViewDefinition<{ serverId: string }>;
