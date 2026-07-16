import { Pin } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import { useSessionViewContext } from '@renderer/features/sessions/session-view-context';
import {
  getRegisteredSessionData,
  getSessionStore,
  sessionDisplayName,
} from '@renderer/features/sessions/stores/session-selectors';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { cn } from '@renderer/utils/utils';

// switchdash titlebar: agent / session breadcrumb plus a pin toggle. The switchdash
// git, issue, diff, preview, terminal-drawer and sidebar chrome is gone.
export const SessionTitlebar = observer(function SessionTitlebar() {
  const { projectId, sessionId } = useSessionViewContext();
  const sessionStore = getSessionStore(projectId, sessionId);
  const sessionPayload = getRegisteredSessionData(projectId, sessionId);
  const projectName = projectDisplayName(getProjectStore(projectId));
  const { navigate } = useNavigate();

  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center gap-1 px-2 text-sm text-foreground-muted">
          <button
            type="button"
            className="text-sm text-foreground-passive hover:text-foreground"
            onClick={() => navigate('project', { projectId })}
          >
            {projectName}
          </button>
          <span className="text-sm text-foreground-passive">/</span>
          <span className="max-w-56 truncate">{sessionDisplayName(sessionStore)}</span>
          {sessionStore && sessionPayload && (
            <button
              type="button"
              className={cn(
                'ml-1 text-foreground-muted',
                sessionPayload.isPinned && 'text-muted-foreground'
              )}
              onClick={() => sessionStore.setPinned(!sessionPayload.isPinned)}
            >
              <Pin
                className={cn('size-3.5', sessionPayload.isPinned && 'text-foreground-muted')}
                fill={sessionPayload.isPinned ? 'currentColor' : 'none'}
              />
            </button>
          )}
        </div>
      }
    />
  );
});
