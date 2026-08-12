import { Buffer } from 'node:buffer';
import type { HookCommand, HookCommandOptions } from '../capabilities/hooks-types';

export const SWITCHDASH_MARKER = 'SWITCHDASH_HOOK_PORT';

/** Filter out Switch Console-managed entries from a hook array. */
export function filterUserHooks<T>(entries: T[], stringify?: (entry: T) => string): T[] {
  const toStr = stringify ?? JSON.stringify;
  return entries.filter((entry) => !toStr(entry).includes(SWITCHDASH_MARKER));
}

// ── Internal helpers ────────────────────────────────────────────────────────

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

type HookPostPayload = 'stdin' | { json: Record<string, string> };

/**
 * Resolve the hook endpoint at fire time, preferring the endpoint file when the
 * launching runtime pointed us at one.
 *
 * A pane's environment is fixed at spawn, so a session launched against the
 * remote sidecar would keep posting to the port and token that sidecar happened
 * to hold at the time — both of which change every time it restarts. Baking the
 * *path* to the endpoint file instead lets those sessions follow the sidecar
 * across restarts, upgrades, and token rotation.
 *
 * The file is parsed line-by-line rather than sourced: it lives in the agent's
 * repo dir, and `.`-ing it would make anything that can write there able to run
 * arbitrary code in every hook. Falls back to the environment, which is how
 * local sessions (and any pane spawned before this existed) keep working.
 *
 * {@link POWERSHELL_ENDPOINT_PREAMBLE} is the same resolution for the Windows
 * branch; the two must stay in step or one platform's sessions go silent the
 * first time their sidecar rebinds.
 */
const POSIX_ENDPOINT_PREAMBLE =
  '_sd_p="$SWITCHDASH_HOOK_PORT"; _sd_t="$SWITCHDASH_HOOK_TOKEN"; ' +
  'if [ -n "$SWITCHDASH_HOOK_ENDPOINT_FILE" ] && [ -r "$SWITCHDASH_HOOK_ENDPOINT_FILE" ]; then ' +
  '_sd_f=$(sed -n 1p "$SWITCHDASH_HOOK_ENDPOINT_FILE"); ' +
  '_sd_g=$(sed -n 2p "$SWITCHDASH_HOOK_ENDPOINT_FILE"); ' +
  '[ -n "$_sd_f" ] && _sd_p="$_sd_f"; [ -n "$_sd_g" ] && _sd_t="$_sd_g"; ' +
  'fi; ';

function makePosixHookPostCommand(eventType: string, payload: HookPostPayload): string {
  const payloadPart =
    payload === 'stdin' ? '-d @- ' : `--data-binary '${JSON.stringify(payload.json)}' `;
  return (
    POSIX_ENDPOINT_PREAMBLE +
    'curl -sf -X POST ' +
    '-H "Content-Type: application/json" ' +
    '-H "X-Switchdash-Token: $_sd_t" ' +
    '-H "X-Switchdash-Pty-Id: $SWITCHDASH_PTY_ID" ' +
    `-H "X-Switchdash-Event-Type: ${eventType}" ` +
    payloadPart +
    '"http://127.0.0.1:$_sd_p/hook" || true'
  );
}

/** The PowerShell counterpart to {@link POSIX_ENDPOINT_PREAMBLE}. */
const POWERSHELL_ENDPOINT_PREAMBLE = [
  '$sdPort = $env:SWITCHDASH_HOOK_PORT',
  '$sdToken = $env:SWITCHDASH_HOOK_TOKEN',
  'if ($env:SWITCHDASH_HOOK_ENDPOINT_FILE -and ' +
    '(Test-Path -LiteralPath $env:SWITCHDASH_HOOK_ENDPOINT_FILE -PathType Leaf)) { ' +
    '$sdLines = @(Get-Content -LiteralPath $env:SWITCHDASH_HOOK_ENDPOINT_FILE -TotalCount 2); ' +
    'if ($sdLines.Count -ge 1 -and $sdLines[0].Trim()) { $sdPort = $sdLines[0].Trim() }; ' +
    'if ($sdLines.Count -ge 2 -and $sdLines[1].Trim()) { $sdToken = $sdLines[1].Trim() } }',
];

function makeWindowsHookPostCommand(eventType: string, payload: HookPostPayload): string {
  const bodyLine =
    payload === 'stdin'
      ? '$payload = [Console]::In.ReadToEnd()'
      : `$payload = ${quotePowerShellString(JSON.stringify((payload as { json: Record<string, string> }).json))}`;
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    ...POWERSHELL_ENDPOINT_PREAMBLE,
    'if (-not $sdPort -or -not $sdToken -or -not $env:SWITCHDASH_PTY_ID) { exit 0 }',
    bodyLine,
    'try { Invoke-WebRequest -UseBasicParsing -Method POST ' +
      "-Uri ('http://127.0.0.1:' + $sdPort + '/hook') " +
      '-Headers @{ ' +
      "'Content-Type' = 'application/json'; " +
      "'X-Switchdash-Token' = $sdToken; " +
      "'X-Switchdash-Pty-Id' = $env:SWITCHDASH_PTY_ID; " +
      `'X-Switchdash-Event-Type' = '${eventType}' ` +
      '} -Body $payload | Out-Null } catch { exit 0 }',
  ].join('; ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  // The script is base64 in the file, so the marker filterUserHooks scans for
  // has to be spelled out here or a managed entry is never recognised again.
  return `cmd.exe /d /c "echo SWITCHDASH_HOOK_PORT >NUL & powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}"`;
}

/** Post an event with an arbitrary payload, resolved against the target platform. */
export function makeHookPostCommand(eventType: string, payload: HookPostPayload): HookCommand {
  return (opts: HookCommandOptions) =>
    opts.platform === 'win32'
      ? makeWindowsHookPostCommand(eventType, payload)
      : makePosixHookPostCommand(eventType, payload);
}

// ── Public command builders ─────────────────────────────────────────────────

/**
 * Standard stdin-piped hook command.
 * The agent pipes the event JSON body through stdin.
 */
export function makeStdinHookCommand(eventType: string): HookCommand {
  return makeHookPostCommand(eventType, 'stdin');
}

/**
 * Fixed-body notification hook command.
 * Sends a JSON body with a `notification_type` key (used by Codex-style events).
 */
export function makeNotificationHookCommand(
  notificationType: 'idle_prompt' | 'permission_prompt'
): HookCommand {
  return makeHookPostCommand('notification', { json: { notification_type: notificationType } });
}
