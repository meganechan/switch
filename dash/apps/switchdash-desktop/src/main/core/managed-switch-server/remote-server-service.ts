import { listManagedServers } from '@main/core/switch-servers/servers-store';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import type {
  DockerAvailability,
  StartLocalServerResult,
} from '@shared/core/managed-switch-server/managed-switch-server';
import {
  type RemoteServerStatus,
  remoteServerLogChannel,
  remoteServerStatusChannel,
} from '@shared/events/remoteSwitchServerEvents';
import { createRemoteServerHost } from './host/remote-host';
import { ManagedServerSupervisor } from './managed-server-supervisor';

/**
 * Supervises switchdash-managed Switch stacks on remote hosts — one
 * {@link ManagedServerSupervisor} per SSH alias, each routing its status/log to
 * the host-tagged remote event channels. A supervisor keeps its host (and its
 * persistent port-forward) alive after start and disposes it on stop/reset/quit;
 * the containers run detached, so a remote stack stays up while switchdash is
 * closed — only the desktop-side forward goes away.
 */
class RemoteServerService {
  private readonly supervisors = new Map<string, ManagedServerSupervisor>();

  private supervisorFor(sshHost: string): ManagedServerSupervisor {
    let supervisor = this.supervisors.get(sshHost);
    if (!supervisor) {
      supervisor = new ManagedServerSupervisor({
        ref: { kind: 'remote', sshHost },
        createHost: () => createRemoteServerHost(sshHost),
        emitStatus: (status) => events.emit(remoteServerStatusChannel, { ...status, sshHost }),
        emitLog: (line) => events.emit(remoteServerLogChannel, { sshHost, line }),
      });
      this.supervisors.set(sshHost, supervisor);
    }
    return supervisor;
  }

  getStatuses(): RemoteServerStatus[] {
    return [...this.supervisors.entries()].map(([sshHost, s]) => ({
      ...s.getStatus(),
      sshHost,
    }));
  }

  detectDocker(sshHost: string): Promise<DockerAvailability> {
    return this.supervisorFor(sshHost).detectDocker();
  }

  start(sshHost: string, serverName: string): Promise<StartLocalServerResult> {
    return this.supervisorFor(sshHost).start(serverName);
  }

  stop(sshHost: string): Promise<void> {
    return this.supervisorFor(sshHost).stop();
  }

  reset(sshHost: string): Promise<void> {
    return this.supervisorFor(sshHost).reset();
  }

  /** Re-establish forwards + status for remote stacks that survived the last
   * quit. Best-effort per host: an unreachable host is left `stopped` rather
   * than failing boot. Creates a supervisor per known remote server so
   * `getStatuses()` lists them all. */
  async initialize(): Promise<void> {
    const remotes = (await listManagedServers()).filter(
      (s) => s.managementKind === 'remote' && s.sshHost
    );
    for (const server of remotes) {
      const supervisor = this.supervisorFor(server.sshHost!);
      try {
        await supervisor.reconcile(server.id);
      } catch (error) {
        log.warn(`remote-switch-server: boot reconcile failed for ${server.sshHost}`, { error });
      }
    }
  }

  /** Abort in-flight health waits and drop all forwards (app quit). The remote
   * containers keep running; only the desktop-side tunnels close. */
  dispose(): void {
    for (const supervisor of this.supervisors.values()) supervisor.dispose();
  }
}

export const remoteServerService = new RemoteServerService();
