import { Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { agentsStore } from '@renderer/features/locations/stores/agents-store';
import { useArrowKeyNavigation } from '@renderer/lib/hooks/use-arrow-key-navigation';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { ActionListItem } from '@renderer/lib/ui/action-list-item';
import { providerDisplayName } from '@shared/core/providers/agent-provider-registry';

export const SessionListEmptyState = observer(function SessionListEmptyState({
  locationId,
  agentName,
}: {
  locationId: string;
  agentName?: string;
}) {
  const showSessionModal = useShowModal('sessionModal');

  const agent = agentsStore.agentAtLocation(locationId, agentName);
  const provider = providerDisplayName(agent?.providerId ?? null);

  const actions = [
    {
      label: 'New Session',
      description: agentName
        ? `Start a ${provider ?? 'new'} session as ${agentName}`
        : `Start a ${provider ?? 'new'} session for this agent`,
      icon: Plus,
      onActivate: () => showSessionModal({ locationId, agentName }),
    },
  ];

  const { selectedIndex, setSelectedIndex } = useArrowKeyNavigation(actions.length, (index) => {
    actions[index]?.onActivate();
  });

  return (
    <div className="flex h-full flex-col items-center justify-center bg-background p-8">
      <div className="flex w-full max-w-sm flex-col gap-1">
        {actions.map((action, i) => (
          <ActionListItem
            key={action.label}
            label={action.label}
            description={action.description}
            icon={action.icon}
            isSelected={i === selectedIndex}
            onMouseEnter={() => setSelectedIndex(i)}
            onClick={action.onActivate}
          />
        ))}
      </div>
    </div>
  );
});
