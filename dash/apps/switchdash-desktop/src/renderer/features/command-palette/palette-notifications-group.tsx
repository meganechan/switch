import { Command } from 'cmdk';
import { useObserver } from 'mobx-react-lite';
import {
  asMounted,
  getProjectManagerStore,
} from '@renderer/features/projects/stores/project-selectors';
import type { ConversationStore } from '@renderer/features/sessions/conversations/conversation-manager';
import { conversationRegistry } from '@renderer/features/sessions/stores/conversation-registry';
import { isRegistered, type SessionStore } from '@renderer/features/sessions/stores/session-store';
import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';
import { cn } from '@renderer/utils/utils';
import { PaletteConversationItem } from './palette-conversation-item';
import { PaletteSessionItem } from './palette-session-item';

type NotificationItem =
  | { kind: 'session'; projectId: string; sessionStore: SessionStore }
  | { kind: 'conversation'; projectId: string; sessionId: string; conv: ConversationStore };

const GROUP_CLASS = cn(
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
  '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium',
  '[&_[cmdk-group-heading]]:text-foreground/50'
);

interface PaletteNotificationsGroupProps {
  currentProjectId: string | undefined;
  currentSessionId: string | undefined;
  onClose: () => void;
  navigate: NavigateFnTyped;
}

export function PaletteNotificationsGroup({
  currentProjectId,
  currentSessionId,
  onClose,
  navigate,
}: PaletteNotificationsGroupProps) {
  const items = useObserver((): NotificationItem[] => {
    const result: NotificationItem[] = [];

    for (const projectStore of getProjectManagerStore().projects.values()) {
      const mounted = asMounted(projectStore);
      if (!mounted) continue;
      const pid = mounted.data.id;

      for (const [tid, sessionStore] of mounted.sessionManager.sessions) {
        if (!isRegistered(sessionStore)) continue;
        const conversations = conversationRegistry.get(tid);
        if (!conversations) continue;

        const status = conversations.sessionStatus;
        // Only surface awaiting-input, error, completed — not working or idle.
        if (!status || status === 'idle' || status === 'working') continue;

        if (pid === currentProjectId && tid === currentSessionId) {
          // We're already in this session — surface individual unseen conversations.
          for (const conv of conversations.conversations.values()) {
            if (!conv.seen && conv.indicatorStatus) {
              result.push({ kind: 'conversation', projectId: pid, sessionId: tid, conv });
            }
          }
        } else {
          result.push({ kind: 'session', projectId: pid, sessionStore });
        }
      }
    }

    return result;
  });

  if (items.length === 0) return null;

  return (
    <Command.Group heading="Notifications" className={GROUP_CLASS}>
      {items.map((item) => {
        if (item.kind === 'conversation') {
          return (
            <PaletteConversationItem
              key={item.conv.data.id}
              conv={item.conv}
              value={`notif:conversation:${item.conv.data.id}`}
              onSelect={() => {
                if (item.projectId !== currentProjectId || item.sessionId !== currentSessionId) {
                  navigate('session', { projectId: item.projectId, sessionId: item.sessionId });
                }
                onClose();
              }}
            />
          );
        }
        return (
          <PaletteSessionItem
            key={item.sessionStore.data.id}
            sessionStore={item.sessionStore}
            value={`notif:session:${item.sessionStore.data.id}`}
            onSelect={() => {
              navigate('session', {
                projectId: item.projectId,
                sessionId: item.sessionStore.data.id,
              });
              onClose();
            }}
          />
        );
      })}
    </Command.Group>
  );
}
