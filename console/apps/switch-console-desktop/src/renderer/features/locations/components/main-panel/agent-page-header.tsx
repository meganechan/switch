import { useQuery } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { agentsStore } from '@renderer/features/locations/stores/agents-store';
import {
  getLocationStore,
  locationDisplayName,
} from '@renderer/features/locations/stores/location-selectors';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { rpc } from '@renderer/lib/ipc';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { BoundShortcut } from '@renderer/lib/ui/shortcut';
import { providerDisplayName } from '@shared/core/providers/agent-provider-registry';

/**
 * Who this page is about: the agent's mark, its name and provider, the
 * description the rest of the team reads to know what it is for, and the two
 * things you come here to do.
 *
 * The description is the agent's own, held on its Switch server — the same
 * sentence written when it was created. It is not editable from here.
 */
export const AgentPageHeader = observer(function AgentPageHeader() {
  const {
    params: { locationId, agentName },
  } = useParams('location');
  const showCreateSessionModal = useShowModal('sessionModal');
  const showAddToRoom = useShowModal('addAgentToRoomModal');

  const agent = agentsStore.agentAtLocation(locationId, agentName);
  const title = agent?.name ?? agentName ?? locationDisplayName(getLocationStore(locationId)) ?? '';
  const provider = agent?.providerId ? providerDisplayName(agent.providerId) : null;

  const serverId = agent?.serverId ?? null;
  const { data: remoteAgents } = useQuery({
    queryKey: ['remote-agents', serverId],
    queryFn: () => rpc.switchServers.listRemoteAgents(serverId as string),
    enabled: serverId !== null,
  });
  const description =
    (remoteAgents ?? []).find((a) => a.id === agent?.switchAgentId)?.description ?? null;

  const roomable = serverId !== null && agent?.switchAgentId != null;

  return (
    <header className="flex shrink-0 items-start gap-5 pt-10">
      <span className="flex size-20 shrink-0 items-center justify-center rounded-[18px] bg-[var(--surface-2)]">
        {agent?.providerId ? (
          <AgentIcon id={agent.providerId} size={40} />
        ) : (
          <Bot className="size-9 text-foreground-muted" />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="truncate text-3xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {provider && (
            <Badge variant="secondary" className="h-5 shrink-0 px-2 text-[11px]">
              {provider}
            </Badge>
          )}
        </div>
        {description && <p className="text-sm text-foreground-muted">{description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button onClick={() => showCreateSessionModal({ locationId, agentName })}>
            New Session <BoundShortcut settingsKey="newSession" />
          </Button>
          {roomable && (
            <Button
              variant="outline"
              onClick={() =>
                showAddToRoom({
                  serverId: serverId as string,
                  switchAgentId: agent.switchAgentId as string,
                  agentName: title,
                })
              }
            >
              Add to room
            </Button>
          )}
        </div>
      </div>
    </header>
  );
});
