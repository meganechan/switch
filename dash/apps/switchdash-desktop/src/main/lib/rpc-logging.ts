import type { RPCInvocationWrapper } from '@shared/lib/ipc/rpc';
import type { LogContext } from '@shared/logger';
import { runWithLogContext } from './log-context';

/**
 * Reads the ids an RPC call already carries in its arguments.
 *
 * Only `sessionId` is looked for: it is the one field the rest of the context
 * can be derived from, and picking it up here means no handler below has to
 * forward it purely so that a log line can mention it.
 */
function rpcLogContext(channel: string, args: unknown[]): LogContext {
  const context: LogContext = { component: `rpc:${channel}` };

  for (const arg of args) {
    if (typeof arg !== 'object' || arg === null) continue;
    const candidate = (arg as Record<string, unknown>).sessionId;
    if (typeof candidate === 'string') {
      context.sessionId = candidate;
      break;
    }
  }

  return context;
}

export const withRPCLogContext: RPCInvocationWrapper = (channel, args, invoke) =>
  runWithLogContext(rpcLogContext(channel, args), invoke);
