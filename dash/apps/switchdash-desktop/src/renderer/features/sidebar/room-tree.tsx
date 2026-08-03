import { observer } from 'mobx-react-lite';
import { Fragment } from 'react';
import type { SessionStore } from '@renderer/features/sessions/stores/session-store';
import { switchRoomsStore } from '@renderer/features/switch-servers/switch-rooms-store';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { agentExpandKey, SidebarAgentItem } from './agent-item';
import { SidebarSessionItem } from './session-item';
import {
  groupByRoom,
  isRoomViewActive,
  openRoomInGateway,
  openRoomInMessagingApp,
  openRoomView,
  RoomRow,
  roomLabel,
} from './sidebar-room-grouping';
import { roomViewGroupKey, UNASSIGNED_ROOM_KEY } from './sidebar-store';
import { type AgentEntry, agentSessions, scopedAgents } from './sidebar-tree-data';

/**
 * The room-grouped sidebar: rooms at the top level, their member agents
 * beneath, and each agent's sessions in that room below that.
 *
 * A room here is a place, not a property of a session — it is listed because it
 * exists and concerns you, and its rows act on the room itself (add a member,
 * remove one, open the channel). That is why this is a separate tree from the
 * agent-grouped one rather than the same tree with the nesting inverted.
 */

/** Which of this app's agents belong to which room, from membership rather than
 * from live sessions — an agent is in a room whether or not it is running
 * there. */
function membersByRoom(): Map<string, AgentEntry[]> {
  const byRoom = new Map<string, AgentEntry[]>();
  for (const entry of scopedAgents()) {
    const { serverId, switchAgentId } = entry.agent;
    if (!serverId || !switchAgentId) continue;
    for (const membership of switchRoomsStore.roomsFor(serverId, switchAgentId) ?? []) {
      if (membership.archived) continue;
      const list = byRoom.get(membership.roomId);
      if (list) list.push(entry);
      else byRoom.set(membership.roomId, [entry]);
    }
  }
  return byRoom;
}

/** Agents with a session in the room first, in first-seen order, then its other
 * members — a member with nothing running is still in the room, and hiding it
 * makes the room look emptier than it is. */
function agentsForRoom(
  roomSessions: SessionStore[],
  bySession: Map<string, AgentEntry>,
  members: AgentEntry[]
): AgentEntry[] {
  const seen = new Set<string>();
  const ordered: AgentEntry[] = [];
  const add = (entry: AgentEntry | undefined) => {
    if (!entry || seen.has(entry.agent.id)) return;
    seen.add(entry.agent.id);
    ordered.push(entry);
  };
  for (const session of roomSessions) add(bySession.get(session.data.id));
  for (const entry of members) add(entry);
  return ordered;
}

export const RoomTree = observer(function RoomTree() {
  const showAddAgentsToRoomModal = useShowModal('addAgentsToRoomModal');

  // Tag every visible session with the agent it belongs to, then group by room.
  const bySession = new Map<string, AgentEntry>();
  const allSessions: SessionStore[] = [];
  for (const entry of scopedAgents()) {
    for (const session of agentSessions(entry)) {
      bySession.set(session.data.id, entry);
      allSessions.push(session);
    }
  }

  const members = membersByRoom();
  // A room is listed when it has a session, when one of this app's agents is a
  // member of it, or when the signed-in user owns it — so a room you created,
  // or one your agents live in, does not wait on a session to become visible.
  const alwaysShow = [
    ...new Set([
      ...switchRoomsStore.ownedRoomsInActiveScope.map((room) => room.id),
      ...members.keys(),
    ]),
  ];

  return (
    <>
      {groupByRoom(allSessions, alwaysShow).map(([roomKey, roomSessions]) => {
        const roomViewKey = roomViewGroupKey(roomKey);
        const expanded = sidebarStore.isGroupExpanded(roomViewKey);
        const isRoom = roomKey !== UNASSIGNED_ROOM_KEY;
        const agentsInRoom = agentsForRoom(roomSessions, bySession, members.get(roomKey) ?? []);
        return (
          <div key={roomKey}>
            <RoomRow
              label={roomLabel(roomKey)}
              count={roomSessions.length}
              expanded={expanded}
              depth={0}
              bridgeType={switchRoomsStore.roomBridgeTypeById(roomKey)}
              onToggle={() => sidebarStore.toggleGroupExpanded(roomViewKey)}
              onSelect={isRoom ? () => openRoomView(roomKey) : null}
              isActive={isRoomViewActive(roomKey)}
              onOpenGateway={() => openRoomInGateway(roomKey)}
              onOpenChannel={
                switchRoomsStore.roomChannelUrl(roomKey)
                  ? () => openRoomInMessagingApp(roomKey)
                  : null
              }
              onAddAgent={isRoom ? () => showAddAgentsToRoomModal({ roomId: roomKey }) : null}
            />
            {expanded &&
              agentsInRoom.map((entry) => {
                const sessionsHere = roomSessions.filter(
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
                      roomId={isRoom ? roomKey : null}
                    />
                    {agentExpanded &&
                      sessionsHere.map((session) => (
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
