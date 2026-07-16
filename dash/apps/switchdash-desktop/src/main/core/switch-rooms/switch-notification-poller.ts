import * as os from 'node:os';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { DEEPLINK_SCHEME } from '@main/app/deeplinks';
import { subagentSettingsPath } from '@main/core/agents/switch-settings-paths';
import { isHumanInputRecent } from '@main/core/pty/human-activity';
import { db } from '@main/db/client';
import { projects, sessions } from '@main/db/schema';
import { log } from '@main/lib/logger';
import type { AgentStatus, NotificationType } from '@shared/core/providers/agentEvents';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
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
 * session's Switch credentials from the project's settings file, wires a
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
    const existing = this.connections.get(ctx.conversationId);
    if (existing && existing.room === roomId) return;
    this.disconnect(ctx.conversationId);
    void this.start(ctx, roomId, roomName).catch((error) => {
      log.warn('SwitchNotificationPoller: failed to start poller', {
        conversationId: ctx.conversationId,
        error: String(error),
      });
    });
  }

  /** Stop polling for a session (room switch-away or session exit). */
  disconnect(conversationId: string): void {
    const conn = this.connections.get(conversationId);
    if (!conn) return;
    conn.stop();
    this.connections.delete(conversationId);
    log.debug('SwitchNotificationPoller: poll stopped', { conversationId });
  }

  dispose(): void {
    for (const conversationId of [...this.connections.keys()]) this.disconnect(conversationId);
  }

  private async start(
    ctx: SessionRoomContext,
    roomId: string,
    roomName: string | null
  ): Promise<void> {
    const [project] = await db
      .select({ path: projects.path })
      .from(projects)
      .where(eq(projects.id, ctx.projectId))
      .limit(1);
    if (!project) {
      log.warn('SwitchNotificationPoller: no project dir for session; cannot read credentials', {
        conversationId: ctx.conversationId,
        projectId: ctx.projectId,
      });
      return;
    }
    if (project.path === null) {
      // Remote agents poll from their on-host sidecar (CHOO-1059); the local
      // poller reads local credential files, which a remote-only agent has none of.
      log.debug('SwitchNotificationPoller: remote-only project; local poller does not apply', {
        conversationId: ctx.conversationId,
        projectId: ctx.projectId,
      });
      return;
    }
    const projectPath = project.path;

    // A subagent session must poll as the subagent (its own credentials file),
    // not the parent's `.claude/settings.local.json` — otherwise it receives the
    // events addressed to the parent rather than to the subagent.
    const [sessionRow] = await db
      .select({ config: sessions.config })
      .from(sessions)
      .where(eq(sessions.id, ctx.conversationId))
      .limit(1);
    const subagentName = sessionRow?.config?.subagentName;

    const creds = subagentName
      ? await readSwitchAgentCredentialsFromSettings(
          subagentSettingsPath(projectPath, subagentName),
          log
        )
      : await readSwitchAgentCredentials(projectPath, log);
    if (!creds) {
      log.warn(
        'SwitchNotificationPoller: missing Switch credentials (SWITCH_API_TOKEN/ENDPOINT/AGENT_ID) — cannot poll room',
        { conversationId: ctx.conversationId, dir: project.path, roomId, subagentName }
      );
      return;
    }

    const ptySessionId = makePtySessionId(ctx.projectId, ctx.conversationId, ctx.conversationId);
    const connection = new RoomConnection({
      creds,
      roomId,
      roomName,
      conversationId: ctx.conversationId,
      sink: new PtyInjectionSink(ptySessionId),
      injector: new PluginPromptInjector(ctx.providerId),
      control: resolveSessionControl(ctx.providerId),
      deeplinkScheme: DEEPLINK_SCHEME,
      isHumanTyping: () => isHumanInputRecent(ptySessionId),
      mediaDir: path.join(os.tmpdir(), 'switchdash-switch-media', ctx.conversationId),
      log,
    });
    this.connections.set(ctx.conversationId, connection);

    log.debug('SwitchNotificationPoller: poll started', {
      conversationId: ctx.conversationId,
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
    conversationId: string,
    status: AgentStatus,
    notificationType?: NotificationType
  ): void {
    const connection = this.connections.get(conversationId);
    if (!connection) return;
    connection.onAgentStatusChange(status, notificationType);
  }

  /**
   * Report the running turn's latest activity line (e.g. "Editing foo.py") so
   * the connection can refresh the bridged "working on it…" message. Called
   * directly by AgentHookService for the same renderer-bound-bus reason as
   * `onAgentStatusChange`. A no-op for sessions we aren't polling.
   */
  onAgentActivity(conversationId: string, detail: string): void {
    const connection = this.connections.get(conversationId);
    if (!connection) return;
    connection.reportActivity(detail);
  }
}

export const switchNotificationPoller = new SwitchNotificationPoller();
