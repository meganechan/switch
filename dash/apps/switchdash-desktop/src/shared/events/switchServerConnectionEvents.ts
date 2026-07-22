import type { ServerConnectionStatus } from '@shared/core/switch-servers/switch-servers';
import { defineEvent } from '@shared/lib/ipc/events';

/**
 * Pushed by the main process when it observes a server's connection status
 * change outside an explicit refresh — chiefly when an authenticated gateway
 * call is rejected (401), so the UI can flip to "needs re-auth" live rather than
 * waiting for the next window focus or manual refresh (CHOO-1406).
 */
export const switchServerConnectionStatusChannel = defineEvent<ServerConnectionStatus>(
  'switch-server:connection-status'
);
