import { makeAutoObservable, runInAction } from 'mobx';
import { toast } from '@renderer/lib/hooks/use-toast';
import { events, rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';
import type {
  ServerConnectionStatus,
  SwitchAuthConfig,
  SwitchServer,
  UpdateServerResult,
} from '@shared/core/switch-servers/switch-servers';
import { switchServerConnectionStatusChannel } from '@shared/events/switchServerConnectionEvents';

/**
 * Renderer store for the Switch-server integration. Holds the registered
 * gateways, the per-server connection status (so the sidebar can show a dot per
 * entry), the per-server auth config (which login methods to offer), and which
 * server is active. Managing a server's agents/rooms happens in the gateway web
 * app for now, so this store deliberately does not fetch those — only what the
 * sidebar + the minimal server view need. Modeled on the singleton-store +
 * observable-state pattern used across the renderer stores.
 */
export class SwitchServersStore {
  servers: SwitchServer[] = [];
  activeServerId: string | null = null;

  /** Connection status per server id, refreshed on focus / select / manually. */
  readonly statuses = new Map<string, ServerConnectionStatus>();
  /** Auth config per server id, fetched lazily when a login panel needs it. */
  readonly authConfigs = new Map<string, SwitchAuthConfig>();

  loadingServers = false;
  /** Server ids with an in-flight status refresh. */
  readonly refreshing = new Set<string>();
  error: string | null = null;
  /** Whether the sidebar "Servers" section is expanded. */
  serversExpanded = true;

  /** Unsubscribe from the live connection-status push, set up once in `init`. */
  private offConnectionStatus: (() => void) | null = null;

  constructor() {
    makeAutoObservable(this);
  }

  get activeServer(): SwitchServer | null {
    return this.servers.find((s) => s.id === this.activeServerId) ?? null;
  }

  toggleServersExpanded(): void {
    this.serversExpanded = !this.serversExpanded;
  }

  statusFor(serverId: string): ServerConnectionStatus | null {
    return this.statuses.get(serverId) ?? null;
  }

  authConfigFor(serverId: string): SwitchAuthConfig | null {
    return this.authConfigs.get(serverId) ?? null;
  }

  isConnected(serverId: string): boolean {
    return this.statuses.get(serverId)?.connected ?? false;
  }

  async init(): Promise<void> {
    // Subscribe once: the main process pushes a status whenever an authenticated
    // gateway call is rejected, so an expired session surfaces live rather than
    // waiting for the next focus/manual refresh (CHOO-1406).
    if (!this.offConnectionStatus) {
      this.offConnectionStatus = events.on(switchServerConnectionStatusChannel, (status) => {
        this.applyPushedStatus(status);
      });
    }
    runInAction(() => {
      this.loadingServers = true;
      this.error = null;
    });
    try {
      const [servers, activeServerId] = await Promise.all([
        rpc.switchServers.listServers(),
        rpc.switchServers.getActiveServerId(),
      ]);
      runInAction(() => {
        this.servers = servers;
        this.activeServerId = activeServerId;
      });
      // The sidebar scopes its whole view to the active server, so one must
      // always be selected when any server exists. Default to the first.
      if (!this.activeServerId && servers.length > 0) {
        await this.setActive(servers[0].id);
      }
      await this.refreshAllStatuses();
    } catch (cause) {
      this.setError(cause);
    } finally {
      runInAction(() => {
        this.loadingServers = false;
      });
    }
  }

  async refreshAllStatuses(): Promise<void> {
    await Promise.all(this.servers.map((s) => this.refreshStatus(s.id)));
  }

  async refreshStatus(serverId: string): Promise<void> {
    runInAction(() => {
      this.refreshing.add(serverId);
    });
    try {
      const status = await rpc.switchServers.getConnectionStatus(serverId);
      runInAction(() => {
        this.statuses.set(serverId, status);
      });
    } catch {
      // An unreachable server is a real, displayable state — record it as
      // disconnected (the per-server status dot shows it). A background poll
      // failure must NOT raise the page-level `error` banner: that field is
      // global, so one unreachable server would paint an error over every
      // server's view.
      runInAction(() => {
        this.statuses.set(serverId, {
          serverId,
          connected: false,
          user: null,
          reason: 'signed-out',
        });
      });
    } finally {
      runInAction(() => {
        this.refreshing.delete(serverId);
      });
    }
  }

  /**
   * Apply a status pushed from the main process (a live 401 during use). Record
   * it, and when a server *transitions* into the expired state — from connected,
   * or from any other state we hadn't already flagged expired — raise an
   * app-level toast so it's obvious no matter which view is open. Guarding on the
   * transition keeps a burst of 401s from stacking duplicate toasts.
   */
  private applyPushedStatus(status: ServerConnectionStatus): void {
    const previous = this.statuses.get(status.serverId);
    const alreadyExpired = previous?.connected === false && previous.reason === 'expired';
    runInAction(() => {
      this.statuses.set(status.serverId, status);
    });
    if (!status.connected && status.reason === 'expired' && !alreadyExpired) {
      this.notifyExpired(status.serverId);
    }
  }

  private notifyExpired(serverId: string): void {
    const name = this.servers.find((s) => s.id === serverId)?.name ?? 'a Switch server';
    toast({
      title: 'Sign in again',
      description: `Your session for ${name} expired.`,
      variant: 'destructive',
      action: {
        label: 'Sign in',
        onClick: () => {
          void this.setActive(serverId);
          appState.navigation.navigate('server', { serverId });
        },
      },
    });
  }

  async ensureAuthConfig(serverId: string): Promise<void> {
    if (this.authConfigs.has(serverId)) return;
    try {
      const config = await rpc.switchServers.getAuthConfig(serverId);
      runInAction(() => {
        this.authConfigs.set(serverId, config);
      });
    } catch (cause) {
      this.setError(cause);
    }
  }

  async addServer(name: string, gatewayUrl: string, apiUrl: string): Promise<SwitchServer | null> {
    this.clearError();
    try {
      const created = await rpc.switchServers.addServer({ name, gatewayUrl, apiUrl });
      const [servers, activeServerId] = await Promise.all([
        rpc.switchServers.listServers(),
        rpc.switchServers.getActiveServerId(),
      ]);
      runInAction(() => {
        this.servers = servers;
        this.activeServerId = activeServerId;
      });
      await this.refreshStatus(created.id);
      return created;
    } catch (cause) {
      this.setError(cause);
      return null;
    }
  }

  async updateServer(
    id: string,
    name: string,
    gatewayUrl: string,
    apiUrl: string
  ): Promise<UpdateServerResult | null> {
    this.clearError();
    try {
      const result = await rpc.switchServers.updateServer({ id, name, gatewayUrl, apiUrl });
      const servers = await rpc.switchServers.listServers();
      runInAction(() => {
        this.servers = servers;
      });
      return result;
    } catch (cause) {
      this.setError(cause);
      return null;
    }
  }

  async removeServer(serverId: string): Promise<void> {
    this.clearError();
    try {
      await rpc.switchServers.removeServer(serverId);
      const [servers, activeServerId] = await Promise.all([
        rpc.switchServers.listServers(),
        rpc.switchServers.getActiveServerId(),
      ]);
      runInAction(() => {
        this.servers = servers;
        this.activeServerId = activeServerId;
        this.statuses.delete(serverId);
        this.authConfigs.delete(serverId);
      });
      // Keep a server scoped when any remain (the sidebar scopes to it).
      if (!this.activeServerId && servers.length > 0) {
        await this.setActive(servers[0].id);
      }
    } catch (cause) {
      this.setError(cause);
    }
  }

  async setActive(serverId: string): Promise<void> {
    this.clearError();
    try {
      await rpc.switchServers.setActiveServer(serverId);
      runInAction(() => {
        this.activeServerId = serverId;
      });
    } catch (cause) {
      this.setError(cause);
    }
  }

  async passwordLogin(serverId: string, email: string, password: string): Promise<boolean> {
    this.clearError();
    const result = await rpc.switchServers.passwordLogin({ serverId, email, password });
    if (!result.success) {
      runInAction(() => {
        this.error = result.error.message;
      });
      return false;
    }
    await this.refreshStatus(serverId);
    return true;
  }

  async oidcLogin(serverId: string): Promise<boolean> {
    this.clearError();
    const result = await rpc.switchServers.oidcLogin(serverId);
    if (!result.success) {
      // A user-cancelled window is not an error worth shouting about.
      if (result.error.kind !== 'cancelled') {
        runInAction(() => {
          this.error = result.error.message;
        });
      }
      return false;
    }
    await this.refreshStatus(serverId);
    return true;
  }

  async logout(serverId: string): Promise<void> {
    this.clearError();
    try {
      await rpc.switchServers.logout(serverId);
      await this.refreshStatus(serverId);
    } catch (cause) {
      this.setError(cause);
    }
  }

  private clearError(): void {
    runInAction(() => {
      this.error = null;
    });
  }

  private setError(cause: unknown): void {
    runInAction(() => {
      this.error = cause instanceof Error ? cause.message : String(cause);
    });
  }
}

export const switchServersStore = new SwitchServersStore();
