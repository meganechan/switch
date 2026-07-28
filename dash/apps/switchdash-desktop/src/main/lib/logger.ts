import { createLogger, resolveLogLevel } from '@shared/logger';
import { writeLogEntry } from './file-logger';

/**
 * The console and the file are levelled independently.
 *
 * A single level meant the file recorded exactly what the terminal did, so a
 * shipped build — where the default is `warn` — kept only warnings and errors
 * and none of the run that led to them. The file now defaults to `info` so a
 * user's log has the story around a failure, while the console stays quiet
 * unless asked otherwise.
 */
const fileLevel = resolveLogLevel({
  envLevel: process.env.LOG_FILE_LEVEL ?? process.env.LOG_LEVEL ?? 'info',
  debugFlag: process.argv.includes('--debug-logs'),
});

export const log = createLogger({
  envLevel: process.env.LOG_LEVEL,
  debugFlag: process.argv.includes('--debug-logs'),
  sink: writeLogEntry,
  sinkLevel: fileLevel,
  // Ambient context is resolved by the sink, which serves renderer and sidecar
  // entries too — doing it here as well would just resolve it twice.
  onSinkError: (error) => console.error('Log sink failed:', error),
});

export type Logger = ReturnType<typeof createLogger>;
