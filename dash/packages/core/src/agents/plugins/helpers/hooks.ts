import { Buffer } from 'node:buffer';

export type HookCommandOptions = {
  platform?: NodeJS.Platform;
};

export const SWITCHDASH_MARKER = 'SWITCHDASH_HOOK_PORT';

/** Filter out switchdash-managed entries from a hook array. */
export function filterUserHooks<T>(entries: T[], stringify?: (entry: T) => string): T[] {
  const toStr = stringify ?? JSON.stringify;
  return entries.filter((entry) => !toStr(entry).includes(SWITCHDASH_MARKER));
}

// ── Internal helpers ────────────────────────────────────────────────────────

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

type HookPostPayload = 'stdin' | { json: Record<string, string> };

function makePosixHookPostCommand(eventType: string, payload: HookPostPayload): string {
  const payloadPart =
    payload === 'stdin' ? '-d @- ' : `--data-binary '${JSON.stringify(payload.json)}' `;
  return (
    'curl -sf -X POST ' +
    '-H "Content-Type: application/json" ' +
    '-H "X-Switchdash-Token: $SWITCHDASH_HOOK_TOKEN" ' +
    '-H "X-Switchdash-Pty-Id: $SWITCHDASH_PTY_ID" ' +
    `-H "X-Switchdash-Event-Type: ${eventType}" ` +
    payloadPart +
    '"http://127.0.0.1:$SWITCHDASH_HOOK_PORT/hook" || true'
  );
}

function makeWindowsHookPostCommand(eventType: string, payload: HookPostPayload): string {
  const bodyLine =
    payload === 'stdin'
      ? '$payload = [Console]::In.ReadToEnd()'
      : `$payload = ${quotePowerShellString(JSON.stringify((payload as { json: Record<string, string> }).json))}`;
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    'if (-not $env:SWITCHDASH_HOOK_PORT -or -not $env:SWITCHDASH_HOOK_TOKEN -or -not $env:SWITCHDASH_PTY_ID) { exit 0 }',
    bodyLine,
    'try { Invoke-WebRequest -UseBasicParsing -Method POST ' +
      "-Uri ('http://127.0.0.1:' + $env:SWITCHDASH_HOOK_PORT + '/hook') " +
      '-Headers @{ ' +
      "'Content-Type' = 'application/json'; " +
      "'X-Switchdash-Token' = $env:SWITCHDASH_HOOK_TOKEN; " +
      "'X-Switchdash-Pty-Id' = $env:SWITCHDASH_PTY_ID; " +
      `'X-Switchdash-Event-Type' = '${eventType}' ` +
      '} -Body $payload | Out-Null } catch { exit 0 }',
  ].join('; ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return `cmd.exe /d /c "echo SWITCHDASH_HOOK_PORT >NUL & powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}"`;
}

/** Post an event with an arbitrary payload, platform-aware. */
export function makeHookPostCommand(
  eventType: string,
  payload: HookPostPayload,
  opts: HookCommandOptions
): string {
  return (opts.platform ?? process.platform) === 'win32'
    ? makeWindowsHookPostCommand(eventType, payload)
    : makePosixHookPostCommand(eventType, payload);
}

// ── Public command builders ─────────────────────────────────────────────────

/**
 * Standard stdin-piped hook command.
 * The agent pipes the event JSON body through stdin.
 */
export function makeStdinHookCommand(eventType: string, opts: HookCommandOptions = {}): string {
  return makeHookPostCommand(eventType, 'stdin', opts);
}

/**
 * Fixed-body notification hook command.
 * Sends a JSON body with a `notification_type` key (used by Codex-style events).
 */
export function makeNotificationHookCommand(
  notificationType: 'idle_prompt' | 'permission_prompt',
  opts: HookCommandOptions = {}
): string {
  return makeHookPostCommand(
    'notification',
    { json: { notification_type: notificationType } },
    opts
  );
}
