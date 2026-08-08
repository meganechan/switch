# Versioning and cross-artifact compatibility

Status: **design, pending approval** · Ticket: [CHOO-1865](https://sandboxquantum.atlassian.net/browse/CHOO-1865)

Switch ships many independently-versioned artifacts. This document defines how
they declare compatibility with one another, and how they are updated safely
while sessions are running.

**Scope.** This document owns *which versions work together, and how transitions
between versions are handled safely*. How each artifact is packaged and
distributed is [CHOO-1864](https://sandboxquantum.atlassian.net/browse/CHOO-1864)
and deliberately not covered here.

---

## 1. The problem

Six shippable artifacts, three disjoint release tags, and no declared
interdependency between any of them:

| Artifact | Version today | Released by |
| --- | --- | --- |
| switch-core (+ `gateway`, `setup` images, Helm chart, standalone compose) | `0.12.3` | tag `switch-v*` |
| switchdash desktop | `0.19.2` | tag `switchdash-v*` |
| `@sandbox-quantum/switch-agent-runtime` | `0.1.5` | tag `switch-agent-runtime-v*` |
| Claude Code connector plugin | `0.7.8` | none — served from the default branch |
| Codex connector plugin | `0.2.0` | none — served from the default branch |
| Remote sidecar | `1.7` | ships inside switchdash |

Nothing states which combinations are valid. Neither a user nor the software
itself can answer *"does this switchdash work against that switch-core?"* except
by trying it.

Four tickets are four edges of this one graph, each solved separately:
[CHOO-1321](https://sandboxquantum.atlassian.net/browse/CHOO-1321) (core ↔
switchdash), [CHOO-601](https://sandboxquantum.atlassian.net/browse/CHOO-601)
(plugin version reporting),
[CHOO-1736](https://sandboxquantum.atlassian.net/browse/CHOO-1736) (managed stack
not following the app's pin), and
[CHOO-1677](https://sandboxquantum.atlassian.net/browse/CHOO-1677) (switchdash
bundling a stale core). Solving them pairwise gives N² special cases and no
shared vocabulary.

### 1.1 What already exists

Two mechanisms in the tree already do this correctly for one edge each, and the
model below generalises them rather than replacing them:

- **`PROTOCOL_VERSION = 1`** (`core/switch_core/bridges/agent/protocol/connections.py`)
  — an integer checked when an agent opens the event stream.
- **The sidecar's major** (`dash/apps/switchdash-desktop/src/sidecar/sidecar-version.ts`)
  — `SIDECAR_VERSION` plus an explicit `MIN_SUPPORTED_SIDECAR_MAJOR` floor, with
  compatibility judged on the major alone. This is the most developed
  compatibility model in the repo and the direct ancestor of §3.

### 1.2 What is missing

**switch-core cannot state its own version.** `0.12.3` lives in
`core/pyproject.toml`, never enters the Python process, and is not stamped into
the image. The only introspection endpoint is `GET /health`
(`core/switch_core/main.py`), which returns `{"status": "ok"}`.

Consequently the only working version check in the repo
(`dash/apps/switchdash-desktop/src/main/core/managed-switch-server/deployed-version.ts`)
reverse-engineers the deployed version from the running container's image tag.
That works only for stacks switchdash itself manages. For a switch-core someone
else operates, switchdash has no visibility at all.

**No client version reaches the server.** There is no version header, no field
on agent registration, and no version column on any client-bearing table.

**Why the artifact version matters even though contracts decide compatibility.**
The compatibility gate (§3) reads contract versions only — an artifact version
never decides whether two components may talk. The artifact version is still
required for everything around that decision: reporting that a newer release
exists (§4), folding a release path to work out what a move costs (§5.1),
refusing a switch-core downgrade whose database has already migrated forward
(§8.1), naming the `untested` release combinations (§4.1), and answering "what
are you running?" in a bug report. Both travel on the same endpoint, so this is
one primitive rather than two.

### 1.3 "Unknown" currently renders as "fine" — in four places

The ticket's non-negotiable rule is that *incompatible*, *untested* and
*unknown* stay distinct, and that unknown never reads as fine. Today it does:

1. `protocol_version` on the events endpoint **defaults to the server's own
   value**, so a client that declares nothing is treated as compatible. No
   shipped client sends it, so the check has never fired in production.
2. `readVersionStatus()` returns `drift: null` — indistinguishable from "no
   drift" — when the deployed version cannot be read.
3. The standalone compose interpolates `${SWITCH_VERSION:-latest}`, so a missing
   env var silently floats the stack to `latest`.
4. `refuseDowngrade()` blocks only when the direction is *provably* a downgrade;
   an uncomparable pair passes through.

These are the same defect four times, and fixing that pattern is a larger share
of the value here than any new machinery.

---

## 2. Artifact versions

**Every artifact uses semantic versioning `MAJOR.MINOR.PATCH`, and an artifact
version describes only that artifact.** It says *where you are*. It carries no
compatibility meaning whatsoever.

| Field | Meaning |
| --- | --- |
| `MAJOR` | Breaking change to how the artifact is used, configured or installed |
| `MINOR` | New functionality |
| `PATCH` | Fixes |

A protocol break will usually ship alongside a major bump, but **nothing may
infer compatibility from an artifact version**. Versions inform people;
contracts (§3) inform machines.

Changes required:

- **Sidecar** moves from two components to three: `1.7` → `1.7.0`. Its major
  **stays at 1** — see §11.1.
- **Gateway** (`gateway/package.json`) has no `version` field. It gets one, or
  is explicitly documented as part of the switch-core release rather than a
  separate artifact.
- **Helm chart** `Chart.yaml` says `0.2.1` and is silently overwritten at
  package time with the tag version. The file stops lying.

**Every artifact gets a changelog.** Today only switch-core and switchdash have
one. Each release produces two outputs from one event: a **changelog entry** for
humans and a **release manifest** (§5) for machines, generated together so they
cannot drift.

---

## 3. Compatibility lives on contracts, not artifacts

A **contract** is a named interface where two artifacts talk. Each contract
carries a single integer, incremented only when that interface changes in a way
the other side can observe.

Each participant declares two numbers per contract:

- **`speaks`** — the newest version it implements
- **`accepts`** — the oldest version it still handles

Two participants are compatible when their ranges overlap: each side's `speaks`
is at or above the other side's `accepts`. They then operate at the lower of the
two `speaks`.

### 3.1 The contracts

| Contract | Between | Today |
| --- | --- | --- |
| `agent-protocol` | switch-core ↔ agent runtime (and the sidecar, which embeds it) | exists as `PROTOCOL_VERSION = 1` |
| `gateway-api` | switch-core ↔ switchdash, gateway frontend | new |
| `stack-compose` | standalone compose ↔ switchdash's managed-stack pipeline | new |
| `sidecar-control` | remote sidecar ↔ switchdash | exists as the sidecar major |
| `db-schema` | switch-core ↔ Postgres | Alembic revision; one-way |

Five edges, not N² pairs. Adding an artifact means declaring which contracts it
participates in; it does not mean touching the others.

### 3.2 The connector plugins are on no contract

A plugin's payload is a skill, a hook and an MCP config. It declares which
runtime version to launch, and the runtime fetches its tool definitions from the
server at startup (`GET /agents/{id}/ops`), so a plugin's tool surface cannot go
stale.

**A plugin's compatibility is the runtime's, inherited.** This is why there is no
plugin contract. It also settles CHOO-601: the server should *know and report*
which plugin version an agent runs, and must never *gate* a connection on it —
the contract underneath decides that.

> **Gate on contracts. Report on releases.**

### 3.3 Where contract numbers live

Contract versions are **baked in at build**, because they describe what the code
does — a component cannot look this up, it *is* this.

One authored file at the repo root is the only thing a human edits. From it,
CI generates a Python module and a TypeScript module so the two languages cannot
disagree, and fails if the generated files do not match their source.

This is deliberate: `COMPATIBLE_SWITCH_VERSION` is currently hand-copied into
`app-identity.canary.ts` with a "keep in sync" comment and nothing enforcing it.

### 3.4 How the numbers are exchanged

**Both sides always publish two numbers per contract** — `speaks` and `accepts`.
A single number is never sufficient: it cannot express a compatibility window,
and the window is the whole mechanism.

*What* is exchanged is identical on every edge. *How* differs, because the
transports differ — one edge is HTTP, one is a local file, one is a data file
with no running peer at all. Each edge reuses a channel that already exists:

| Contract | Server side publishes via | Client side declares via |
| --- | --- | --- |
| `agent-protocol` | `GET /version`, and the `connection_state` frame already sent when the stream opens | query params on `GET /agents/{id}/events` — the endpoint already takes `?protocol=` |
| `gateway-api` | `GET /version` | nothing to send; switchdash compares the server's range against its own compiled-in one |
| `sidecar-control` | the sidecar's ready file (`sidecar.ready`), which already carries its version, hash, pid and port | switchdash's own range is compiled in; it reads the sidecar's from that file |
| `stack-compose` | a version field in the compose file itself, and an annotation on the published OCI artifact | switchdash reads it from the bundled copy and from the on-host file |
| `db-schema` | reported in `GET /version` | switch-core compares the revision in the database against the revisions its own build knows |

Two consequences worth stating:

- **`sidecar-control` needs no endpoint.** switchdash and the sidecar communicate
  over a file on the host, so the range goes in the file the sidecar already
  writes. Adding an HTTP handshake there would be inventing a transport we do
  not need.
- **`stack-compose` has no running peer.** The compose file is data, so its
  version is carried *in the artifact*, and there is only one direction to check.

**The default on `?protocol=` must be removed.** It currently defaults to the
server's own value, so a client that declares nothing is treated as compatible.
An absent declaration is *unknown*, not *current*.

`GET /version` is the one genuinely new primitive. It returns switch-core's
artifact version, its `speaks`/`accepts` for every contract it participates in,
and its schema revision — unauthenticated, alongside `/health` in the auth
allowlist:

```json
{
  "version": "0.12.3",
  "contracts": {
    "agent-protocol": { "speaks": 1, "accepts": 1 },
    "gateway-api":    { "speaks": 1, "accepts": 1 },
    "db-schema":      { "speaks": 1, "accepts": 1 }
  },
  "schema_revision": "b3f36489c258"
}
```

---

## 4. Two questions, not one

Every artifact answers two independent questions:

- **Compatible?** — the contract check. A hard gate. Changes rarely.
- **Current?** — is this the build it should be on. Soft. Changes constantly.

Compatibility is not currency. A plugin from three months ago may be perfectly
compatible and still worse: stale skill text, an unfixed hook bug. The contract
model cannot see that, and should not.

The plugin and the sidecar live almost entirely in the second question —
`sidecar-control` will sit at 1 for a long time, so for the sidecar the currency
question does nearly all the work. That is already why its code compares content
hashes first and uses the version only as a tie-break.

**For artifacts we own and that hold no user data, the default is to keep them
current, with the contract check as the brake rather than the engine.**

### 4.1 Compatibility states

| State | Meaning | Behaviour |
| --- | --- | --- |
| `compatible` | Ranges overlap | Silent |
| `outdated` | Compatible; a newer build exists | Informational |
| `deprecated` | Compatible today; the peer has announced it is dropping this version | Warned, while it still works |
| `unknown` | The peer declared nothing, or it could not be read | Shown as unknown — **never as fine** |
| `incompatible` | Ranges disjoint | Blocked at the boundary |

`untested` — ranges overlap but this exact release combination was never
exercised — is a **release-layer advisory generated by CI from what we actually
ran**. It never blocks. Keeping it on a separate layer from `incompatible` is
what stops the tested-combination set from becoming a hand-maintained matrix
that rots.

### 4.2 Never report a mismatch without the remedy

Because both sides declare a range, we know not only that they disagree but
**who must move and to what**. The output is never "incompatible"; it is
"requires switch-core 0.14 or newer, this one is 0.12".

Direction is not symmetric:

- **Client too old** — common. The client updates; for the runtime and sidecar
  we simply replace them.
- **Server too old** — nothing the client does fixes it. For a managed stack,
  offer to update it; for a server we do not manage, report clearly.
- **Either side could move** — prefer moving the **client**. It is cheap and
  reversible. Moving the server means a schema migration, which is not.

---

## 5. Release manifests

Each release publishes a small manifest alongside its changelog entry:

```yaml
version: 0.7.9
contracts:
  agent-protocol: { speaks: 1, accepts: 1 }
disturbance: next-session
atomic: true
reversible: true
```

| Field | Meaning | Source |
| --- | --- | --- |
| `contracts` | This release's `speaks`/`accepts` per contract | Generated by CI from the contract file |
| `disturbance` | What applying it costs — §6 | Declared; often derivable |
| `atomic` | Can a failed apply leave things worse than before? | A property of the installer, constant per artifact |
| `reversible` | Can it be rolled back? | Constant per artifact (switch-core: no) |

Only `disturbance` is a genuine per-release judgement, and even that is often
derivable: an empty contract delta on an artifact read at session start is
`next-session` by construction.

### 5.1 Manifests describe the *move*, not the version

`0.7.8 → 0.8.0` and `0.7.9 → 0.8.0` are different journeys and can have
different answers. Each release declares only what changed **since the release
before it**; a jump **folds** every release in between:

- `disturbance` → the worst on the path
- `reversible` → false if any step on the path was irreversible
- `contracts` → compare the endpoints; the ranges handle it
- `atomic` → unaffected by path length; one install is performed

N releases therefore require N declarations, not N² pairs. **Manifests for all
releases are retained**, not only the newest — a path cannot be folded if it
cannot be seen. A client jumping forward across three breaking releases is told
so, rather than being judged only against the latest.

---

## 6. Disturbance: what is lost, not what restarts

| Level | Meaning | Example |
| --- | --- | --- |
| `none` | Nothing running is affected | A plugin release that only edits its README |
| `next-session` | New sessions get it; running ones keep what they have | A skill-text edit; a new runtime pin |
| `restart-resumable` | The component restarts and everything reattaches | Sidecar upgrade; switch-core patch |
| `restart-visible` | Work resumes, but the user sees an interruption | switchdash app update |
| `restart-lossy` | Work is actually lost | Stack reset; a protocol bump that strands running sessions |

The boundary between `restart-resumable` and `restart-visible` is *does anyone
notice*. The boundary between `restart-visible` and `restart-lossy` is *is
anything lost*. Only the last is worth interrupting someone over.

**`restart-resumable` is not conditional on idleness.** A sidecar upgrade
reattaches by design: sessions live in tmux on the host, sidecar state is
persisted across restarts, and sessions are launched with the *path* to the
endpoint file rather than a port, precisely so a restarted sidecar with a fresh
port stays reachable from panes spawned against the previous process. The event
stream resumes from its cursor, and if it fell outside the buffer it emits a gap
frame rather than pretending to be caught up — so the worst case is *detected*,
not silent.

### 6.1 What happens to sessions on a `next-session` update

Nothing. No prompt, no injection, no restart — if running sessions had to be
restarted it would not be `next-session`.

What we do is **show** it: the directory is on plugin `0.7.9`, two sessions are
running `0.7.8`, displayed as *"2 sessions on the previous version — they pick
it up when they next start"*. They converge as sessions end.

This is the **installed vs running** distinction (§7) at its smallest scale. A
user-initiated "restart this session" affordance is reasonable — resuming a
Claude Code session preserves the conversation — but it is never automatic. The
one case worth actively nudging is when the running version is `deprecated`
rather than merely outdated.

---

## 7. Scope: everything is shared at a different granularity

Per location, the chain is linear:

```
sidecar → agent CLI (Claude Code / Codex) → plugin → runtime → switch-core
```

Each link talks only to the next, so N hosts is N copies of one small pattern
rather than a graph. But each link is **shared at a different granularity**, and
that — not the component count — is the real source of complexity:

| Link | Scope |
| --- | --- |
| switch-core | global |
| plugin + runtime | per host + user |
| sidecar bundle (the version) | per directory |
| sidecar process (what runs) | per agent |

The sidecar bundle is one file per repo directory, while every agent in that
directory runs its own process with its own state. So agents in one directory
share a version involuntarily; agents in different directories drift freely.

**Verdicts are computed per agent and rolled up** through directory and host,
worst state winning. That yields blast radius for free — *"this affects 3 agents
in this directory"* — because scope is modelled rather than derived by hand.

**Track what is installed separately from what is running.** They diverge for
exactly as long as an old process outlives an update, which is §8 in miniature.

### 7.1 Two views, two owners

- **switchdash** is the only component that sees every location → *"are my hosts
  consistent?"*
- **switch-core** is the only component that sees every connected client →
  *"who is talking to me, and on what?"*

Neither can answer the other's question, and neither needs to.

---

## 8. Updates while things are running

Immediately after any update the deployment is, by construction, running mixed
versions. The model must describe that state rather than assume it away.

### 8.1 In-flight sessions, per artifact

- **switch-core** — sessions keep running. This is what the `accepts` floor buys:
  a new core must reach back far enough to cover anything plausibly still alive.
  A session below the floor is refused at its **next reconnect**, with a message
  naming both versions. It is never killed mid-work, and never left running
  while silently dropping events.
- **switchdash** — restarts anyway; the interesting question is the stack it
  manages.
- **Plugin / runtime** — a running session keeps the runtime it started with; new
  sessions get the new one. Mixed by construction and correct.
- **Sidecar** — the existing verdict table (replace on incompatible major,
  reattach when the host has newer, upgrade otherwise) is retained and folded
  into this framework.
- **`db-schema`** — one-way. Forward at boot, no rollback.

### 8.2 The update verdict

The verdict is **computed from the folded manifest plus live state**, never
written by hand:

```
if a contract delta strands a currently-connected peer  → BLOCKED
else if not atomic, or not reversible                   → MANUAL
else if disturbance <= restart-resumable                → SILENT
else if restart-visible and nothing live                → SILENT
else if restart-visible and something live              → PROMPT
else                                                    → PROMPT
```

| Verdict | Surface |
| --- | --- |
| `SILENT` | Applied without asking, and recorded |
| `DEFER` | *"will apply when this host is idle"* — rare; only where waiting saves something |
| `PROMPT` | *"this will interrupt 3 sessions"*, with the real count |
| `BLOCKED` | *"needs switch-core 0.14 first"* — names what must move |
| `MANUAL` | Cannot be automated, and why |

Nobody labels a release "silent". Codex plugin updates come out `MANUAL` purely
because that installer has no update verb and does uninstall-then-reinstall — a
failure leaves the agent with **no connector at all**. Making that path atomic
turns it silent automatically, with no policy change.

### 8.3 Safety is computed; autonomy is chosen

`SILENT` is a **ceiling, not an instruction**. Whether we act on it is a separate
per-artifact policy decision. An artifact may be more conservative than its
verdict allows; never less.

> Manage silently the things the user does not know exist. Ask about the things
> they do.

| Artifact | Policy |
| --- | --- |
| Sidecar | Auto-apply. Its version should be invisible |
| Runtime | Auto-apply |
| Plugin | Auto-apply, **recorded** — skill text changes agent behaviour, so it should not need approval but must be findable afterwards |
| switchdash | **Never auto.** It is the supervisor — the component that applies everyone else's updates — and the UI the user is looking at. The verdict gates and annotates the offer instead |
| switch-core | **Never auto.** Data, and one-way migrations |

**Silent is not invisible.** Silent means no prompt, not no record.

This closes a live footgun: switchdash's updater currently applies a build whose
pinned core is *older* than the running stack, which then refuses to start and
tells the user to update switchdash. Under this rule that update is `BLOCKED`,
with a reason, before anything is clicked.

### 8.4 Safe update sequence

Update the depended-upon before the depender: **switch-core, then switchdash,
then the runtime and plugins**, with the sidecar riding switchdash. A server's
`accepts` floor is what covers old clients; an old server cannot know anything
about a new client.

Rollback is safe anywhere in that order **except across a schema migration**,
where the model must refuse rather than warn.

---

## 9. Surfacing

None of this is worth building if it only reaches the logs.

- **switch-core records what each client declared** — artifact version and
  contract versions, per connection. This is the substrate for everything else.
- **Gateway compatibility view** — every connected client, what it speaks, and
  its state; plus the deployment summary: *"3 sessions on `agent-protocol` 1,
  server speaks 2, floor 1."*
- **"What would raising this floor break?"** — answerable before doing it,
  instead of afterwards.
- **switchdash** extends its existing drift notice to servers it does not manage
  via `GET /version`, and stops rendering "could not read" as "no drift".
- **Update availability** is annotated with its verdict, so *"an update exists"*
  and *"this update will interrupt your work"* are visibly different.

---

## 10. Two defaults that carry most of the weight

1. **Unknown never renders as fine.** If a version cannot be read or was not
   declared, say so. (§1.3 lists four places that currently violate this.)
2. **Undeclared never means safe.** A release with no manifest, or a missing
   field, is treated as the most disruptive class and prompts. The failure to
   avoid is someone forgetting to declare and receiving silent auto-updates as a
   reward.

---

## 11. Risks

### 11.1 Renumbering the sidecar

The sidecar is the only artifact whose version *currently is* its compatibility
signal. Moving that into `sidecar-control` is correct, but switchdash installs
already in the field still judge on the major.

**The major must stay at 1** (`1.7` → `1.7.0`). An old client parses major 1
either way. Going to `2.0.0` would make every existing switchdash read the new
sidecar as incompatible — reproducing CHOO-1937, where two installs sharing a
host replace each other indefinitely.

### 11.2 A forgotten counter

The model is only as good as our discipline in incrementing a contract when we
change it. A missed bump means the system reports "compatible" for something
that is not.

Mitigation: CI flags a change to an interface-defining file with no
corresponding counter change. This is a prompt, not a proof, and it is the
honest cost of keeping artifacts independently releasable.

### 11.3 Deploy lock scope (to verify)

`sidecarDeployLockRelPath()` is keyed per **agent**, while the bundle it guards
is shared per **directory**. Two agents in one directory take different locks and
write the same file. Upload is temp-file-then-rename, so nothing tears — but two
switchdash installs with differing bundles could alternate overwriting each
other, which is the shape of CHOO-1937 one level down. Needs verification rather
than assumption.

---

## 12. Rejected alternatives

- **A central matrix of version tuples.** Rots on contact: cannot express "any
  0.12.x", needs an edit per release per artifact, and goes stale silently —
  the failure mode this work exists to end. Retained only as the non-blocking
  `untested` layer, CI-generated, never hand-written.
- **Semver ranges between artifact versions** (switchdash declares
  `switch-core >=0.12 <0.14`). What CHOO-1321 would have produced. Couples
  release cadence to compatibility and misstates reality in both directions: it
  forces a bump when no interface moved, and stays silent when a patch breaks
  the wire.
- **A single lockstep release train.** Genuinely simpler — one version,
  everything ships together, compatible means equal. Rejected because it ends
  how these artifacts are actually shipped (the plugin releases by merging to
  main; the runtime publishes from a branch so it can be tested without
  merging), and forces version bumps on artifacts that did not change.
- **Exact-match protocol equality** — today's behaviour. No overlap window at
  all, so every protocol change is a flag day. Not a trade-off; a defect.
- **The client asking the server "am I compatible?" as the only mechanism.**
  Fails exactly when the two cannot talk, and cannot gate an update before it is
  installed. Useful as a supplement, not as the base.

---

## 13. Deferred

**The deprecation-window policy** — how long a contract version must be accepted
before its code path is deleted — is layered on top of this model and does not
change its core. It is deferred to a follow-up.

One part is **not** deferrable and is included here: the `accepts` floor must
exist in the declaration and be recorded server-side from the outset. It is the
mechanism the policy will later act on, and without it the question *"who would
raising this floor break?"* cannot be asked at all.

Sketch, for later: a floor rises only after the dropped version was marked
deprecated for at least one minor cycle and nothing observable is still below
it, with a published calendar backstop for deployments we cannot observe; the
end is a hard refusal, not an override; and deprecation is announced to the
specific affected client while it still works.

---

## 14. Implementation plan

Four layers, in dependency order. Each is useful on its own.

**A — make versions legible.**
switch-core learns its own version; `GET /version`; the contract file plus
generated Python and TypeScript with a CI equality check; clients declare on
connect; the server records what they declared. Fix the four defects in §1.3.

**B — enforce ranges.**
Exact-match becomes range overlap; refusal messages name both sides and the
remedy; switchdash gains drift detection for servers it does not manage.

**C — make it visible.**
Gateway compatibility view; mixed-version summary; the "what would raising this
floor break" query.

**D — update safety.**
Release manifests and path folding; the verdict engine; per-artifact autonomy
policy; the switchdash updater gate; atomic Codex reinstall; CI-generated tested
combinations; the documented update sequence.

Splitting by layer is not the per-pair fragmentation CHOO-1865 forbids — it is
one model landing in reviewable pieces. Proposed split: **A + B** in one PR,
**C + D** in a second.
