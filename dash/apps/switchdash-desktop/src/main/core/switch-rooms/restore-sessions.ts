import { hydrateConversation } from '@main/core/conversations/hydrateConversation';
import { loadSessionWithAgent } from '@main/core/conversations/session-join';
import { getProjectById } from '@main/core/projects/operations/getProjects';
import { projectManager } from '@main/core/projects/project-manager';
import { sessionService } from '@main/core/sessions/session-service';
import { log } from '@main/lib/logger';
import { switchRoomService } from './switch-room-service';

/**
 * Launch every session that was connected to a Switch room before the last
 * shutdown, so it receives and responds to room events without the user opening
 * its terminal. Replays the renderer's open sequence from the main process:
 * mount the project → provision the session runtime → hydrate the conversation
 * (which spawns the PTY and, via the session-launch path, restarts the room
 * poller). Sessions whose conversation or project no longer exist are pruned.
 *
 * This deliberately spawns the agent process for each room-connected session at
 * startup — keystroke injection requires a live TUI, so there is no lighter way
 * to deliver room messages to an unopened session.
 */
export async function restoreSwitchRoomSessions(): Promise<void> {
  const conversationIds = await switchRoomService.listPersistedConversationIds();
  if (conversationIds.length === 0) return;

  const stale: string[] = [];
  let launched = 0;

  for (const conversationId of conversationIds) {
    try {
      const loaded = await loadSessionWithAgent(conversationId);
      if (!loaded) {
        stale.push(conversationId);
        continue;
      }

      const project = await getProjectById(loaded.projectId);
      if (!project) {
        stale.push(conversationId);
        continue;
      }

      if (!projectManager.getProject(loaded.projectId)) {
        const opened = await projectManager.openProject(project);
        if (!opened.success) {
          log.warn('restoreSwitchRoomSessions: failed to open project; skipping session', {
            conversationId,
            projectId: loaded.projectId,
            error: opened.error,
          });
          continue;
        }
      }

      await sessionService.provisionWorkspace(conversationId);
      // sessionId === conversationId in this data model.
      await hydrateConversation(loaded.projectId, conversationId, conversationId);
      launched += 1;
    } catch (error) {
      log.warn('restoreSwitchRoomSessions: failed to launch room-connected session', {
        conversationId,
        error: String(error),
      });
    }
  }

  if (stale.length > 0) await switchRoomService.prunePersisted(stale);

  log.info('restoreSwitchRoomSessions: launched room-connected sessions at startup', {
    launched,
    pruned: stale.length,
  });
}
