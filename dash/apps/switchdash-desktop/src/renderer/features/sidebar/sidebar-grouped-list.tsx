import { observer } from 'mobx-react-lite';
import { Fragment, useEffect } from 'react';
import { agentsStore } from '@renderer/features/locations/stores/agents-store';
import type { LocationStore } from '@renderer/features/locations/stores/location';
import { hostReachabilityStore } from '@renderer/features/remote-hosts/host-reachability-store';
import type { SessionStore } from '@renderer/features/sessions/stores/session-store';
import { switchRoomsStore as roomConnectionsStore } from '@renderer/features/switch-rooms/switch-rooms-store';
import { switchRoomsStore } from '@renderer/features/switch-servers/switch-rooms-store';
import { switchServersStore } from '@renderer/features/switch-servers/switch-servers-store';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import type { Agent } from '@shared/core/agents/agents';
import { SidebarAgentItem, agentExpandKey } from './agent-item';
import { SidebarSessionItem } from './session-item';
import {
  groupByRoom,
  openRoomInGateway,
  openRoomView,
  openRoomInMessagingApp,
  isRoomViewActive,
  RoomRow,
  roomLabel,
} from './sidebar-room-grouping';
import { agentRoomGroupKey, roomViewGroupKey, UNASSIGNED_ROOM_KEY } from './sidebar-store';

/** An agent paired with its (mounted) location, for the flat sidebar list. */
type AgentEntry = { agent: Agent; location: LocationStore };

/**
 * The flat list of agents in the active-server scope, newest first. switchdash
 * shows agents as a flat list — not grouped by directory (CHOO-1440).
 */
function scopedAgents(): AgentEntry[] {
  const entries: AgentEntry[] = [];
  for (const location of sidebarStore.filteredLocations) {
    for (const agent of agentsStore.byLocation.get(location.id) ?? []) {
      entries.push({ agent, location });
    }
  }
  return entries.sort(
    (a, b) =>
      b.agent.createdAt.localeCompare(a.agent.createdAt) || a.agent.name.localeCompare(b.agent.name)
  );
}

/**
 * An agent's visible sessions: the location's sessions it owns. Sessions are
 * paired to their agent by `agent_id` — the authoritative link — not by matching
 * a name frozen into the session's config against the agent's definition. A
 * session whose owning agent no longer matches by name is still shown under its
 * agent instead of silently vanishing (CHOO-1440).
 */
function agentSessions(entry: AgentEntry): SessionStore[] {
  const all = sidebarStore.visibleSessionsForLocation(entry.location.id);
  return all.filter(
    (session) => 'agentId' in session.data && session.data.agentId === entry.agent.id
  );
}

/** Every scoped agent that has a Switch identity, as membership-lookup keys. */
function switchIdentities(): { serverId: string; switchAgentId: string }[] {
  const identities: { serverId: string; switchAgentId: string }[] = [];
  for (const { agent } of scopedAgents()) {
    if (agent.serverId && agent.switchAgentId) {
      identities.push({ serverId: agent.serverId, switchAgentId: agent.switchAgentId });
    }
  }
  return identities;
}

export const SidebarGroupedList = observer(function SidebarGroupedList() {
  // Live session→room connections + room names live on the server; pull them
  // once on mount and refresh names on focus so headers show names not ids.
  useEffect(() => {
    roomConnectionsStore.ensureLoaded();
    void hostReachabilityStore.hydrate();
    // Room membership is what puts an agent under a room, so it is loaded for
    // every agent up front rather than lazily per row.
    const loadRooms = async (force: boolean) => {
      await agentsStore.load();
      await switchRoomsStore.ensureMembershipsFor(switchIdentities(), { force });
    };
    void loadRooms(false);
    void switchServersStore.init().then(() => switchRoomsStore.loadRoomNames());
    const onFocus = () => {
      void loadRooms(true);
      void switchRoomsStore.loadRoomNames();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const showFilterEmptyState =
    sidebarStore.hasActiveFilters && sidebarStore.filteredLocations.length === 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-3">
      {showFilterEmptyState ? (
        <p className="px-2 py-3 text-xs text-foreground-muted">No agents match filters</p>
      ) : sidebarStore.grouping === 'room' ? (
        <RoomFocusedTree />
      ) : (
        <AgentFocusedTree />
      )}
    </div>
  );
});

/** Render an agent's sessions grouped by room, under the agent row. */
const AgentSessions = observer(function AgentSessions({
  agentId,
  locationId,
  sessions,
  depth,
}: {
  agentId: string;
  locationId: string;
  sessions: SessionStore[];
  depth: number;
}) {
  return (
    <>
      {groupByRoom(sessions).map(([roomKey, roomSessions]) => {
        // Sessions with no room sit directly under the agent, no room header.
        if (roomKey === UNASSIGNED_ROOM_KEY) {
          return roomSessions.map((session) => (
            <SidebarSessionItem
              key={session.data.id}
              locationId={locationId}
              sessionId={session.data.id}
              depth={depth}
            />
          ));
        }
        const groupKey = agentRoomGroupKey(agentId, roomKey);
        const roomExpanded = sidebarStore.isGroupExpanded(groupKey);
        return (
          <div key={roomKey}>
            <RoomRow
              label={roomLabel(roomKey)}
              count={roomSessions.length}
              expanded={roomExpanded}
              depth={depth}
              bridgeType={switchRoomsStore.roomBridgeTypeById(roomKey)}
              onToggle={() => sidebarStore.toggleGroupExpanded(groupKey)}
              onSelect={roomKey === UNASSIGNED_ROOM_KEY ? null : () => openRoomView(roomKey)}
              isActive={isRoomViewActive(roomKey)}
              onOpenGateway={() => openRoomInGateway(roomKey)}
              onOpenChannel={
                switchRoomsStore.roomChannelUrl(roomKey)
                  ? () => openRoomInMessagingApp(roomKey)
                  : null
              }
            />
            {roomExpanded &&
              roomSessions.map((session) => (
                <SidebarSessionItem
                  key={session.data.id}
                  locationId={locationId}
                  sessionId={session.data.id}
                  depth={depth + 1}
                />
              ))}
          </div>
        );
      })}
    </>
  );
});

const AgentFocusedTree = observer(function AgentFocusedTree() {
  const agents = scopedAgents();
  return (
    <>
      {agents.map((entry) => {
        const expanded = sidebarStore.isGroupExpanded(agentExpandKey(entry.agent.id));
        return (
          <div key={entry.agent.id}>
            <SidebarAgentItem agent={entry.agent} depth={0} />
            {expanded && (
              <AgentSessions
                agentId={entry.agent.id}
                locationId={entry.agent.locationId}
                sessions={agentSessions(entry)}
                depth={1}
              />
            )}
          </div>
        );
      })}
    </>
  );
});

const RoomFocusedTree = observer(function RoomFocusedTree() {
  const showCreateSessionModal = useShowModal('sessionModal');
  // Tag every visible session with the agent it belongs to, then group by room.
  const bySession = new Map<string, AgentEntry>();
  const allSessions: SessionStore[] = [];
  for (const entry of scopedAgents()) {
    for (const session of agentSessions(entry)) {
      bySession.set(session.data.id, entry);
      allSessions.push(session);
    }
  }

  // Which agents belong to which room, from membership rather than from live
  // sessions — an agent is in a room whether or not it is currently running
  // there, and the room list should say so.
  const membersByRoom = new Map<string, AgentEntry[]>();
  for (const entry of scopedAgents()) {
    const { serverId, switchAgentId } = entry.agent;
    if (!serverId || !switchAgentId) continue;
    for (const membership of switchRoomsStore.roomsFor(serverId, switchAgentId) ?? []) {
      if (membership.archived) continue;
      const list = membersByRoom.get(membership.roomId);
      if (list) list.push(entry);
      else membersByRoom.set(membership.roomId, [entry]);
    }
  }

  // A room is listed when it has a session, when one of this app's agents is a
  // member of it, or when the signed-in user owns it — so a room you created,
  // or one your agents live in, does not wait on a session to become visible.
  const alwaysShow = [
    ...new Set([
      ...switchRoomsStore.ownedRoomsInActiveScope.map((room) => room.id),
      ...membersByRoom.keys(),
    ]),
  ];

  return (
    <>
      {groupByRoom(allSessions, alwaysShow).map(([roomKey, roomSessions]) => {
        const roomViewKey = roomViewGroupKey(roomKey);
        const expanded = sidebarStore.isGroupExpanded(roomViewKey);
        // Agents with a session here first, in first-seen order, then the rest
        // of the room's members — a member with nothing running is still in the
        // room, and hiding it makes the room look emptier than it is.
        const seen = new Set<string>();
        const agentsInRoom: AgentEntry[] = [];
        for (const session of roomSessions) {
          const entry = bySession.get(session.data.id);
          if (entry && !seen.has(entry.agent.id)) {
            seen.add(entry.agent.id);
            agentsInRoom.push(entry);
          }
        }
        for (const entry of membersByRoom.get(roomKey) ?? []) {
          if (seen.has(entry.agent.id)) continue;
          seen.add(entry.agent.id);
          agentsInRoom.push(entry);
        }
        return (
          <div key={roomKey}>
            <RoomRow
              label={roomLabel(roomKey)}
              count={roomSessions.length}
              expanded={expanded}
              depth={0}
              bridgeType={switchRoomsStore.roomBridgeTypeById(roomKey)}
              onToggle={() => sidebarStore.toggleGroupExpanded(roomViewKey)}
              onSelect={roomKey === UNASSIGNED_ROOM_KEY ? null : () => openRoomView(roomKey)}
              isActive={isRoomViewActive(roomKey)}
              onOpenGateway={() => openRoomInGateway(roomKey)}
              onOpenChannel={
                switchRoomsStore.roomChannelUrl(roomKey)
                  ? () => openRoomInMessagingApp(roomKey)
                  : null
              }
              onNewSession={
                roomKey === UNASSIGNED_ROOM_KEY
                  ? null
                  : () => showCreateSessionModal({ roomId: roomKey })
              }
            />
            {expanded &&
              agentsInRoom.map((entry) => {
                const agentSessionsHere = roomSessions.filter(
                  (session) => bySession.get(session.data.id)?.agent.id === entry.agent.id
                );
                // The agent row owns this key and its chevron reflects it, so
                // the sessions under it have to honour the same one or the
                // chevron lies.
                const agentExpanded = sidebarStore.isGroupExpanded(agentExpandKey(entry.agent.id));
                return (
                  <Fragment key={entry.agent.id}>
                    <SidebarAgentItem
                      agent={entry.agent}
                      depth={1}
                      roomId={roomKey === UNASSIGNED_ROOM_KEY ? null : roomKey}
                    />
                    {agentExpanded &&
                      agentSessionsHere.map((session) => (
                        <SidebarSessionItem
                          key={session.data.id}
                          locationId={entry.agent.locationId}
                          sessionId={session.data.id}
                          depth={2}
                        />
                      ))}
                  </Fragment>
                );
              })}
          </div>
        );
      })}
    </>
  );
});
