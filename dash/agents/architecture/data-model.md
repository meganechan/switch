# Data Model (switchdash vs. its upstream origin)

switchdash inherited its data model from the upstream project it was forked from
(attribution in `NOTICE`), which is optimised for **parallel coding workflows**: a
project (repo) holds several sessions (originally one per git worktree), each session
holds conversations with a coding agent and one or more terminals, all running in an
abstracted *workspace* (worktree / SSH / remote).

switchdash is being reworked to manage **local Switch agent sessions** instead:
multiple agents living in a directory, each tied to one provider, each with its
own runs. This page is the system of record for how the switchdash model
diverges from that upstream model and how the abstractions map across.

The schema is defined in `apps/switchdash-desktop/src/main/db/schema.ts`.

## Abstraction map

| switchdash | upstream equivalent | What it is |
|---|---|---|
| **project** | `project` | A directory on disk (repo root). Unchanged in spirit. |
| **agent** | *(none)* — new | A Switch agent identity bound to one provider. **Many agents per directory.** Carries the optional Switch identity (`switchAgentId`, `apiEndpoint`) detected from `.claude/settings.local.json`. |
| **provider** | `agent` | The CLI agent kind (claude, codex, gemini, …). Upstream called this an "agent"; here it's a *provider*, referenced by an agent via `providerId`. It stays a static code registry, not a table. |
| **session** | `conversation` | One instantiation/run of an agent. The unit shown under an agent in the sidebar. |
| *(folded into session)* | `terminal` | A session is 1:1 with its terminal, so the terminal's `shellId` lives on the session; there is no `terminals` table. |
| **message** | `message` | A message in a session (was keyed by `conversationId`, now `sessionId`). |
| *(removed)* | `session` (worktree-era) | The upstream parallel-run grouping. Removed — switchdash runs every session in the project root, so the grouping layer is gone. |
| *(removed)* | `workspace` | The upstream execution-location abstraction (worktree / SSH / BYOI remote). Removed — see below. |

## Resulting hierarchy

```
project   (directory on disk)
  └─ agent     (Switch identity; one provider each; many per dir)
       └─ session   (a run/instantiation; was "conversation")
            └─ message
```

## What we deliberately dropped from upstream, and why

- **The `workspaces` table and the workspace abstraction.** Upstream modelled
  *where* a session runs (git worktree, project-SSH, BYOI remote). switchdash had
  already gutted this before the rework — `workspace-config` reached v3 with the
  note *"switchdash has no git worktrees, branches, PRs, or BYOI: every session
  runs in the project root directory."* A workspace was therefore just "the
  project directory" plus lifecycle scripts. We dropped the table (and
  `project.repositoryWorkspaceId` / `session.workspaceId`) and keep lifecycle
  scripts / fs access as a service hung off the project directory.
- **The worktree-era `session` grouping.** With no worktrees, a session was a
  near-empty wrapper around a single conversation. We collapsed it: the upstream
  `conversation` becomes switchdash's `session`.
- **The `terminals` table.** A session is 1:1 with its terminal, so a separate
  table was pure indirection; the `shellId` moved onto the session.
- **`provider` as a per-session column.** A provider is a property of the agent
  (an agent is from one provider), so it moved up from the session onto the
  agent.

## Naming note (code)

The upstream "agent" concept (the provider registry and its tooling) is being renamed
from `agents/` to `providers/` across `src/main/core/` and `src/shared/core/`, so
that the name **agent** is free for the new Switch-agent concept. The Switch-agent
domain absorbs the former `switch-agents/detect.ts` directory detector.
