#!/usr/bin/env bun
/**
 * Switch channel for Claude Code.
 *
 * Polls the Switch Agent Bridge for room events and pushes addressed messages
 * and task events into the Claude Code session as channel notifications.
 *
 * The polling target is set by the PostToolUse hook on connect_to_room, which
 * POSTs the room id to a localhost port this server exposes. The port is
 * advertised at `${CLAUDE_PLUGIN_DATA}/sessions/${ppid}/port`, where ppid is
 * this process's parent PID (the Claude Code session). The hook resolves the
 * same path from its own getppid(), so each session's hook reaches its own
 * channel without any cross-session coordination.
 *
 * Config comes from env vars set via .mcp.json env block (SWITCH_*).
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const API_ENDPOINT = process.env.SWITCH_API_ENDPOINT ?? ''
const API_TOKEN = process.env.SWITCH_API_TOKEN ?? ''
const AGENT_ID = process.env.SWITCH_AGENT_ID ?? ''

// When this session is managed by switchdash, switchdash polls the agent
// bridge for room events and injects addressed messages into the PTY itself.
// The bridge's per-room event queue is destructive (each event is delivered to
// a single poller), so this channel must NOT also poll or the two would steal
// each other's events. We still renew liveness and role leases — only the event
// poll loop is suppressed.
const DISABLE_POLL = process.env.SWITCH_CHANNEL_DISABLE_POLL === '1'

// Claude Code may spawn this server twice on startup: once before settings.env
// expansion (vars literal as `${SWITCH_*}`) and once with real values. Reject
// the unresolved spawn so it doesn't race the real one for the port file.
function looksUnresolved(value: string): boolean {
  return value.startsWith('${') && value.endsWith('}')
}

if (
  !API_ENDPOINT || !API_TOKEN || !AGENT_ID ||
  looksUnresolved(API_ENDPOINT) || looksUnresolved(API_TOKEN) || looksUnresolved(AGENT_ID)
) {
  process.stderr.write(
    `switch-channel: missing or unresolved config — need SWITCH_API_ENDPOINT, SWITCH_API_TOKEN, and SWITCH_AGENT_ID\n` +
    `  endpoint=${API_ENDPOINT || 'MISSING'}\n` +
    `  token=${API_TOKEN ? 'set' : 'MISSING'}\n` +
    `  agent_id=${AGENT_ID || 'MISSING'}\n` +
    `If these look like \`\${SWITCH_*}\`, the env block in \`.claude/settings.local.json\` has not been expanded — run the \`configure\` skill.\n`,
  )
  process.exit(1)
}

const SESSION_PPID = process.ppid
const SESSION_DIR = path.join(os.homedir(), '.switch', 'sessions', String(SESSION_PPID))
const PORT_FILE = path.join(SESSION_DIR, 'port')
process.stderr.write(
  `switch-channel: ppid=${SESSION_PPID} session_dir=${SESSION_DIR}\n`,
)

process.on('unhandledRejection', err => {
  process.stderr.write(`switch-channel: unhandled rejection: ${err}\n`)
})
process.on('uncaughtException', err => {
  process.stderr.write(`switch-channel: uncaught exception: ${err}\n`)
})

// -- Types matching core/switch_core/bridges/agent/events.py ----------------------

type AttachmentRef = {
  filename: string
  mimetype: string
  size: number
  mxc: string
  msgtype: string
}

type MessagePayload = {
  addressed: boolean
  sender: string
  sender_name: string
  message_id: string
  body: string
  timestamp: number
  thread_id?: string | null
  attachments?: AttachmentRef[]
}

type CommandPayload = {
  command: string
  target: string | null
  user_id: string
  user_name: string
}

type RoomJoinPayload = {
  member: string
  member_name: string
  timestamp: number
  listening: boolean
}

type TaskDelegatePayload = {
  task_id: string
  requester_agent_id: string
  performer_agent_id: string
  summary: string
  description: string
}

type TaskAcceptPayload = {
  task_id: string
  requester_agent_id: string
  performer_agent_id: string
}

type TaskUpdatePayload = {
  task_id: string
  requester_agent_id: string
  performer_agent_id: string
  update: string
}

type TaskFinalisePayload = {
  task_id: string
  requester_agent_id: string
  performer_agent_id: string
  outcome: string | null
}

type TaskCancelPayload = {
  task_id: string
  requester_agent_id: string
  performer_agent_id: string
  reason: string | null
}

type AgentEvent = {
  type: string
  room_id: string
  bridge_id: string | null
  channel_type: string | null
  payload: MessagePayload | CommandPayload | RoomJoinPayload | TaskDelegatePayload | TaskAcceptPayload | TaskUpdatePayload | TaskFinalisePayload | TaskCancelPayload
}

type EventResponse = {
  events: AgentEvent[]
}

// -- Polling state -----------------------------------------------------------

let pollingRoomId: string | null = null
let pollAbort: AbortController | null = null
let leaseAbort: AbortController | null = null
let connRenewAbort: AbortController | null = null

// Unaddressed room messages are filtered out (never reach Claude as a
// notification), so the agent silently falls behind on room chatter. We tally
// how many we've dropped since the agent last read context and surface that
// count on every notification we DO emit, so the agent knows when to call
// read_context to catch up. Reset to 0 when the agent reads context (signalled
// by the /read-context hook) and when polling switches rooms.
let missedSinceRead = 0

// -- MCP server --------------------------------------------------------------

const mcp = new Server(
  { name: 'switch-channel', version: '0.0.1' },
  {
    capabilities: {
      tools: {},
      experimental: {
        'claude/channel': {},
      },
    },
    instructions: [
      'Events from Switch rooms arrive as <channel source="switch-channel" room_id="..." event_type="..." ...>.',
      'Only addressed messages, room_join events, and task events are delivered — unaddressed room chatter is filtered out.',
      '',
      'A room_join event fires when a user or agent joins a room — but you are only notified for rooms where you are configured to receive join events (per-room, per-agent; off by default, set via the join_event_listeners option on create_room / update_room or the gateway). The meta carries member (their matrix id) and member_name (their display name). React if it is relevant — e.g. a welcome agent greets the new arrival and explains the room via post_message, or send_targeted_message to address them directly. Your own join does not produce a room_join event.',
      '',
      'Every notification carries a `missed_count` in its meta: the number of unaddressed room messages filtered out since you last called read_context. When it is above 0 the one-line body is annotated with it. A growing count means the room is active around you and you have fallen behind — call read_context (widen `since` to cover the gap) to catch up on what you missed. The count resets to 0 when you call read_context.',
      '',
      'Polling is automatic: when you call connect_to_room on the switch MCP server, a PostToolUse hook pushes the room id to this channel over a localhost port. Polling begins (or switches rooms) immediately. No separate tool call is needed.',
      '',
      'When you receive a message event:',
      '1. Call read_context with the since parameter set to a timestamp a few minutes before the event timestamp to get recent conversation context without re-reading the full history.',
      '2. Understand what is being asked or discussed.',
      '3. Respond by calling post_message (or send_targeted_message if addressing a specific agent).',
      '',
      'If a message event has an image_path attribute, the sender attached one or more images. Each path is a local file already downloaded for you (comma-separated if several) — Read it to see the image before responding.',
      '',
      'To view an image that appears in read_context history but did NOT arrive with an image_path (e.g. an unaddressed image posted earlier), call the download_attachment tool with the attachment\'s mxc (from the read_context attachments field). It writes the file locally and returns the path — then Read that path.',
      '',
      'When you receive a task_delegate event (only delivered if your integration profile has can_accept=true):',
      '1. Call accept_task with the task_id to move it to ongoing.',
      '2. Call read_context with since to understand the conversation context.',
      '3. Perform the work described in the task. Optionally call update_task(task_id, update) with progress messages as you work — these are persisted.',
      '4. Call finalise_task(task_id, outcome) with a one-string description of what happened (success or failure).',
      '',
      'When you receive task_accept, task_update, or task_finalise events for tasks you delegated, review the progress/outcome and continue your work accordingly.',
      'When you receive a task_cancel event, the task is dead — do not finalise it.',
      '',
      'You must be connected to the room (via connect_to_room) before calling read_context, post_message, send_targeted_message, or any task tool.',
    ].join('\n'),
  },
)

// Addressed images are auto-downloaded and surfaced as image_path on the
// notification. This tool lets the agent fetch ANY attachment on demand — e.g.
// an image seen in read_context history that arrived unaddressed (no
// notification, so no image_path). It writes the bytes to a local file and
// returns the path, which the agent then Reads.
const DOWNLOAD_ATTACHMENT_TOOL = {
  name: 'download_attachment',
  description:
    "Download a room attachment (by its mxc:// URI, as returned in an " +
    "attachment's `mxc` field from read_context) to a local file and return " +
    "the path. Use this to view an image from history that did not arrive " +
    'with an image_path. Operates on the currently connected room unless ' +
    'room_id is given.',
  inputSchema: {
    type: 'object',
    properties: {
      mxc: {
        type: 'string',
        description: "The attachment's mxc:// URI (from a read_context attachment).",
      },
      filename: {
        type: 'string',
        description: 'Optional original filename, used to name the local file.',
      },
      room_id: {
        type: 'string',
        description:
          'Optional Switch room id. Defaults to the currently polling room.',
      },
    },
    required: ['mxc'],
  },
}

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [DOWNLOAD_ATTACHMENT_TOOL],
}))

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  if (req.params.name !== 'download_attachment') {
    throw new Error(`Unknown tool: ${req.params.name}`)
  }
  const args = (req.params.arguments ?? {}) as {
    mxc?: string
    filename?: string
    room_id?: string
  }
  const mxc = typeof args.mxc === 'string' ? args.mxc : ''
  if (!mxc) {
    return { isError: true, content: [{ type: 'text', text: 'mxc is required' }] }
  }
  const roomId = args.room_id ?? pollingRoomId
  if (!roomId) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: 'Not connected to a room — call connect_to_room first or pass room_id.',
        },
      ],
    }
  }
  const mediaId = mxc.split('/').pop() || 'attachment'
  const destName = `${sanitiseName(mediaId)}-${sanitiseName(args.filename ?? '')}`
  try {
    const path = await fetchMediaToFile(roomId, mxc, destName)
    return { content: [{ type: 'text', text: path }] }
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Download failed: ${err}` }],
    }
  }
})

// -- Polling loop ------------------------------------------------------------

function stopPolling() {
  if (pollAbort) {
    pollAbort.abort()
    pollAbort = null
  }
  pollingRoomId = null
}

function startPolling(roomId: string) {
  const abort = new AbortController()
  pollAbort = abort
  pollingRoomId = roomId
  // Fresh room → fresh backlog. The agent reads context on arrival anyway.
  missedSinceRead = 0

  void (async () => {
    let backoff = 1000

    while (!abort.signal.aborted) {
      try {
        const url = `${API_ENDPOINT}/agents/${AGENT_ID}/rooms/${roomId}/events?timeout=10`
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${API_TOKEN}` },
          signal: abort.signal,
        })

        if (resp.status === 204) {
          backoff = 1000
          continue
        }

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${await resp.text()}`)
        }

        backoff = 1000
        const data = (await resp.json()) as EventResponse

        for (const event of data.events) {
          await handleEvent(event)
        }
      } catch (err) {
        if (abort.signal.aborted) return

        process.stderr.write(`switch-channel: poll error: ${err}, retrying in ${backoff / 1000}s\n`)
        await new Promise(r => setTimeout(r, backoff))
        backoff = Math.min(backoff * 2, 30000)
      }
    }
  })()
}

// -- Room reconciliation ------------------------------------------------------

function setConnectedRoom(target: string | null) {
  if (target === pollingRoomId) return

  if (pollingRoomId) {
    process.stderr.write(`switch-channel: leaving room ${pollingRoomId}\n`)
    stopPolling()
    stopConnectionRenew()
  }

  if (target) {
    // Track the connected room even when polling is suppressed so room-change
    // dedup and download_attachment's default room still work.
    pollingRoomId = target
    missedSinceRead = 0
    if (DISABLE_POLL) {
      process.stderr.write(
        `switch-channel: polling disabled (switchdash-managed) — renewing liveness only for room ${target}\n`,
      )
    } else {
      process.stderr.write(`switch-channel: starting poll for room ${target}\n`)
      startPolling(target)
    }
    startConnectionRenew(target)
  }
}

// -- Connection liveness renewal --------------------------------------------
//
// While connected to a room, renew the room-scoped liveness heartbeat on a
// fast cadence, decoupled from the long-poll. The server keeps the connection
// "live" only while these renews arrive (SESSION_TTL), so a closed/crashed
// session drops to "no session" within seconds instead of waiting out a long
// poll-derived window. stopped on disconnect and re-targeted on room change.

const CONNECTION_RENEW_INTERVAL_MS = 2000

function stopConnectionRenew() {
  if (connRenewAbort) {
    connRenewAbort.abort()
    connRenewAbort = null
  }
}

function startConnectionRenew(roomId: string) {
  stopConnectionRenew()
  const abort = new AbortController()
  connRenewAbort = abort

  void (async () => {
    while (!abort.signal.aborted) {
      try {
        await fetch(`${API_ENDPOINT}/agents/${AGENT_ID}/connection/renew`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ room_id: roomId }),
          signal: abort.signal,
        })
      } catch (err) {
        if (abort.signal.aborted) return
        process.stderr.write(`switch-channel: connection renew error: ${err}\n`)
      }
      await new Promise(r => setTimeout(r, CONNECTION_RENEW_INTERVAL_MS))
    }
  })()
}

// -- Role lease renewal ------------------------------------------------------
//
// While this session holds a room-role, renew the lease on a fast cadence so an
// (exclusive) seat stays held. The server frees a lease shortly after renewals
// stop (TTL), so a crashed/closed session auto-releases. release_role and a
// clean disconnect stop the loop immediately.

const LEASE_RENEW_INTERVAL_MS = 2000

function stopLeaseRenew() {
  if (leaseAbort) {
    leaseAbort.abort()
    leaseAbort = null
  }
}

function startLeaseRenew() {
  if (leaseAbort) return // already renewing
  const abort = new AbortController()
  leaseAbort = abort

  void (async () => {
    while (!abort.signal.aborted) {
      try {
        const resp = await fetch(`${API_ENDPOINT}/agents/${AGENT_ID}/leases/renew`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${API_TOKEN}` },
          signal: abort.signal,
        })
        if (resp.ok) {
          const data = (await resp.json()) as { held?: boolean }
          // The server says we hold no lease — nothing to renew, stop the loop.
          if (data.held === false) {
            stopLeaseRenew()
            return
          }
        }
      } catch (err) {
        if (abort.signal.aborted) return
        process.stderr.write(`switch-channel: lease renew error: ${err}\n`)
      }
      await new Promise(r => setTimeout(r, LEASE_RENEW_INTERVAL_MS))
    }
  })()
}

// -- Hook listener: localhost-only port advertised via PORT_FILE ------------

function publishPort(port: number) {
  fs.mkdirSync(SESSION_DIR, { recursive: true })
  fs.writeFileSync(PORT_FILE, String(port))
}

function unpublishPort() {
  try {
    fs.rmSync(SESSION_DIR, { recursive: true, force: true })
  } catch (err) {
    process.stderr.write(`switch-channel: failed to clean up ${SESSION_DIR}: ${err}\n`)
  }
}

function startHookListener() {
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url)
      if (req.method !== 'POST') {
        return new Response('method not allowed', { status: 405 })
      }

      if (url.pathname === '/connect') {
        let body: { room_id?: unknown }
        try {
          body = (await req.json()) as { room_id?: unknown }
        } catch {
          return new Response('bad json', { status: 400 })
        }
        const roomId = typeof body.room_id === 'string' ? body.room_id : null
        if (!roomId) {
          return new Response('missing room_id', { status: 400 })
        }
        setConnectedRoom(roomId)
        return new Response('ok')
      }

      if (url.pathname === '/disconnect') {
        setConnectedRoom(null)
        stopLeaseRenew()
        return new Response('ok')
      }

      if (url.pathname === '/assume-role') {
        startLeaseRenew()
        return new Response('ok')
      }

      if (url.pathname === '/release-role') {
        stopLeaseRenew()
        return new Response('ok')
      }

      if (url.pathname === '/read-context') {
        // The agent called read_context, so it has caught up on room history —
        // clear the missed-message backlog we've been tallying.
        missedSinceRead = 0
        return new Response('ok')
      }

      if (url.pathname === '/turn-end') {
        // The Claude Code turn finished. Clear the "thinking" indicator in case
        // the agent ended without posting a reply — Slack's faked indicator is
        // a real message that lingers until explicitly deleted (the reply path
        // clears it server-side, but a no-reply turn would otherwise leave it).
        if (pollingRoomId) void setTyping(pollingRoomId, false)
        return new Response('ok')
      }

      return new Response('not found', { status: 404 })
    },
  })

  publishPort(server.port)
  process.stderr.write(
    `switch-channel: hook listener on http://127.0.0.1:${server.port} (published to ${PORT_FILE})\n`,
  )
}

// -- Event handling ----------------------------------------------------------

async function handleEvent(event: AgentEvent) {
  const { type, room_id, payload } = event

  if (type === 'message') {
    const msg = payload as MessagePayload
    if (!msg.addressed) {
      // Unaddressed chatter: filtered out, no notification. Tally it so the
      // next notification can tell the agent how far behind it has fallen.
      missedSinceRead++
      return
    }

    // Surface receipt feedback: tell the room's bridged channel that this
    // agent is "typing" so the human knows the message landed and we're
    // working on a reply. Fire-and-forget — typing feedback must never block
    // or fail event delivery. The indicator is cleared when the agent posts
    // its reply, and on turn end via the Stop hook (`/turn-end`) for the case
    // where the agent finishes without replying.
    void setTyping(room_id, true)

    // Materialise image attachments to local files so Claude can Read them.
    // image_path is the attribute the channel instructions tell Claude to read.
    const imagePaths: string[] = []
    const attachments = msg.attachments ?? []
    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i]
      if (!att.mimetype.startsWith('image/')) continue
      const localPath = await downloadAttachment(room_id, att, msg.message_id, i)
      if (localPath) imagePaths.push(localPath)
    }

    const ts = new Date(msg.timestamp).toISOString()
    await emitNotification(
      `[${msg.sender_name}]: ${msg.body}`,
      {
        room_id,
        event_type: type,
        sender: msg.sender,
        sender_name: msg.sender_name,
        message_id: msg.message_id,
        timestamp: ts,
        // Lets an addressed agent reply back into the same thread.
        ...(msg.thread_id ? { thread_id: msg.thread_id } : {}),
        ...(imagePaths.length ? { image_path: imagePaths.join(',') } : {}),
      },
    )
    return
  }

  if (type === 'command') {
    const cmd = payload as CommandPayload
    await emitNotification(
      `Command: ${cmd.command}${cmd.target ? ` target=${cmd.target}` : ''}`,
      {
        room_id,
        event_type: type,
        user_id: cmd.user_id,
        user_name: cmd.user_name,
      },
    )
    return
  }

  if (type === 'room_join') {
    const join = payload as RoomJoinPayload
    // This agent is opted out of join events in this room — deliver nothing.
    if (!join.listening) {
      return
    }
    await emitNotification(
      `${join.member_name} joined the room`,
      {
        room_id,
        event_type: type,
        member: join.member,
        member_name: join.member_name,
        timestamp: new Date(join.timestamp).toISOString(),
      },
    )
    return
  }

  if (type === 'task_delegate') {
    const task = payload as TaskDelegatePayload
    await emitNotification(
      `Task delegated: ${task.summary} — ${task.description}`,
      {
        room_id,
        event_type: type,
        task_id: task.task_id,
        requester_agent_id: task.requester_agent_id,
        performer_agent_id: task.performer_agent_id,
        summary: task.summary,
      },
    )
    return
  }

  if (type === 'task_accept') {
    const task = payload as TaskAcceptPayload
    await emitNotification(
      `Task accepted by ${task.performer_agent_id}`,
      {
        room_id,
        event_type: type,
        task_id: task.task_id,
        requester_agent_id: task.requester_agent_id,
        performer_agent_id: task.performer_agent_id,
      },
    )
    return
  }

  if (type === 'task_update') {
    const task = payload as TaskUpdatePayload
    await emitNotification(
      `Task update: ${task.update}`,
      {
        room_id,
        event_type: type,
        task_id: task.task_id,
        requester_agent_id: task.requester_agent_id,
        performer_agent_id: task.performer_agent_id,
      },
    )
    return
  }

  if (type === 'task_finalise') {
    const task = payload as TaskFinalisePayload
    await emitNotification(
      `Task finalised: ${task.outcome ?? '(no outcome provided)'}`,
      {
        room_id,
        event_type: type,
        task_id: task.task_id,
        requester_agent_id: task.requester_agent_id,
        performer_agent_id: task.performer_agent_id,
      },
    )
    return
  }

  if (type === 'task_cancel') {
    const task = payload as TaskCancelPayload
    await emitNotification(
      `Task cancelled${task.reason ? `: ${task.reason}` : ''}`,
      {
        room_id,
        event_type: type,
        task_id: task.task_id,
        requester_agent_id: task.requester_agent_id,
        performer_agent_id: task.performer_agent_id,
      },
    )
    return
  }

  process.stderr.write(`switch-channel: unknown event type: ${type}\n`)
}

const MEDIA_DIR = path.join(SESSION_DIR, 'media')

// Download an inbound attachment from the agent bridge to a local file so
// Claude can Read it. The bridge proxies the bytes out of the Matrix media
// repo (the channel holds only the bridge API token, not Matrix creds).
// Returns the local path, or null on failure (logged, never throws).
function sanitiseName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'attachment'
}

// Fetch an attachment's bytes from the agent bridge (which proxies the Matrix
// media repo) and write them to a local file under MEDIA_DIR. Throws on error.
async function fetchMediaToFile(
  roomId: string,
  mxc: string,
  destName: string,
): Promise<string> {
  const url =
    `${API_ENDPOINT}/agents/${AGENT_ID}/rooms/${roomId}/media` +
    `?mxc=${encodeURIComponent(mxc)}`
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
  })
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${await resp.text()}`)
  }
  const bytes = Buffer.from(await resp.arrayBuffer())
  fs.mkdirSync(MEDIA_DIR, { recursive: true })
  const dest = path.join(MEDIA_DIR, destName)
  fs.writeFileSync(dest, bytes)
  return dest
}

// Notification path: best-effort download (failures are logged, never thrown,
// so they can't break event delivery). Returns the local path or null.
async function downloadAttachment(
  roomId: string,
  att: AttachmentRef,
  messageId: string,
  index: number,
): Promise<string | null> {
  try {
    const destName = `${messageId.replace(/[^a-zA-Z0-9]/g, '_')}-${index}-${sanitiseName(att.filename)}`
    return await fetchMediaToFile(roomId, att.mxc, destName)
  } catch (err) {
    process.stderr.write(`switch-channel: attachment download error: ${err}\n`)
    return null
  }
}

async function setTyping(roomId: string, isTyping: boolean) {
  try {
    const url = `${API_ENDPOINT}/agents/${AGENT_ID}/typing`
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ room_id: roomId, is_typing: isTyping }),
    })
    if (!resp.ok) {
      process.stderr.write(
        `switch-channel: set typing failed: HTTP ${resp.status}: ${await resp.text()}\n`,
      )
    }
  } catch (err) {
    process.stderr.write(`switch-channel: set typing error: ${err}\n`)
  }
}

async function emitNotification(content: string, meta: Record<string, string>) {
  // Surface the unaddressed-message backlog on every notification. meta values
  // are strings; missed_count is always present (0 when caught up). When it's
  // non-zero, annotate the one-line body so the agent sees it without having
  // to inspect meta, and knows to widen read_context's `since` to catch up.
  const missed = missedSinceRead
  const enriched = { ...meta, missed_count: String(missed) }
  const body =
    missed > 0
      ? `${content}\n⚠️ ${missed} unread room message${missed === 1 ? '' : 's'} since your last read_context — call read_context (widen \`since\`) to catch up on what you missed.`
      : content
  await mcp.notification({
    method: 'notifications/claude/channel',
    params: { content: body, meta: enriched },
  }).catch(err => {
    process.stderr.write(`switch-channel: failed to deliver event to Claude: ${err}\n`)
  })
}

// -- Connect and start -------------------------------------------------------

const transport = new StdioServerTransport()

transport.onclose = () => {
  stopPolling()
  stopConnectionRenew()
  stopLeaseRenew()
  unpublishPort()
  process.exit(0)
}

// Wipe any stale port file left by a crashed previous bun for the same ppid.
// Safe: the previous process for this ppid is gone (we are it now); a live
// sibling would be a different ppid.
unpublishPort()

await mcp.connect(transport)

startHookListener()

process.stderr.write(`switch-channel: running (agent_id=${AGENT_ID})\n`)
