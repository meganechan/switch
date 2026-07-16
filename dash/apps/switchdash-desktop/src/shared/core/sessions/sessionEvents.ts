import type { Session } from '@shared/core/sessions/sessions';
import { defineEvent } from '@shared/lib/ipc/events';

export const sessionCreatedChannel = defineEvent<{ session: Session }>('session:created');

/**
 * A session was removed by the main process out-of-band — i.e. NOT by this
 * renderer initiating a delete (which updates its own store). Emitted when a
 * remote client terminates a shared session or the reconciler prunes a VM
 * session the sidecar stopped reporting, so every attached window drops the
 * row from its sidebar instead of showing a ghost until restart (CHOO-1181).
 */
export const sessionDeletedChannel = defineEvent<{
  sessionId: string;
  projectId: string;
}>('session:deleted');

export const sessionStatusUpdatedChannel = defineEvent<{
  sessionId: string;
  projectId: string;
  status: string;
}>('session:status-updated');

export type ProvisionStep =
  | 'resolving-worktree'
  | 'initialising-workspace'
  | 'running-provision-script'
  | 'connecting'
  | 'setting-up-workspace'
  | 'starting-sessions';

export const sessionProvisionProgressChannel = defineEvent<{
  sessionId: string;
  projectId: string;
  step: ProvisionStep;
  message: string;
}>('session:provision-progress');

export type LifecycleScriptType = 'setup' | 'run' | 'teardown';
export type LifecycleScriptOrigin = 'auto-setup' | 'auto-run' | 'manual' | 'workspace-destroy';

export type LifecycleScriptStatusEvent = {
  sessionId: string;
  projectId: string;
  workspaceId: string;
  type: LifecycleScriptType;
  origin: LifecycleScriptOrigin;
} & (
  | { status: 'running' }
  | { status: 'succeeded'; exitCode?: number }
  | {
      status: 'failed';
      message: string;
      surfaceFailure: boolean;
      exitCode?: number;
      signal?: string | number;
    }
  | { status: 'stopped'; message?: string }
);

export const lifecycleScriptStatusChannel = defineEvent<LifecycleScriptStatusEvent>(
  'session:lifecycle-script-status'
);

export const sessionProvisionedChannel = defineEvent<{
  sessionId: string;
  projectId: string;
  path: string;
  workspaceId: string;
  sshConnectionId?: string;
}>('session:provisioned');
