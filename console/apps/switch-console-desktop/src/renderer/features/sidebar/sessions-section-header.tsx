import {
  ChevronsDownUp,
  DoorOpen,
  Laptop,
  MoreHorizontal,
  Plus,
  Server,
  UserPlus,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { switchRoomsStore } from '@renderer/features/switch-servers/switch-rooms-store';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { BridgeIcon, hasBridgeIcon } from '@renderer/lib/components/bridge-icon';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { sidebarStore } from '@renderer/lib/stores/app-state';
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
import { SectionLabel } from '@renderer/lib/ui/label';
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
      // The raised option has to read as sitting *in* the track, not as a
      // button dropped on top of a box: concentric corners (inner radius =
      // outer radius less the padding) and only a hairline of track showing
      // around it.
      className="h-auto gap-0 rounded-[9px] border-transparent bg-[var(--segment-track)] p-[2px]"
    >
      {GROUPING_OPTIONS.map((opt) => (
        <ToggleGroupItem
          key={opt.value}
          value={opt.value}
          aria-label={opt.label}
          className="h-auto rounded-[7px] px-[9px] py-[2px] text-[11.5px] font-medium text-foreground-muted hover:bg-transparent aria-pressed:bg-[var(--btn-1)] aria-pressed:text-foreground aria-pressed:shadow-[0_1px_2px_rgb(0_0_0_/_0.12)] data-pressed:bg-[var(--btn-1)] data-[state=on]:bg-[var(--btn-1)] data-[state=on]:text-foreground data-[state=on]:shadow-[0_1px_2px_rgb(0_0_0_/_0.12)]"
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
 * The Sessions section's header: what the list below is, then how it is
 * arranged, then the one thing you most often want to do next.
 *
 * The toggle shares the label's line rather than owning one of its own. Alone
 * on a row it read as the sidebar's whole navigation instead of as one list's
 * setting, which is why it previously sat under a "Group by" caption; keeping
 * it beside "Sessions" says the same thing without spending a second row.
 */
export const SessionsSectionHeader = observer(function SessionsSectionHeader() {
  const showAddLocationModal = useShowModal('addAgentModal');
  const showCreateRoomModal = useShowModal('createRoomModal');
  const showCreateSessionModal = useShowModal('sessionModal');
  const [optionsOpen, setOptionsOpen] = useState(false);
  // The add actions offer both rather than the one matching the current view.
  // Which grouping you are looking at says how you want the list arranged, not
  // which thing you next want to make, and reaching the other action used to
  // mean switching view first.
  const roomMode = sidebarStore.grouping === 'room';

  return (
    <>
      {/* Label, its overflow menu and the grouping toggle share one line. The
          three icon buttons that used to sit on a second line — sort, filter,
          add — are all in the menu now; the actions are unchanged. */}
      <div className="group/sessions flex items-center justify-between px-5 pt-[18px] pb-2">
        <div className="flex items-center gap-[6px]">
          <SectionLabel>Sessions</SectionLabel>
          <DropdownMenu onOpenChange={setOptionsOpen}>
            <Tooltip>
              <DropdownMenuTrigger
                render={
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label="Session list options"
                        // Hidden until the section is hovered, and held visible
                        // while its own menu is open so the trigger does not
                        // vanish from under the pointer. Opacity rather than
                        // `hidden` so the row does not reflow on hover.
                        className={cn(
                          'flex size-[18px] items-center justify-center rounded-[6px] text-[var(--fg-passive)] transition-opacity duration-150 hover:bg-[var(--sel-soft)] hover:text-foreground focus-visible:opacity-100',
                          optionsOpen ? 'opacity-100' : 'opacity-0 group-hover/sessions:opacity-100'
                        )}
                      >
                        <MoreHorizontal className="size-[13px]" />
                      </button>
                    }
                  />
                }
              />
              <TooltipContent>Sort, filter and more</TooltipContent>
            </Tooltip>
            <DropdownMenuContent className="min-w-52" align="start">
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
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>{roomMode ? 'Filter rooms' : 'Filter agents'}</DropdownMenuLabel>
              </DropdownMenuGroup>
              {roomMode ? <RoomFilterSections /> : <AgentFilterSections />}
              <DropdownMenuItem
                disabled={!sidebarStore.hasActiveFiltersInCurrentView}
                onClick={() => sidebarStore.clearFilters()}
              >
                Clear filters
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => sidebarStore.collapseAll()}>
                <ChevronsDownUp className="mr-1.5 h-4 w-4" />
                Collapse all
              </DropdownMenuItem>
              <DropdownMenuSeparator />
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
        <ViewGroupingToggle />
      </div>
      {/* Outside the tree's scroller, so it stays put as the list scrolls. */}
      <div className="px-2 pb-1">
        <button
          type="button"
          onClick={() => showCreateSessionModal({})}
          className="flex w-full cursor-pointer items-center gap-[9px] rounded-lg px-[9px] py-[6px] text-sm text-foreground-muted transition-colors hover:bg-[var(--sel-soft)] hover:text-foreground"
        >
          <Plus className="size-4 shrink-0" />
          New Session
        </button>
      </div>
    </>
  );
});
