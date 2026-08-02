# Agent Bridge Protocol

Status: **design, under review** (CHOO-1857)

This document specifies the protocol between an agent and Switch: how an agent
connects, what it receives, what it sends, and what happens when things break.
It replaces the long-poll delivery described in `ARCHITECTURE.md` §4.3.

---

## 1. Why this changes

Four problems in the current model, all structural rather than incidental.

**Two sources of truth for "which session is in which room."** `connect_to_room`
is an MCP tool that writes a row keyed on the MCP transport session id, while
events are fetched over an unrelated HTTP request that never mentions it. The
thing that joined the room and the thing receiving that room's events are two
independent connections sharing only an agent id. Neither notices when the
other dies. Clients then keep their own copies — switchdash persists a
session→room map to SQLite, the remote reconciler mirrors it, the sidecar keeps
a third — so the same fact is stored four times and reconciled nowhere.

**Events are held in memory and destroyed on read.** The event queue is a
per-agent, per-room `asyncio.Queue`. A poll *removes* what it returns, so only
one consumer can exist (hence `SWITCH_CHANNEL_DISABLE_POLL`, which switchdash
sets to stop the connector stealing its events). Nothing survives a restart,
and there is no way to ask "what did I miss?" because no record is kept.

**Liveness is guessed from timestamps by every reader independently.** Three
heartbeat endpoints with three cadences and three TTLs exist because there are
three connection models. Each caller compares `last_seen_at` against a TTL at
read time; nobody owns the answer. There is no session-close signal at all, so
bindings linger until they expire.

**Connection models leak agent implementation details into the server.**
`always_on` / `session_addressable` / `session_passive` / `auto_session` is
branched on in 22 places, but almost all of those reduce to "is there a live
connection, and what does it cover" — facts the server could observe rather
than be told.

### Non-goals

- Horizontal scaling. `switch-core` is single-process by construction (the Helm
  chart refuses `replicaCount != 1` because Matrix sync sessions live in
  memory). This design assumes one process and notes the seams where that
  assumption is load-bearing.
- Replacing MCP. MCP remains the agent's tool surface.
- AG-UI (CHOO-1685). This design should not make it harder to land; it does not
  attempt it.

---

## 2. Model

### 2.1 The connection

A **connection** is the unit of everything. It is created by opening the event
stream and it owns:

- **scope** — which rooms it covers
- **filter** — which events within those rooms
- **cursor** — how far the client has consumed
- **liveness** — its heartbeat
- **room slots** — its exclusive right to act as the agent in a room
- **role lease** — the room role it holds, if any

A connection belongs to exactly one agent. An agent may have several.

The connection is held **in memory only**. It cannot outlive the server
process (its socket and buffer cannot), so persisting it would recreate the
staleness bug. Every question of the form "is this agent reachable in room R?"
is answered from the live connection set, not from a table.

### 2.2 Scope

Declared when the stream opens, mutable while it is open.

| scope | meaning | typical client |
|---|---|---|
| `single` | at most one room at a time; subscribing to a new room drops the previous | a terminal coding session |
| `all` | every room the agent belongs to, including rooms joined later | a supervising daemon, an always-on agent |

`single` is `all` with a limit of one. The limit is enforced server-side, so
"one room at a time" is a guarantee rather than a convention in a skill.

Scope is always a subset of the rooms the agent is already a member of.
Subscribing is not joining; membership is checked per subscribe.

### 2.3 Filter

Also declared at open. Orthogonal to scope: scope selects *rooms*, filter
selects *events within them*.

| filter | delivers |
|---|---|
| `all` | every event in subscribed rooms, each carrying `addressed` |
| `addressed` | only addressed messages, task events, and opted-in room joins |

A session uses `single` + `all` — it needs unaddressed traffic for context and
for missed-message counts. A daemon uses `all` + `addressed` — it is watching
for a reason to start a session, not following conversations. This replaces
the separate `/notifications` endpoint and collapses the two notification
builders (CHOO-1810) into one.

### 2.4 Room slots

**At most one connection per (agent, room) may act as that agent in that room.**

- A `single`-scope connection **claims** the slot for its room.
- An `all`-scope connection covers every room **not** claimed by another
  connection of the same agent.
- When a `single` connection claims room R, the `all` connection **goes fully
  dark on R** — it receives nothing for R until the claim is released.
- When the claiming connection dies, coverage returns to the `all` connection
  automatically.

Exactly one recipient per room at all times: no duplicate delivery, no
coordination needed for handoff in either direction.

This rule already exists — implemented client-side in
`auto-session-watcher.ts`, which skips a room when switchdash's own map says a
session covers it. Moving it into the protocol is the split-brain fix.

**Collision.** If a `single` connection tries to claim a room already claimed
by a live connection of the same agent, the claim is **rejected** with an error
naming the incumbent. The common cause is an accident (a stale process, a
double launch) and rejecting surfaces it. An explicit takeover flag forces the
claim, evicting the incumbent, which is told why.

### 2.5 Sessions are not a server concept

Switch models connections, not sessions. Whether a client runs one PTY or ten
behind a connection is its own business.

A daemon that spawns sessions does not relay events to them: each spawned
session opens **its own** `single`-scope connection. Consequences: correlation
stays structural (each session's stream and MCP live in one process), failure
is isolated (the daemon dying does not disconnect running sessions), and a bare
terminal session with no daemon works identically.

A client may later multiplex sessions behind one connection. Switch does not
need to change for that.

---

## 3. Transport

**SSE for server→agent, ordinary HTTP for agent→server.**

The two directions have different shapes. Downward is a stream: events happen
whenever, the agent listens. Upward is request/response: each action wants a
result. SSE plus HTTP uses each for what it already does, rather than
rebuilding request semantics inside a WebSocket frame protocol.

Reasons, in order of weight:

1. **Resume is specified.** SSE tags events with ids and clients reconnect with
   `Last-Event-ID` automatically. Gap recovery after a laptop sleeps is the
   spec, not something we invent.
2. **It survives the network.** SSE is plain HTTP, so proxies, K8s ingress,
   corporate networks and SSH port-forwards pass it through. WebSocket's
   upgrade handshake is a class of "works on my machine" failure we would own.
3. **It is debuggable.** `curl -N .../events` shows the live stream.

Both are client-initiated, so agents work behind NAT with only outbound HTTPS.
**Switch can never wake a disconnected agent** — with no connection, events
queue. Anything resembling "Switch starts a session on demand" must be done by
something already connected and local.

**Accepted cost:** two channels can fail independently. §5.3 binds them.

---

## 4. The event buffer

### 4.1 Shape

Per agent, an ordered buffer of recent events, each with a monotonically
increasing **sequence number**. Events are appended when produced and removed
only when confirmed or aged out — **never on read**.

Delivery becomes a read, which makes it repeatable, resumable and verifiable.
It also permits more than one reader, which is what allows
`SWITCH_CHANNEL_DISABLE_POLL` to be deleted.

The buffer is **in memory** for the first implementation. Restart loses
undelivered events — accepted, and made loud (§5.5). It sits behind a narrow
interface (`append`, `read_from`, `confirm`, `prune`) so it can be moved to
Postgres later without anything above it changing.

> **Why not Kafka / Redis Streams / NATS?** Event volume is human chat scale —
> order of one event per second aggregate. A broker's central benefit is
> decoupling producers from consumers for independent scaling, which
> `switch-core` cannot use while it is pinned to one replica. Against that: a
> new stateful service in the Helm chart, in compose, in CI and in every dev
> setup, plus a "committed to the DB, failed to publish" failure mode we do not
> have today. If the buffer ever needs to leave the process, Postgres first
> (`LISTEN/NOTIFY` for the wakeup), Redis Streams second — its stream ids are
> the same cursor concept.

### 4.2 Bounding and gaps

The current queue is unbounded: an agent that never connects accumulates
forever in RAM. The buffer is **capped per agent**. On overflow the oldest
events are dropped and the agent is flagged as having a **gap**.

A gap is never silent. The next connection for that agent is told it missed
events and must re-read room context. The same applies when a client asks to
start from a sequence number older than the buffer retains: that is an
**error**, not a fast-forward to head.

### 4.3 Confirmation

Two mechanisms, both free:

- **On reconnect** — `Last-Event-ID` states what the client processed. This is
  what makes resume correct.
- **Piggybacked** — the heartbeat and every agent→server call carry the
  client's current sequence number, so the buffer trims during long-lived
  connections rather than growing to the cap.

The cursor is **monotonic per connection**. A client may not move it backwards
to force replay; history is `read_context`'s job, not the stream's.

### 4.4 Starting position

Chosen once, at open:

- **head** (default) — only events from now on. Correct for a session a human
  started; nobody is waiting on a specific event.
- **from a given sequence number** — used on reconnect, and by a spawner.

When a daemon spawns a session in response to an event, it passes that event's
sequence number to the session, which opens its connection just below it. The
session therefore receives exactly the message that woke it, and nothing else,
without relying on the agent thinking to go looking.

The trigger event is consequently delivered twice — once to the daemon that
used it to decide to spawn, once to the session that acts on it. This is
intended.

---

## 5. Connection lifecycle

### 5.1 Opening

```
GET /agents/{agent_id}/events
Authorization: Bearer <agent token>
Accept: text/event-stream

  connection_id   client-generated UUID
  scope           single | all
  filter          all | addressed
  start_from      head | <sequence number>       (default head)
  spawn_capable   bool                            (default false)
  protocol        protocol version
```

The client generates the connection id, which makes opening **idempotent**: a
timed-out request can be retried without creating a second connection. The id
identifies, it does not authorise — the agent token does that — so it need not
be treated as a secret. An id belonging to a different agent is rejected.

The server responds with an open `text/event-stream` and sends the connection's
state as the first event.

**Protocol version is checked at open.** An incompatible client is refused with
a message telling the user to update. The runtime lives on the user's machine
and Switch moves independently; silent degradation is not acceptable.

### 5.2 Heartbeat

```
POST /agents/{agent_id}/connection/beat
  connection_id
  cursor            last sequence number processed
```

Every **2 s**; TTL **6 s**. One heartbeat for every kind of connection. It
replaces all three of today's: `/connection/renew`, `/watch/heartbeat` and
`/leases/renew`.

It does two jobs: proves the client is alive *and* consuming (strictly stronger
than a server-side write succeeding), and confirms the cursor so the buffer can
trim.

The server also writes a keepalive comment down the stream periodically. That
is only to stop proxies timing out an idle connection — it is **not** the
liveness signal.

### 5.3 The two signals

A connection has two independent signals: whether a **stream is attached**, and
whether the **heartbeat is fresh**.

| stream | heartbeat | state |
|---|---|---|
| attached | fresh | **healthy** — events flow |
| detached | fresh | **alive, not receiving** — keeps slot and lease; events buffer; heartbeat is *rejected* with "no stream attached, reopen" |
| attached | stale | **dead** — half-open socket; drop stream, release slot and lease |
| detached | stale | **dead** |

**The connection dies when the heartbeat goes stale. Losing the stream does not
kill it; it only stops delivery.**

This is what makes a 6 s TTL safe. A brief network drop detaches the stream,
the connection survives, the client reattaches with the same connection id and
resumes from its cursor — keeping its room slot and role lease. Without the
grace window, a wifi hiccup would drop an agent's role.

Reconnecting with an id that is already live **takes over**: the previous
stream is dropped with an explicit reason. "Same client returning" and "same
client duplicated" are indistinguishable, and takeover is right for both.

### 5.4 Binding the two channels

Every agent→server call carries the `connection_id`. The server checks it
against the live connection set:

- live → accept
- unknown or dead → **reject** with "your stream is not connected; reconnect and
  resume from your cursor"

This is the coupling a single WebSocket would give for free, obtained with one
field. It means an agent whose stream died cannot keep acting as though
connected: it is told on its very next action.

Correlation is always **derived** by the server — from the credential or the
local socket — never accepted as a claim in a request body.

### 5.5 Restart

On restart there are zero connections; every client reconnects. This is the
truth, and the server must not pretend otherwise.

The server marks a fresh start. A client resuming with a cursor from a previous
process is told its cursor is meaningless and it must re-read context. Never a
quiet resume that looks healthy.

### 5.6 Closing

- Stream closes → detach, grace window per §5.3.
- Heartbeat lapses → connection dies: slots released, role lease released,
  buffer for that connection discarded.

---

## 6. Events (server → agent)

Wire format is SSE. Each event carries `id` (the sequence number), `event`
(the type) and `data` (JSON).

```
id: 4813
event: message
data: {"type":"message","room_id":"…","bridge_id":"…","channel_type":"channel_public",
       "payload":{…}}
```

### 6.1 Envelope

| field | type | notes |
|---|---|---|
| `type` | string | one of the types below |
| `room_id` | string | Switch room id |
| `room_name` | string | *new* — `all`-scope clients receive events for rooms they never explicitly connected to |
| `bridge_id` | string \| null | collaboration bridge, if any |
| `channel_type` | string \| null | `channel_public`, `channel_private`, `direct` |
| `payload` | object | per type |

### 6.2 `message`

```json
{ "addressed": true, "sender": "@switch-slack-alice:switch.local",
  "sender_name": "alice", "message_id": "$abc…", "body": "…",
  "timestamp": 1785569372682, "thread_id": "$root…",
  "attachments": [ { "filename": "diagram.png", "mimetype": "image/png",
                     "size": 20481, "mxc": "mxc://…", "msgtype": "m.image" } ] }
```

`addressed` is computed server-side: true for a `direct` channel, an `@name` or
`@alias` mention, or an `@role` mention whose role this agent holds. The
addressing policy is applied at this point — a mention from a sender not
permitted to address this agent is demoted to unaddressed.

Attachments carry a pointer, never bytes; fetch via the media endpoint.

### 6.3 `command`

```json
{ "command": "reset", "args": "", "user_id": "…", "user_name": "alice",
  "thread_id": "$root…" }
```

### 6.4 `room_join`

```json
{ "member": "@alice:switch.local", "member_name": "alice",
  "timestamp": 1785569372682, "listening": true }
```

`listening` reflects the per-room, per-agent opt-in. Under `filter: addressed`,
joins are delivered only when `listening` is true.

### 6.5 Task events

All five carry `task_id`, `requester_agent_id`, `performer_agent_id`, plus:

| type | extra |
|---|---|
| `task_delegate` | `summary`, `description` |
| `task_accept` | — |
| `task_update` | `update` |
| `task_finalise` | `outcome` |
| `task_cancel` | `reason` |

Task events are always notifiable and are delivered under both filters.

### 6.6 Control events

New, carried on the same stream:

| type | payload | meaning |
|---|---|---|
| `connection_state` | `connection_id`, `scope`, `filter`, `rooms`, `cursor`, `protocol` | first event on every stream |
| `subscription_changed` | `rooms`, `reason` | scope changed — including a room going dark because another connection claimed it |
| `gap` | `from_sequence`, `reason` | events were dropped; re-read context |
| `evicted` | `reason` | this connection lost its slot or was taken over; it must stop acting |

`gap` and `evicted` exist so that degradation is always visible. A client that
has missed events must never appear healthy.

---

## 7. Operations (agent → server)

Unchanged in shape from today; every call additionally carries `connection_id`
and the client's `cursor`. The MCP tool surface is unchanged from the agent's
point of view.

**Rooms** — `connect_to_room` (subscribe + return the room payload),
`read_context`, `list_participants`, `list_linked_rooms`, `list_references`,
`load_internal_documents`.

`connect_to_room` remains a single call that both subscribes and returns
instructions, participants, references, roles and linked rooms. Internally
subscription and payload are separate concerns, but they are not split in the
agent-facing API: an agent must not be able to subscribe to a room without
being told what the room is about.

**Messaging** — `post_message`, `send_targeted_message`, `send_attachment`,
`download_attachment`, typing indicator.

**Tasks** — `delegate_task`, `accept_task`, `update_task`, `finalise_task`,
`cancel_task`, `list_tasks`.

**Roles** — `list_roles`, `get_role_detail`, `assume_role`, `release_role`.

**Moderation** — room, group, reference, link and agent management.

**Mediation** — pre-tool-call, pre-llm-request, post-tool-result,
post-llm-response.

---

## 8. Connection profiles replace agent profiles

`connection_model` is removed. What the server needs is observable from
connections; what it does not need was never its business.

| today | becomes |
|---|---|
| `always_on` | a connection with `scope: all` |
| `session_addressable` | a connection with `scope: single` |
| `auto_session` | a connection with `scope: all`, `spawn_capable: true` |
| `session_passive` | *no connection* — the agent can act, but receives nothing |

### 8.1 Statuses

Three, derived:

| status | condition |
|---|---|
| `LIVE` | a connection covers this room |
| `DORMANT` | no connection covers this room, but the agent has a live `spawn_capable` connection |
| `DISCONNECTED` | no connection covers this room |

`NO_SESSION` and `AWAITING_MANUAL_POLL` are removed: both describe what an
agent was *declared* to be, not what is true. The explanatory nuance humans
see ("this agent is started manually" vs "this agent is offline") moves into
the auto-reply text, read from the agent's configuration at reply time.

`DORMANT` currently renders with a blank emoji in `!status` — fixed here.

### 8.2 Role leases

The lease moves onto the connection.

- Keyed on the connection, not globally on the agent.
- Kept alive by the connection heartbeat; `/leases/renew` is removed.
- Released when the connection dies — for a reason, not on a timer.
- One role per connection replaces one role per agent, so an agent with two
  sessions may hold different roles in different rooms.

Leases still survive room hops, because the connection does.

---

## 9. MCP

MCP remains the tool surface. Two ways to reach it, converging on **one
connection object** — the stream registers it, calls validate against it, the
heartbeat maintains it, its death releases everything.

**Only the stream can create a connection.** MCP calls attach to one; they
never conjure one "to be helpful", which would reintroduce two things that can
disagree.

### 9.1 Local MCP (recommended)

One process holds the stream and serves MCP over stdio. A tool call arrives
**inside the process that owns the connection**, so correlation is a variable
in memory — nothing to transmit, leak or get wrong. The connection id never
appears in a prompt or a config file, and the process can refuse a tool call
immediately when its own stream is down.

This is close to what already ships: the channel process is already a local
stdio MCP server that also holds the connection to Switch. The work is merging
the two MCP servers the plugin currently registers (`switch`, remote HTTP; and
`switch-channel`, local stdio) into one, and swapping poll for SSE.

**Distribution.** One versioned artifact referenced by both connector plugins,
not a copy per plugin. Two modes off the same code: *session* (child of the
agent, `scope: single`) and *daemon* (long-lived, `scope: all`,
`spawn_capable`).

- **Claude Code** — plugin `.mcp.json` at the plugin root, `${CLAUDE_PLUGIN_ROOT}`
  for the path, `${VAR}` expansion for endpoint and token.
- **Codex** — Codex expands neither, so switchdash registers the server on argv
  at launch. It controls the launch, so it can also inject per-session
  credentials.

### 9.2 Remote MCP (fallback)

Some hosts cannot run a local process — ChatGPT-style platforms require a
remote, publicly reachable HTTPS endpoint. They land on a reduced tier:

**Remote MCP with the agent's static token** — can act; holds no connection, no
room slot, no liveness, receives no pushed events. This is what `session_passive`
becomes, and it falls out of the model rather than being special-cased.

Correlating a remote MCP client to a stream is possible by minting a token per
connection and injecting it at launch, but that is deferred: it serves only the
fallback tier and costs minting, expiry, rotation and injection.

---

## 10. Backward compatibility

Polling clients must keep working. Both paths read the **same buffer**, so they
cannot diverge while both exist.

The old poll endpoint sends no cursor, so **the server keeps one on its
behalf**: "everything after the last thing I gave you, and record that I gave
it." Behaviour is unchanged for the old client — it polls, gets new events,
never sees a duplicate — but events are no longer destroyed for anyone else.

Two consequences, stated rather than hidden:

- Old clients keep **at-most-once** delivery, as today: the server advances the
  cursor on send, so a lost response loses those events. New clients get
  **at-least-once**, because they confirm.
- An old client that restarts has no cursor and cannot ask what it missed. It
  resumes wherever the server's cursor sits. Left honestly broken; the fix is
  to migrate the client.

`SWITCH_CHANNEL_DISABLE_POLL` can be deleted as soon as reads are
non-destructive — before SSE exists.

Polling endpoints are removed in a later, separate release.

---

## 11. Failure handling

Fail loud, never fake. Concretely:

| situation | behaviour |
|---|---|
| resume from a cursor older than the buffer | error: missed events, re-read context |
| buffer overflow | drop oldest, flag gap, `gap` event on next connection |
| heartbeat with no stream attached | reject: reopen the stream |
| call with unknown/dead `connection_id` | reject: reconnect and resume |
| `connection_id` belonging to another agent | reject |
| room slot already claimed | reject, naming the incumbent |
| slot taken over | incumbent receives `evicted` and stops |
| server restart | cursors invalidated; clients told to re-read |
| incompatible protocol version | refuse at open with an upgrade message |
| per-agent connection cap exceeded | reject loudly |

A connection that has silently missed events must never appear healthy.

---

## 12. Delivery plan

**Stage A — server plus one client.**

1. Sequence numbers on events; keep-until-confirmed; bounded buffer with gap
   flag; old poll endpoints served from the buffer with a server-held cursor.
   No client changes. Deletes `DISABLE_POLL`.
2. Connection object, SSE endpoint, heartbeat, scope, filter, slots, the state
   machine of §5.3. Polling still works. Testable with `curl`.
3. Claude Code connector: merge the two MCP servers into one local runtime;
   `connect_to_room` binds the connection.

**Stage B — the rest.**

4. Remove `connection_model`; derive statuses; move role leases onto the
   connection; delete the three renew endpoints.
5. switchdash (`RoomConnection` → session-grained connection that repoints
   rooms; daemon mode) and the sidecar, which reuses the same class.
6. Remove the polling endpoints.

Opportunistic, both relevant to this work: the `DORMANT` display bug, and
`read_context`'s deep-history pagination, which discards Matrix's continuation
token and so cannot page past roughly `limit * 5` events — this matters more
once "re-read context" is the documented recovery path for a gap.

Both connector skills (`claude-code-plugin`, `codex-plugin`) and both plugin
versions must be updated when the agent-facing contract changes.

---

## 13. Related work

- **CHOO-490** — HTTP protocol parity. Overlaps directly; this document is the
  contract both should serve.
- **CHOO-1810** — two notification builders. Closed by §2.3: one delivery path
  with a declared filter.
- **CHOO-1685** — AG-UI. Not addressed; the event envelope is versioned and
  additive so it stays landable.
- **CHOO-1101 / CHOO-1366 / CHOO-1811** — bugs caused by the polling model.
  Useful as tests of whether this design makes them impossible rather than
  merely fixed.
