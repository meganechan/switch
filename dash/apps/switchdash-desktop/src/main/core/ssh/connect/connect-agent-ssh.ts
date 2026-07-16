import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { resolveSshConnectConfig } from './resolve-ssh-connect-config';

/**
 * Register the per-id config resolver (the host's `~/.ssh/config` alias →
 * ssh2 ConnectConfig) and establish the pooled connection. The resolver is
 * reused for auto-reconnect; `connect` coalesces concurrent calls and reuses a
 * live connection, so calling this repeatedly for the same host is safe.
 *
 * host/port/username in the transient config are fallbacks: the real values
 * (and identity/agent) are resolved from the alias via `ssh -G`. Auth goes
 * through the SSH agent, matching switchdash's remote stack — switchdash stores no
 * credentials of its own.
 */
export async function ensureSshConnected(
  connectionId: string,
  sshHost: string
): Promise<SshClientProxy> {
  registerSshResolver(connectionId, sshHost);
  return sshConnectionManager.connect(connectionId);
}

/**
 * Force a full transport rebuild for a host's pooled connection — the manual
 * recovery path behind the UI's refresh. Registers the resolver first so it
 * also works for a host that has not connected yet this app run.
 */
export async function forceSshReconnect(
  connectionId: string,
  sshHost: string
): Promise<SshClientProxy> {
  registerSshResolver(connectionId, sshHost);
  return sshConnectionManager.forceReconnect(connectionId);
}

function registerSshResolver(connectionId: string, sshHost: string): void {
  sshConnectionManager.register(connectionId, () =>
    resolveSshConnectConfig({
      kind: 'transient',
      config: {
        name: sshHost,
        host: sshHost,
        port: 22,
        username: '',
        sshConfigAlias: sshHost,
        authType: 'agent',
      },
    })
  );
}
