import { getManagedServer } from '@main/core/switch-servers/servers-store';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import type {
  DockerAvailability,
  LocalServerStatus,
  StartLocalServerResult,
} from '@shared/core/managed-switch-server/managed-switch-server';
import {
  localServerLogChannel,
  localServerStatusChannel,
} from '@shared/events/localSwitchServerEvents';
import { LOCAL_SERVER_NAME } from './constants';
import { LocalServerHost } from './host/local-host';
import { ManagedServerSupervisor } from './managed-server-supervisor';

/**
 * Supervises the managed local Switch stack — a thin wrapper over a single
 * {@link ManagedServerSupervisor} targeting the local host, routing its status
 * and log to the local event channels.
 *
 * Deliberately does NOT stop the containers on app quit — the local stack keeps
 * running so its rooms stay live while switchdash is closed, matching the remote
 * sidecar model. `dispose()` only aborts an in-flight health wait.
 */
class LocalServerService {
  private readonly supervisor = new ManagedServerSupervisor({
    ref: { kind: 'local' },
    createHost: () => new LocalServerHost(),
    emitStatus: (status) => events.emit(localServerStatusChannel, status),
    emitLog: (line) => events.emit(localServerLogChannel, { line }),
  });

  getStatus(): LocalServerStatus {
    return this.supervisor.getStatus();
  }

  detectDocker(): Promise<DockerAvailability> {
    return this.supervisor.detectDocker();
  }

  /** Reflect a local stack that survived the last quit as running. */
  async initialize(): Promise<void> {
    try {
      const managed = await getManagedServer();
      if (managed) await this.supervisor.reconcile(managed.id);
    } catch (error) {
      log.warn('local-switch-server: boot status reconcile failed', { error });
    }
  }

  start(): Promise<StartLocalServerResult> {
    return this.supervisor.start(LOCAL_SERVER_NAME);
  }

  stop(): Promise<void> {
    return this.supervisor.stop();
  }

  reset(): Promise<void> {
    return this.supervisor.reset();
  }

  dispose(): void {
    this.supervisor.dispose();
  }
}

export const localServerService = new LocalServerService();
