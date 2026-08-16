import { Bot } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { agentsStore } from '@renderer/features/locations/stores/agents-store';
import {
  getLocationStore,
  locationDisplayName,
} from '@renderer/features/locations/stores/location-selectors';
import { switchServersStore } from '@renderer/features/switch-servers/switch-servers-store';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { BoundShortcut } from '@renderer/lib/ui/shortcut';
import { providerDisplayName } from '@shared/core/providers/agent-provider-registry';

/**
 * Who this page is about, above its tabs: the agent's mark, its name, where it
 * is registered and what it runs on, and the one action the page exists for.
 *
 * The page used to open straight onto a session list with the agent named only
 * in the titlebar, which read as a list of sessions that happened to be
 * somewhere rather than as an agent you are looking at.
 */
export const AgentPageHeader = observer(function AgentPageHeader() {
  const {
    params: { locationId, agentName },
  } = useParams('location');
  const showCreateSessionModal = useShowModal('sessionModal');

  const agent = agentsStore.agentAtLocation(locationId, agentName);
  const title = agent?.name ?? agentName ?? locationDisplayName(getLocationStore(locationId)) ?? '';

  const serverName = agent?.serverId
    ? (switchServersStore.servers.find((s) => s.id === agent.serverId)?.name ?? null)
    : null;
  const provider = providerDisplayName(agent?.providerId ?? null);
  const subtitle = [serverName && `Agent on ${serverName}`, provider].filter(Boolean).join(' · ');

  return (
    <header className="flex shrink-0 items-start justify-between gap-4 pt-10">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-background-secondary">
          {agent?.providerId ? (
            <AgentIcon id={agent.providerId} size={22} />
          ) : (
            <Bot className="size-5 text-foreground-muted" />
          )}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold text-foreground">{title}</h1>
          {subtitle && <p className="mt-0.5 truncate text-sm text-foreground-muted">{subtitle}</p>}
        </div>
      </div>
      <Button
        className="shrink-0"
        onClick={() => showCreateSessionModal({ locationId, agentName })}
      >
        Create Session <BoundShortcut settingsKey="newSession" />
      </Button>
    </header>
  );
});
