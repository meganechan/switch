import type { SwitchServer } from '@shared/core/switch-servers/switch-servers';
import { localServerService } from './local-server-service';
import { remoteServerService } from './remote-server-service';

/**
 * Whether a switchdash-managed server's stack is currently running — i.e. its
 * lifecycle phase is `running`. Routes to the right supervisor the same way
 * {@link managedServerSecretsKey} does: a remote-managed server reads its
 * per-host status; everything else (local, or a legacy managed row with a null
 * kind) reads the single local status. Both services reconcile the real stack
 * state at boot (`initialize()`), so the phase is authoritative.
 *
 * Only meaningful for managed servers; returns `false` for external
 * (non-managed) ones, so callers can gate a would-be network call on it without
 * separately checking `server.managed`.
 */
export function isManagedServerRunning(server: SwitchServer): boolean {
  if (!server.managed) return false;
  if (server.managementKind === 'remote') {
    return (
      server.sshHost !== null && remoteServerService.getStatus(server.sshHost).phase === 'running'
    );
  }
  return localServerService.getStatus().phase === 'running';
}
