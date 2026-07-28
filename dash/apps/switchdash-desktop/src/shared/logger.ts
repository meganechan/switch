export type Level = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured fields attached to a log entry.
 *
 * Ids are the join key and names are decoration: names are mutable (a session
 * can be renamed mid-run) so they record what the entity was called at write
 * time and must never be used to correlate entries.
 */
export type LogContext = {
  component?: string;
  runId?: string;
  sessionId?: string;
  sessionTitle?: string;
  agentId?: string;
  agentName?: string;
  agentSlug?: string;
  roomId?: string;
  roomName?: string;
  event?: string;
  stage?: string;
  errorCode?: string;
  durationMs?: number;
  attempt?: number;
};

export type LogSinkEntry = {
  level: Level;
  input: unknown[];
  source?: string;
  context?: LogContext;
};

export type LogSink = (entry: LogSinkEntry) => void;

export type Logger = {
  level: Level;
  sinkLevel: Level;
  debug: (...input: unknown[]) => void;
  info: (...input: unknown[]) => void;
  warn: (...input: unknown[]) => void;
  error: (...input: unknown[]) => void;
  child: (context: LogContext) => Logger;
};

export function mergeLogContext(
  base: LogContext | undefined,
  extra: LogContext | undefined
): LogContext | undefined {
  if (!base) return extra;
  if (!extra) return base;
  return { ...base, ...extra };
}

export function serializeLogValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return value.toString();

  if (value && typeof value === 'object') {
    try {
      return JSON.parse(stringifyLogValue(value));
    } catch {
      return String(value);
    }
  }

  return value;
}

export function stringifyLogValue(value: unknown) {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, nestedValue: unknown) => {
    if (nestedValue instanceof Error) return serializeLogValue(nestedValue);
    if (typeof nestedValue === 'bigint') return nestedValue.toString();
    if (typeof nestedValue === 'function') return `[Function ${nestedValue.name || 'anonymous'}]`;
    if (typeof nestedValue === 'symbol') return nestedValue.toString();
    if (nestedValue && typeof nestedValue === 'object') {
      if (seen.has(nestedValue)) return '[Circular]';
      seen.add(nestedValue);
    }
    return nestedValue;
  });
}

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function parseLogLevel(value: string | undefined): Level | undefined {
  if (!value) return undefined;
  const candidate = value.trim().toLowerCase();
  if (candidate in ORDER) return candidate as Level;
  return undefined;
}

export function resolveLogLevel(args?: { envLevel?: string; debugFlag?: boolean }): Level {
  return parseLogLevel(args?.envLevel) ?? (args?.debugFlag ? 'debug' : undefined) ?? 'warn';
}

export type CreateLoggerArgs = {
  envLevel?: string;
  debugFlag?: boolean;
  sink?: LogSink;
  /**
   * Level for the sink, resolved independently of the console level. The
   * console stays quiet by default while the file sink records the run, so a
   * shipped build has usable history without a noisy terminal.
   */
  sinkLevel?: Level;
  /** Ambient fields resolved at write time, merged under the entry's own context. */
  contextProvider?: () => LogContext | undefined;
  onSinkError?: (error: unknown) => void;
};

export function createLogger(args?: CreateLoggerArgs): Logger {
  const level = resolveLogLevel({
    envLevel: args?.envLevel ?? import.meta.env?.VITE_LOG_LEVEL,
    debugFlag: args?.debugFlag,
  });
  const sinkLevel = args?.sinkLevel ?? level;

  function enabled(target: Level, against: Level): boolean {
    return ORDER[target] >= ORDER[against];
  }

  function build(bound: LogContext | undefined): Logger {
    function emit(target: Level, writer: (...input: unknown[]) => void, input: unknown[]) {
      // Errors are always recorded regardless of the configured level.
      const always = target === 'error';

      if (always || enabled(target, level)) writer(...input);
      if (!args?.sink) return;
      if (!always && !enabled(target, sinkLevel)) return;

      try {
        args.sink({
          level: target,
          input,
          context: mergeLogContext(args.contextProvider?.(), bound),
        });
      } catch (error) {
        // Sink failures must never break the caller, but they must not be
        // invisible either — a logger that silently stops recording is worse
        // than no logger at all.
        args.onSinkError?.(error);
      }
    }

    return {
      level,
      sinkLevel,
      debug: (...input: unknown[]) => emit('debug', console.debug, input),
      info: (...input: unknown[]) => emit('info', console.info, input),
      warn: (...input: unknown[]) => emit('warn', console.warn, input),
      error: (...input: unknown[]) => emit('error', console.error, input),
      child: (context: LogContext) => build(mergeLogContext(bound, context)),
    };
  }

  return build(undefined);
}
