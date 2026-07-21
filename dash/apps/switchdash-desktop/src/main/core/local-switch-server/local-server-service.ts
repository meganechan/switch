import { resolveAgentServers } from '@main/core/agents/resolve-servers';
import { passwordLogin } from '@main/core/switch-servers/auth';
import {
  ensureManagedServer,
  getManagedServer,
  setActiveServerId,
} from '@main/core/switch-servers/servers-store';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { COMPATIBLE_SWITCH_VERSION, RELEASE_REPO_OWNER } from '@shared/app-identity';
import type {
  DockerAvailability,
  LocalServerStatus,
  StartLocalServerResult,
} from '@shared/core/local-switch-server/local-switch-server';
import {
  localServerLogChannel,
  localServerStatusChannel,
} from '@shared/events/localSwitchServerEvents';
import { bundledComposeYaml } from './bundled-compose';
import { composeDown, composeUp, isStackRunning } from './compose';
import {
  COMPOSE_FILE_NAME,
  ENV_FILE_NAME,
  GHCR_REGISTRY,
  LOCAL_SERVER_ADMIN_EMAIL,
  LOCAL_SERVER_NAME,
} from './constants';
import { buildEnvFile } from './env-file';
import { apiUrlFor, gatewayUrlFor } from './free-port';
import { waitForHealth } from './health';
import { LocalServerHost } from './host/local-host';
import type { ServerHost } from './host/types';
import { clearPorts, resolvePorts } from './ports';
import { clearSecrets, loadOrCreateSecrets } from './secrets';

/**
 * Supervises the managed local Switch stack: Docker detection, config
 * generation, `docker compose` lifecycle, health-gated registration, and
 * stop/reset. One operation runs at a time (`busy`); every state transition is
 * pushed to the renderer over `localServerStatusChannel`.
 *
 * The pipeline is expressed against a {@link ServerHost} so the same steps drive
 * either the local Docker daemon or a remote host over SSH; this service wires
 * the local host. Deliberately does NOT stop the containers on app quit — the
 * local stack keeps running so its rooms stay live while switchdash is closed,
 * matching the remote sidecar model. `dispose()` only aborts an in-flight
 * health wait.
 */
class LocalServerService {
  private status: LocalServerStatus = {
    phase: 'stopped',
    serverId: null,
    version: COMPATIBLE_SWITCH_VERSION,
    message: null,
    error: null,
  };

  private busy = false;
  private startAbort: AbortController | null = null;

  getStatus(): LocalServerStatus {
    return this.status;
  }

  detectDocker(): Promise<DockerAvailability> {
    return new LocalServerHost().detectDocker();
  }

  private setStatus(patch: Partial<LocalServerStatus>): void {
    this.status = { ...this.status, ...patch };
    events.emit(localServerStatusChannel, this.status);
  }

  /** Reconcile status at boot so a stack that survived the last quit shows as
   * running without the user re-starting it. The managed server's URLs are the
   * per-machine ones persisted at first start, so we reflect the existing record
   * rather than recomputing — the containers are bound to those ports. */
  async initialize(): Promise<void> {
    try {
      const managed = await getManagedServer();
      if (managed && (await isStackRunning(new LocalServerHost()))) {
        this.setStatus({ phase: 'running', serverId: managed.id, message: null, error: null });
      }
    } catch (error) {
      log.warn('local-switch-server: boot status reconcile failed', { error });
    }
  }

  async start(): Promise<StartLocalServerResult> {
    if (this.busy) {
      return { kind: 'error', message: 'A local-server operation is already in progress.' };
    }
    this.busy = true;
    this.startAbort = new AbortController();
    const host: ServerHost = new LocalServerHost();
    try {
      this.setStatus({ phase: 'starting', error: null, message: 'Checking Docker…' });
      const docker = await host.detectDocker();
      if (!docker.available) {
        this.setStatus({ phase: 'error', error: docker.detail });
        return { kind: 'docker-unavailable', reason: docker.reason, detail: docker.detail };
      }

      this.setStatus({ message: 'Authenticating to image registry…' });
      await host.ensureGhcrLogin();

      this.setStatus({ message: 'Preparing configuration…' });
      await host.writeFile(COMPOSE_FILE_NAME, bundledComposeYaml());
      const secrets = await loadOrCreateSecrets(host);
      // Pick free host ports for this machine (persisted + reused) so the stack
      // never collides with a dev's existing services on 8000 / 5432 / 3000.
      const ports = await resolvePorts(host);
      const gatewayUrl = gatewayUrlFor(ports);
      const apiUrl = apiUrlFor(ports);
      await host.writeFile(
        ENV_FILE_NAME,
        buildEnvFile({
          version: COMPATIBLE_SWITCH_VERSION,
          registry: GHCR_REGISTRY,
          namespace: RELEASE_REPO_OWNER,
          ports,
          secrets,
        }),
        0o600
      );

      this.setStatus({ message: 'Starting containers (pulling images if needed)…' });
      await composeUp(host, (line) => events.emit(localServerLogChannel, { line }));

      // Make the published ports reachable from the desktop (no-op locally).
      await host.establishNetworking(ports);

      this.setStatus({ message: 'Waiting for the server to become healthy…' });
      // Probe via the gateway URL (nginx → switch-core), the same path switchdash's
      // management calls take, so we only register once that whole path answers.
      const healthy = await waitForHealth(gatewayUrl, {
        signal: this.startAbort.signal,
      });
      if (!healthy) {
        const error = 'The local server did not become healthy in time.';
        this.setStatus({ phase: 'error', error });
        return { kind: 'error', message: error };
      }

      const server = await ensureManagedServer(
        {
          name: LOCAL_SERVER_NAME,
          gatewayUrl,
          apiUrl,
        },
        { kind: 'local' }
      );
      await setActiveServerId(server.id);

      // switchdash generated the admin password, so sign in on the user's behalf
      // rather than showing a login wall for a secret they never saw. A failure
      // here does not fail the start — the stack is healthy; the server view just
      // falls back to its sign-in panel.
      this.setStatus({ message: 'Signing in…' });
      const login = await passwordLogin(
        server,
        LOCAL_SERVER_ADMIN_EMAIL,
        secrets.gatewayAdminPassword
      );
      if (!login.success) {
        log.warn('local-switch-server: auto sign-in failed; server will show a sign-in prompt', {
          error: login.error,
        });
      }

      await resolveAgentServers();

      this.setStatus({ phase: 'running', serverId: server.id, message: null, error: null });
      return { kind: 'started', serverId: server.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('local-switch-server: start failed', { error });
      this.setStatus({ phase: 'error', error: message });
      return { kind: 'error', message };
    } finally {
      host.dispose();
      this.busy = false;
      this.startAbort = null;
    }
  }

  async stop(): Promise<void> {
    if (this.busy) throw new Error('A local-server operation is already in progress.');
    this.busy = true;
    const host: ServerHost = new LocalServerHost();
    try {
      this.setStatus({ phase: 'stopping', message: 'Stopping containers…' });
      await composeDown(host, false);
      await host.teardownNetworking();
      this.setStatus({ phase: 'stopped', message: null, error: null });
    } catch (error) {
      this.setStatus({
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      host.dispose();
      this.busy = false;
    }
  }

  /** Destroy the stack AND its data volumes, and drop the stored secrets so the
   * next start is a clean install. Irreversible — the caller must confirm. The
   * caller (renderer) removes the managed server's agents first, since their
   * server-side identity is wiped here. */
  async reset(): Promise<void> {
    if (this.busy) throw new Error('A local-server operation is already in progress.');
    this.busy = true;
    const host: ServerHost = new LocalServerHost();
    try {
      this.setStatus({ phase: 'stopping', message: 'Destroying containers and data…' });
      await composeDown(host, true);
      await host.teardownNetworking();
      await clearSecrets(host);
      await clearPorts(host);
      this.setStatus({ phase: 'stopped', message: null, error: null });
    } catch (error) {
      this.setStatus({
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      host.dispose();
      this.busy = false;
    }
  }

  dispose(): void {
    this.startAbort?.abort();
    this.startAbort = null;
  }
}

export const localServerService = new LocalServerService();
