/**
 * Agent-bridge event shapes and notification formatting, mirrored from the
 * Claude Code connector channel (`connectors/.../channel/server.ts`). switchdash
 * polls the same `/agents/{id}/rooms/{room}/events` endpoint and injects the
 * formatted text into the session's PTY instead of delivering it as an MCP
 * channel notification.
 */

/**
 * A pointer to a media attachment on a message event. Mirrors the agent
 * bridge's `AttachmentRef` (and the connector channel's) — metadata plus the
 * Matrix `mxc://` URI only; the bytes are fetched on demand via the
 * media-download endpoint.
 */
export interface AttachmentRef {
  filename: string;
  mimetype: string;
  size: number;
  mxc: string;
  msgtype: string;
}

export interface MessagePayload {
  addressed: boolean;
  sender: string;
  sender_name: string;
  message_id: string;
  body: string;
  timestamp: number;
  thread_id?: string | null;
  attachments?: AttachmentRef[];
}

export interface CommandPayload {
  command: string;
  // Command arguments. For `reset`/`compact` this carries the role name the
  // agent should re-assume after its context is cleared/compacted (empty when
  // it held none).
  args: string;
  user_id: string;
  user_name: string;
  // Thread root of the originating command message, so the completion notice
  // can be posted back into that same thread. null when not in a thread.
  thread_id?: string | null;
}

export interface RoomJoinPayload {
  member: string;
  member_name: string;
  timestamp: number;
  listening: boolean;
}

export interface TaskPayload {
  task_id: string;
  requester_agent_id: string;
  performer_agent_id: string;
  summary?: string;
  description?: string;
  update?: string;
  outcome?: string | null;
  reason?: string | null;
}

export interface AgentBridgeEvent {
  type: string;
  room_id: string;
  payload: MessagePayload | CommandPayload | RoomJoinPayload | TaskPayload;
}

export interface AgentBridgeEventResponse {
  events: AgentBridgeEvent[];
}

/**
 * Format an agent-bridge event as a self-contained line to inject into the
 * session. Returns null for events that should not surface (unaddressed room
 * chatter, join events the agent is not listening for) — mirroring the
 * channel's filtering so the two pollers behave identically.
 *
 * `roomName` is the human-readable room name (from connect_to_room); the raw
 * room id is used as a fallback when it is unknown.
 */
export function formatEventForInjection(
  event: AgentBridgeEvent,
  roomName?: string | null
): string | null {
  const { type, payload } = event;
  const room = roomName ?? event.room_id;

  switch (type) {
    case 'message': {
      const msg = payload as MessagePayload;
      if (!msg.addressed) return null;
      // Always surface message_id; surface thread_id only when the message is
      // genuinely in a thread, so a root-level message isn't mistaken for a
      // threaded one. The agent can still open a thread on a root message by
      // replying with its message_id.
      const ids = msg.thread_id
        ? `message_id ${msg.message_id}, thread_id ${msg.thread_id}`
        : `message_id ${msg.message_id}`;
      return `[Switch] ${msg.sender_name} addressed you in room ${room} (${ids}): ${msg.body}`;
    }
    case 'command': {
      const cmd = payload as CommandPayload;
      return `[Switch] Command in room ${room}: ${cmd.command}${
        cmd.args ? ` args=${cmd.args}` : ''
      }`;
    }
    case 'room_join': {
      const join = payload as RoomJoinPayload;
      if (!join.listening) return null;
      return `[Switch] ${join.member_name} joined room ${room}`;
    }
    case 'task_delegate': {
      const task = payload as TaskPayload;
      return `[Switch] Task delegated to you in room ${room}: ${task.summary ?? ''} — ${
        task.description ?? ''
      }`;
    }
    case 'task_accept': {
      const task = payload as TaskPayload;
      return `[Switch] Task ${task.task_id} accepted by ${task.performer_agent_id}`;
    }
    case 'task_update': {
      const task = payload as TaskPayload;
      return `[Switch] Task ${task.task_id} update: ${task.update ?? ''}`;
    }
    case 'task_finalise': {
      const task = payload as TaskPayload;
      return `[Switch] Task ${task.task_id} finalised: ${task.outcome ?? '(no outcome provided)'}`;
    }
    case 'task_cancel': {
      const task = payload as TaskPayload;
      return `[Switch] Task ${task.task_id} cancelled${task.reason ? `: ${task.reason}` : ''}`;
    }
    default:
      return null;
  }
}

/**
 * Annotation appended to an injected message that carried image attachments.
 * Unlike the connector channel — which surfaces images as an `image_path`
 * notification attribute plus a static instruction — the pollers inject plain
 * text into a PTY/tmux pane and have no separate metadata channel, so the
 * annotation itself must both signal the attachments and tell the agent how to
 * view them. `localPaths` are the local files the images were downloaded to.
 */
export function formatImageAttachmentAnnotation(localPaths: string[]): string {
  const count = localPaths.length;
  const noun = count === 1 ? 'image' : 'images';
  return `(${count} ${noun} attached — downloaded to ${localPaths.join(', ')}. Read ${
    count === 1 ? 'it' : 'them'
  } to view.)`;
}
