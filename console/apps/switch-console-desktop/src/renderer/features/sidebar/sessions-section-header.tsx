import { ArrowUpDown, DoorOpen, Filter, Laptop, Plus, Server, UserPlus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { switchRoomsStore } from '@renderer/features/switch-servers/switch-rooms-store';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { BridgeIcon, hasBridgeIcon } from '@renderer/lib/components/bridge-icon';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { buttonVariants } from '@renderer/lib/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import type { AgentConnectionKind } from '@shared/core/agents/agent-connection';
import { getProvider } from '@shared/core/providers/agent-provider-registry';
import { type SidebarGrouping, UNBRIDGED_FILTER_VALUE } from '@shared/view-state';

const CONNECTION_LABEL: Record<AgentConnectionKind, string> = {
  local: 'Local',
  remote: 'Remote',
};

const GROUPING_OPTIONS: { value: SidebarGrouping; label: string }[] = [
  { value: 'agent', label: 'By Agent' },
  { value: 'room', label: 'By Room' },
];

/**
 * View switcher for the grouped sidebar — a segmented control that shows both
 * groupings side by side, with the active one highlighted, so the choice is
 * discoverable at a glance rather than hidden behind an icon menu.
 *
 * The labels carry no icon. "By Agent" and "By Room" already say it, and two
 * glyphs inside a control this small crowd it without adding meaning.
 * Observer-wrapped so the active selection updates reactively.
 */
const ViewGroupingToggle = observer(function ViewGroupingToggle() {
  return (
    <ToggleGroup
      size="sm"
      spacing={1}
      multiple={false}
      value={[sidebarStore.grouping]}
      onValueChange={([value]) => {
        const opt = GROUPING_OPTIONS.find((o) => o.value === value);
        if (opt) sidebarStore.setGrouping(opt.value);
      }}
      aria-label="Group sidebar by"
      className="h-7 border-transparent bg-background-tertiary-2 p-0.5"
    >
      {GROUPING_OPTIONS.map((opt) => (
        <ToggleGroupItem
          key={opt.value}
          value={opt.value}
          aria-label={opt.label}
          className="rounded-md px-2.5 hover:bg-transparent aria-pressed:bg-background data-pressed:bg-background data-[state=on]:bg-background"
        >
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
});

/** Human label for a messaging-app filter value. */
function bridgeLabel(value: string): string {
  if (value === UNBRIDGED_FILTER_VALUE) return 'No messaging app';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Filters for the room view: which messaging app a room is bridged to, and
 * whether anything is running in it.
 *
 * The agent dimensions (run location, agent type) are deliberately absent. They
 * describe an agent, and applying them here would mean "rooms containing an
 * agent that matches" — a room disappearing because of a property of one of its
 * members, under a control that looks like it filters rooms.
 */
const RoomFilterSections = observer(function RoomFilterSections() {
  const bridgeValues = switchRoomsStore.bridgeFilterValuesInActiveScope;

  return (
    <>
      {bridgeValues.length > 0 && (
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-normal text-foreground-muted">
            Messaging app
          </DropdownMenuLabel>
          {bridgeValues.map((value) => (
            <DropdownMenuCheckboxItem
              key={value}
              checked={sidebarStore.filterBridgeTypes.has(value)}
              onCheckedChange={() => sidebarStore.toggleFilterBridgeType(value)}
            >
              {hasBridgeIcon(value) ? (
                <BridgeIcon bridgeType={value} size={16} className="mr-1.5" />
              ) : (
                <DoorOpen className="mr-1.5 h-4 w-4" />
              )}
              {bridgeLabel(value)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      )}
      <DropdownMenuGroup>
        <DropdownMenuLabel className="text-xs font-normal text-foreground-muted">
          Activity
        </DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={sidebarStore.filterRoomHasLiveSession}
          onCheckedChange={(checked) => sidebarStore.setFilterRoomHasLiveSession(checked)}
        >
          Has running session
        </DropdownMenuCheckboxItem>
      </DropdownMenuGroup>
    </>
  );
});

/** Filters for the agent view: run location, agent type, live-session presence.
 * Only dimensions with matching agents on the active server are offered. */
const AgentFilterSections = observer(function AgentFilterSections() {
  const connections = sidebarStore.availableFilterConnections;
  const providerIds = sidebarStore.availableFilterProviderIds;

  return (
    <>
      {connections.length > 0 && (
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-normal text-foreground-muted">
            Run location
          </DropdownMenuLabel>
          {connections.map((kind) => (
            <DropdownMenuCheckboxItem
              key={kind}
              checked={sidebarStore.filterConnections.has(kind)}
              onCheckedChange={() => sidebarStore.toggleFilterConnection(kind)}
            >
              {kind === 'remote' ? (
                <Server className="mr-1.5 h-4 w-4" />
              ) : (
                <Laptop className="mr-1.5 h-4 w-4" />
              )}
              {CONNECTION_LABEL[kind]}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      )}
      {providerIds.length > 0 && (
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs font-normal text-foreground-muted">
            Agent type
          </DropdownMenuLabel>
          {providerIds.map((id) => (
            <DropdownMenuCheckboxItem
              key={id}
              checked={sidebarStore.filterProviderIds.has(id)}
              onCheckedChange={() => sidebarStore.toggleFilterProviderId(id)}
            >
              <AgentIcon id={id} size={16} className="mr-1.5" />
              {getProvider(id)?.name ?? id}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      )}
      <DropdownMenuGroup>
        <DropdownMenuLabel className="text-xs font-normal text-foreground-muted">
          Session
        </DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={sidebarStore.filterHasLiveSession}
          onCheckedChange={(checked) => sidebarStore.setFilterHasLiveSession(checked)}
        >
          Has running session
        </DropdownMenuCheckboxItem>
      </DropdownMenuGroup>
    </>
  );
});

/**
 * Optional additive filters for the grouped sidebar — a funnel button whose
 * sections belong to the view you are in, since the two views filter different
 * things. A dot on the icon signals that the view on screen is being narrowed.
 */
const FilterDropdown = observer(function FilterDropdown() {
  const roomMode = sidebarStore.grouping === 'room';
  const active = sidebarStore.hasActiveFiltersInCurrentView;

  return (
    <DropdownMenu>
      <Tooltip>
        <DropdownMenuTrigger
          render={
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={roomMode ? 'Filter rooms' : 'Filter agents'}
                  className={buttonVariants({
                    size: 'icon-xs',
                    variant: 'ghost',
                    className: cn(
                      'relative hover:bg-transparent hover:text-foreground',
                      active ? 'text-foreground' : 'text-foreground-muted'
                    ),
                  })}
                >
                  <Filter />
                  {active && (
                    <span className="bg-accent absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full" />
                  )}
                </button>
              }
            />
          }
        />
        <TooltipContent>Filter</TooltipContent>
      </Tooltip>
      <DropdownMenuContent className="min-w-52" align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{roomMode ? 'Filter rooms' : 'Filter agents'}</DropdownMenuLabel>
        </DropdownMenuGroup>
        {roomMode ? <RoomFilterSections /> : <AgentFilterSections />}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!active} onClick={() => sidebarStore.clearFilters()}>
          Clear filters
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

/**
 * The Sessions section's header: what the list below is, then how it is
 * arranged. The grouping toggle used to sit alone on a single row, where it
 * read as the sidebar's whole navigation rather than as one list's setting.
 */
export const SessionsSectionHeader = observer(function SessionsSectionHeader() {
  const showAddLocationModal = useShowModal('addAgentModal');
  const showCreateRoomModal = useShowModal('createRoomModal');
  // The add button offers both actions rather than the one matching the current
  // view. Which grouping you are looking at says how you want the list
  // arranged, not which thing you next want to make, and reaching the other
  // action used to mean switching view first.
  const roomMode = sidebarStore.grouping === 'room';

  return (
    <>
      <div className="flex h-[22px] items-center justify-between pr-2.5 pl-2.5">
        <span className="text-[11px] font-medium tracking-wider text-foreground-passive uppercase">
          Sessions
        </span>
        <span className="text-[11px] text-foreground-passive">Group by</span>
      </div>
      <div className="flex h-[36px] items-center justify-between pr-2.5 pl-2.5">
        <ViewGroupingToggle />
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <Tooltip>
              <DropdownMenuTrigger
                render={
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={roomMode ? 'Sort rooms' : 'Sort agents'}
                        className={buttonVariants({
                          size: 'icon-xs',
                          variant: 'ghost',
                          className:
                            'hover:bg-transparent text-foreground-muted hover:text-foreground',
                        })}
                      >
                        <ArrowUpDown />
                      </button>
                    }
                  />
                }
              />
              <TooltipContent>Sort by</TooltipContent>
            </Tooltip>
            <DropdownMenuContent className="min-w-48">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                {roomMode ? (
                  // Rooms are places, so they order by their own properties, and
                  // separately from the session sort — switching view must not
                  // silently re-order the other one.
                  <DropdownMenuRadioGroup value={sidebarStore.roomSortBy}>
                    <DropdownMenuRadioItem
                      value="name"
                      onClick={() => sidebarStore.setRoomSortBy('name')}
                    >
                      Name
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      value="created-at"
                      onClick={() => sidebarStore.setRoomSortBy('created-at')}
                    >
                      Created
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      value="updated-at"
                      onClick={() => sidebarStore.setRoomSortBy('updated-at')}
                    >
                      Last active
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                ) : (
                  <DropdownMenuRadioGroup value={sidebarStore.sessionSortBy}>
                    <DropdownMenuRadioItem
                      value="created-at"
                      onClick={() => sidebarStore.applySort('created-at')}
                    >
                      Created at
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      value="updated-at"
                      onClick={() => sidebarStore.applySort('updated-at')}
                    >
                      Last used
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                )}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <FilterDropdown />
          <DropdownMenu>
            <Tooltip>
              <DropdownMenuTrigger
                render={
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label="Add"
                        className={buttonVariants({
                          size: 'icon-xs',
                          variant: 'ghost',
                          className:
                            'hover:bg-transparent text-foreground-muted hover:text-foreground',
                        })}
                      >
                        <Plus />
                      </button>
                    }
                  />
                }
              />
              <TooltipContent>Add</TooltipContent>
            </Tooltip>
            <DropdownMenuContent className="min-w-48" align="start">
              <DropdownMenuItem onClick={() => showAddLocationModal({})}>
                <UserPlus className="mr-1.5 h-4 w-4" />
                Add an agent
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => showCreateRoomModal({})}>
                <DoorOpen className="mr-1.5 h-4 w-4" />
                Create a room
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </>
  );
});
