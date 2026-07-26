import type { SidecarRunStatus } from '@main/core/agent-runtime/impl/remote-sidecar-launcher';
import type { SidecarVerdict } from '@shared/events/sidecarEvents';

/**
 * Turn a raw host status + this client's build into the client-vs-host verdict.
 *
 * Compatibility (can I talk to it) is checked before the build comparison (is an
 * upgrade available), mirroring the launcher's deploy policy — a build that
 * differs is not a problem, only a protocol that does not fit is.
 */
export function verdictFor(status: SidecarRunStatus, clientHash: string): SidecarVerdict {
  if (!status.running) return 'not-running';
  if (!status.compatible) return 'incompatible';
  if (status.hash === clientHash) return 'up-to-date';
  return status.liveSessions > 0 ? 'upgrade-pending' : 'upgrade-available';
}
