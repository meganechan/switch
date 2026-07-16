# Shared Modules

## Main Shared Areas

- Agent provider registry:
  - `src/shared/core/agents/agent-provider-registry.ts`
- IPC primitives:
  - `src/shared/ipc/rpc.ts` — typed RPC router, controller, and client
  - `src/shared/ipc/events.ts` — typed event emitter
- Typed event definitions:
  - `src/shared/events/` — `appEvents.ts`, `browserEvents.ts`, `resourceEvents.ts`, `updateEvents.ts`
  - additional domain events colocated under `src/shared/core/` — e.g.
    `core/agents/agentEvents.ts`, `core/conversations/conversationEvents.ts`,
    `core/fs/fsEvents.ts`, `core/projects/projectEvents.ts`, `core/sessions/sessionEvents.ts`
- Domain type modules (under `src/shared/core/`):
  - `agents/`, `conversations/`, `fs/`, `projects/`, `project-settings/`, `pty/`,
    `sessions/`, `terminals/`, `workspaces/`
- App settings types:
  - `src/shared/core/app-settings.ts`

## Path Aliases

All aliases are defined in a single `tsconfig.json` and mirrored in `electron.vite.config.ts`:

| Alias | Resolves to |
| --- | --- |
| `@/*` | `src/*` |
| `@renderer/*` | `src/renderer/*` |
| `@main/*` | `src/main/*` |
| `@shared/*` | `src/shared/*` |
| `@root/*` | `./*` |

Aliases are resolved at build time by electron-vite. No runtime monkey-patching is needed.

## Provider Registry Rules

When adding a provider:

1. update `src/shared/core/agents/agent-provider-registry.ts`
2. add any required env passthrough in `src/main/core/pty/pty-env.ts`
3. add or update hook/plugin installation in `src/main/core/agent-hooks/` if the provider
   supports explicit events
4. update renderer surfaces that assume provider metadata
5. add tests for non-standard spawn or detection behavior
