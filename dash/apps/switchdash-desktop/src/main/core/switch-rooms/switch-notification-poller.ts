import * as os from 'node:os';
import * as path from 'node:path';
import { DEEPLINK_SCHEME } from '@main/app/deeplinks';
import { agentSettingsPath, subagentSettingsPath } from '@main/core/agents/switch-settings-paths';
import { getLocationById } from '@main/core/locations/store';
import { isHumanInputRecent } from '@main/core/pty/human-activity';
import { loadSessionWithAgent } from '@main/core/sessions/session-join';
import { log } from '@main/lib/logger';
import type { AgentStatus, NotificationType } from '@shared/core/providers/agentEvents';
import { makeAgentPtySessionId } from '@shared/core/pty/ptySessionId';
import { PtyInjectionSink } from './injection-sink';
import { PluginPromptInjector } from './plugin-prompt-injector';
import { RoomConnection } from './room-connection';
import { resolveSessionControl } from './session-control';
import {
  readSwitchAgentCredentials,
  readSwitchAgentCredentialsFromSettings,
} from './switch-credentials';
import type { SessionRoomContext } from './switch-room-service';

/**
 * Polls the Switch agent bridge for room events on behalf of each live session
 * switchdash manages, and injects addressed messages / task events into the
 * session's PTY as keystrokes. This is the switchdash-side counterpart to the
 * in-session connector channel; only one of the two polls a given session's
 * room at a time (see the cede mechanism — managed sessions disable the
 * channel's own poll loop).
 *
 * This is a thin manager over per-room `RoomConnection`s: it resolves the
 * session's Switch credentials from the location's settings file, wires a
 * PTY-backed injection sink, and routes agent status changes to the matching
 * connection. The transport-agnostic poll/queue/runtime-state logic lives in
 * `RoomConnection`, which the on-VM sidecar reuses over a tmux-backed sink.
 */
class SwitchNotificationPoller {
  private readonly connections = new Map<string, RoomConnection>();

  /**
   * Begin polling the room a session just connected to (replaces any prior).
   * Idempotent for the same room: a repeat connect (e.g. a hydration after a
   * boot-time sweep already started the poller) is a no-op so the in-flight
   * queue and renew loop are preserved.
   */
  connect(ctx: SessionRoomContext, roomId: string, roomName: string | null): void {
    const existing = this.connections.get(ctx.sessionId);
    if (existing && existing.room === roomId) return;
    this.disconnect(ctx.sessionId);
    void this.start(ctx, roomId, roomName).catch((error) => {
      log.warn('SwitchNotificationPoller: failed to start poller', {
        sessionId: ctx.sessionId,
        error: String(error),
      });
    });
  }

  /** Stop polling for a session (room switch-away or session exit). */
  disconnect(sessionId: string): void {
    const conn = this.connections.get(sessionId);
    if (!conn) return;
    conn.stop();
    this.connections.delete(sessionId);
    log.debug('SwitchNotificationPoller: poll stopped', { sessionId });
  }

  dispose(): void {
    for (const sessionId of [...this.connections.keys()]) this.disconnect(sessionId);
  }

  private async start(
    ctx: SessionRoomContext,
    roomId: string,
    roomName: string | null
  ): Promise<void> {
    const loaded = await loadSessionWithAgent(ctx.sessionId);
    if (!loaded) {
      log.warn('SwitchNotificationPoller: session not found; cannot read credentials', {
        sessionId: ctx.sessionId,
      });
      return;
    }
    const location = await getLocationById(loaded.locationId);
    if (!location) {
      log.warn('SwitchNotificationPoller: no location for session; cannot read credentials', {
        sessionId: ctx.sessionId,
      });
      return;
    }
    if (location.sshHost !== null) {
      // Remote agents poll from their on-host sidecar (CHOO-1059); the local
      // poller reads local credential files, which a remote agent has none of.
      log.debug('SwitchNotificationPoller: remote location; local poller does not apply', {
        sessionId: ctx.sessionId,
        locationId: location.id,
      });
      return;
    }
    const rootPath = location.dir;

    // A session polls as its OWN agent's identity — resolved from the joined
    // agent row, not from a name frozen into the session's config. A subagent's
    // creds live in its provider-neutral `.switch/agents/<definitionName>.json`,
    // keyed by the agent's definition name; a plain agent (no definitionName)
    // uses `.switch/agents/<agentId>.json`. Deriving the slug from the live agent
    // row is what stops a session from polling under the wrong identity when the
    // definition is renamed or when a stale tag disagrees with the agent row.
    const agentId = loaded.row.agentId;
    const slug = loaded.definitionName;

    // Fall back to the legacy subagent path, then the location's
    // `.claude/settings.local.json`, for un-migrated installs (CHOO-1440).
    const creds = slug
      ? ((await readSwitchAgentCredentialsFromSettings(agentSettingsPath(rootPath, slug), log)) ??
        (await readSwitchAgentCredentialsFromSettings(subagentSettingsPath(rootPath, slug), log)))
      : ((await readSwitchAgentCredentialsFromSettings(
          agentSettingsPath(rootPath, agentId),
          log
        )) ?? (await readSwitchAgentCredentials(rootPath, log)));
    if (!creds) {
      log.warn(
        'SwitchNotificationPoller: missing Switch credentials (SWITCH_API_TOKEN/ENDPOINT/AGENT_ID) — cannot poll room',
        { sessionId: ctx.sessionId, dir: rootPath, roomId, slug }
      );
      return;
    }

    const ptySessionId = makeAgentPtySessionId(location.id, ctx.sessionId);
    const connection = new RoomConnection({
      creds,
      roomId,
      roomName,
      sessionId: ctx.sessionId,
      sink: new PtyInjectionSink(ptySessionId),
      injector: new PluginPromptInjector(ctx.providerId),
      control: resolveSessionControl(ctx.providerId),
      deeplinkScheme: DEEPLINK_SCHEME,
      isHumanTyping: () => isHumanInputRecent(ptySessionId),
      mediaDir: path.join(os.tmpdir(), 'switchdash-switch-media', ctx.sessionId),
      log,
    });
    this.connections.set(ctx.sessionId, connection);

    log.debug('SwitchNotificationPoller: poll started', {
      sessionId: ctx.sessionId,
      roomId,
      roomName,
      agentId: creds.agentId,
    });

    connection.start();
  }

  /**
   * Update the injection gate when an agent's derived status changes. Called
   * directly by AgentHookService (the `events` bus is renderer-bound in main, so
   * an in-process emit would not reach us). A no-op for sessions we aren't
   * polling.
   */
  onAgentStatusChange(
    sessionId: string,
    status: AgentStatus,
    notificationType?: NotificationType
  ): void {
    const connection = this.connections.get(sessionId);
    if (!connection) return;
    connection.onAgentStatusChange(status, notificationType);
  }

  /**
   * Report the running turn's latest activity line (e.g. "Editing foo.py") so
   * the connection can refresh the bridged "working on it…" message. Called
   * directly by AgentHookService for the same renderer-bound-bus reason as
   * `onAgentStatusChange`. A no-op for sessions we aren't polling.
   */
  onAgentActivity(sessionId: string, detail: string): void {
    const connection = this.connections.get(sessionId);
    if (!connection) return;
    connection.reportActivity(detail);
  }
}

export const switchNotificationPoller = new SwitchNotificationPoller();
