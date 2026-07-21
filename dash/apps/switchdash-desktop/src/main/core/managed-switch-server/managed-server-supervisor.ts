import { log } from '@main/lib/logger';
import { COMPATIBLE_SWITCH_VERSION } from '@shared/app-identity';
import type {
  DockerAvailability,
  LocalServerStatus,
  StartLocalServerResult,
} from '@shared/core/managed-switch-server/managed-switch-server';
import type { ManagedServerRef } from '@shared/core/switch-servers/switch-servers';
import { isStackRunning } from './compose';
import type { ServerHost } from './host/types';
import { resetStack, startStack, stopStack } from './pipeline';
import { readPersistedPorts } from './ports';

/** The lifecycle status of one managed target (local, or a single remote host).
 * Structurally the `LocalServerStatus` shape, reused for both. */
export type ManagedServerStatus = LocalServerStatus;

export type ManagedServerSupervisorOptions = {
  /** Which managed record this supervisor owns (local, or a remote host). */
  ref: ManagedServerRef;
  /** Build a fresh {@link ServerHost} for this target. Called per start (and for
   * one-shot detect/stop/reset when no host is live). */
  createHost: () => ServerHost | Promise<ServerHost>;
  /** Emit the target's status after each transition (the service routes it to
   * the right event channel, tagging it if needed). */
  emitStatus: (status: ManagedServerStatus) => void;
  /** Emit a line of compose output during a start. */
  emitLog: (line: string) => void;
};

/**
 * Supervises the lifecycle of ONE managed Switch stack (local, or one remote
 * host) on top of the shared {@link startStack} pipeline: the busy guard, the
 * phase transitions (stopped → starting → running / error), the abort of an
 * in-flight health wait, and error mapping. The local- and remote-server
 * services compose one (or, for remote, one per host) of these; all that differs
 * between them is the {@link ManagedServerSupervisorOptions.createHost} factory
 * and how the emitted status is routed.
 *
 * The supervisor holds the live host after a successful start and disposes it on
 * stop/reset (and replaces it on the next start). This is required for a remote
 * host — it owns the persistent port-forward that must outlive the start call —
 * and harmless for the local host.
 */
export class ManagedServerSupervisor {
  private status: ManagedServerStatus = {
    phase: 'stopped',
    serverId: null,
    version: COMPATIBLE_SWITCH_VERSION,
    message: null,
    error: null,
  };

  private busy = false;
  private startAbort: AbortController | null = null;
  private host: ServerHost | null = null;

  constructor(private readonly opts: ManagedServerSupervisorOptions) {}

  getStatus(): ManagedServerStatus {
    return this.status;
  }

  private setStatus(patch: Partial<ManagedServerStatus>): void {
    this.status = { ...this.status, ...patch };
    this.opts.emitStatus(this.status);
  }

  /** Docker availability on this target. Uses a throwaway host unless one is
   * already live (whose disposal would tear down its forward). */
  async detectDocker(): Promise<DockerAvailability> {
    if (this.host) return this.host.detectDocker();
    const host = await this.opts.createHost();
    try {
      return await host.detectDocker();
    } finally {
      host.dispose();
    }
  }

  async start(serverName: string): Promise<StartLocalServerResult> {
    if (this.busy) {
      return { kind: 'error', message: 'An operation is already in progress for this server.' };
    }
    this.busy = true;
    this.startAbort = new AbortController();
    // Replace any prior live host (and its forward).
    this.host?.dispose();
    this.host = null;
    let host: ServerHost | null = null;
    try {
      this.setStatus({ phase: 'starting', error: null, message: 'Connecting…' });
      host = await this.opts.createHost();
      this.setStatus({ message: 'Checking Docker…' });
      const result = await startStack({
        host,
        ref: this.opts.ref,
        serverName,
        onMessage: (message) => this.setStatus({ message }),
        onLog: this.opts.emitLog,
        signal: this.startAbort.signal,
      });
      if (result.kind === 'docker-unavailable') {
        this.setStatus({ phase: 'error', error: result.detail });
        host.dispose();
      } else if (result.kind === 'error') {
        this.setStatus({ phase: 'error', error: result.message });
        host.dispose();
      } else {
        // Keep the host alive — it may own a persistent forward.
        this.host = host;
        this.setStatus({ phase: 'running', serverId: result.serverId, message: null, error: null });
      }
      return result;
    } catch (error) {
      host?.dispose();
      const message = error instanceof Error ? error.message : String(error);
      log.error('managed-switch-server: start failed', { ref: this.opts.ref, error });
      this.setStatus({ phase: 'error', error: message });
      return { kind: 'error', message };
    } finally {
      this.busy = false;
      this.startAbort = null;
    }
  }

  async stop(): Promise<void> {
    if (this.busy) throw new Error('An operation is already in progress for this server.');
    this.busy = true;
    const host = this.host ?? (await this.opts.createHost());
    try {
      this.setStatus({ phase: 'stopping', message: 'Stopping containers…' });
      await stopStack(host);
      this.setStatus({ phase: 'stopped', message: null, error: null });
    } catch (error) {
      this.setStatus({
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      host.dispose();
      this.host = null;
      this.busy = false;
    }
  }

  /** Destroy the stack, its data volumes, and stored secrets. The caller removes
   * the server's agents first (their server-side identity is wiped here). */
  async reset(): Promise<void> {
    if (this.busy) throw new Error('An operation is already in progress for this server.');
    this.busy = true;
    const host = this.host ?? (await this.opts.createHost());
    try {
      this.setStatus({ phase: 'stopping', message: 'Destroying containers and data…' });
      await resetStack(host);
      this.setStatus({ phase: 'stopped', message: null, error: null });
    } catch (error) {
      this.setStatus({
        phase: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      host.dispose();
      this.host = null;
      this.busy = false;
    }
  }

  /**
   * Reconcile at boot: if the stack survived the last quit, adopt it — establish
   * networking (re-open a remote forward; a no-op locally) and mark it running,
   * keeping the host alive. Leaves the target `stopped` when the stack is down,
   * or when it is up but we don't know its ports (restart re-derives them rather
   * than forwarding to the wrong ones).
   */
  async reconcile(serverId: string): Promise<void> {
    const host = await this.opts.createHost();
    try {
      if (!(await isStackRunning(host))) {
        host.dispose();
        return;
      }
      const ports = await readPersistedPorts(host);
      if (!ports) {
        host.dispose();
        return;
      }
      await host.establishNetworking(ports);
      this.host = host;
      this.setStatus({ phase: 'running', serverId, message: null, error: null });
    } catch (error) {
      host.dispose();
      throw error;
    }
  }

  /** Abort an in-flight health wait and drop the live host (app quit). Managed
   * containers keep running; only a remote forward closes. */
  dispose(): void {
    this.startAbort?.abort();
    this.startAbort = null;
    this.host?.dispose();
    this.host = null;
  }
}
