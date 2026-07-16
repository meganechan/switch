import { observer } from 'mobx-react-lite';
import { createContext, useContext, type ReactNode } from 'react';
import { ProjectViewWrapper } from '@renderer/features/projects/components/project-view-wrapper';
import type { ConversationManagerStore } from '@renderer/features/sessions/conversations/conversation-manager';
import {
  getConversationsForSession,
  getSessionStore,
  getTerminalsForSession,
  getWorkspaceForSession,
  sessionViewKind,
  type SessionViewKind,
} from '@renderer/features/sessions/stores/session-selectors';
import type { WorkspaceStore } from '@renderer/features/sessions/stores/workspace';
import type { WorkspaceViewModel } from '@renderer/features/sessions/stores/workspace-view-model';
import type { TerminalManagerStore } from '@renderer/features/sessions/terminals/terminal-manager';

interface SessionViewContext {
  projectId: string;
  sessionId: string;
  /** The workspace ID for this session, or null when not yet registered. */
  workspaceId: string | null;
}

const SessionViewContext = createContext<SessionViewContext | null>(null);

export const SessionViewWrapper = observer(function SessionViewWrapper({
  children,
  projectId,
  sessionId,
}: {
  children: ReactNode;
  projectId: string;
  sessionId: string;
}) {
  const workspaceId = getSessionStore(projectId, sessionId)?.workspaceId ?? null;
  return (
    <ProjectViewWrapper projectId={projectId}>
      <SessionViewContext.Provider value={{ projectId, sessionId, workspaceId }}>
        {children}
      </SessionViewContext.Provider>
    </ProjectViewWrapper>
  );
});

export function useSessionViewContext(): SessionViewContext {
  const context = useContext(SessionViewContext);
  if (!context) {
    throw new Error('useSessionViewContext must be used within a SessionViewContextProvider');
  }
  return context;
}

export function useSessionViewKind(): SessionViewKind {
  const { projectId, sessionId } = useSessionViewContext();
  return sessionViewKind(getSessionStore(projectId, sessionId), projectId);
}

/** Returns the active WorkspaceStore. Throws if the session is not provisioned. */
export function useWorkspace(): WorkspaceStore {
  const { projectId, sessionId } = useSessionViewContext();
  const workspace = getWorkspaceForSession(projectId, sessionId);
  if (!workspace) {
    throw new Error('useWorkspace: session is not provisioned (no workspace)');
  }
  return workspace;
}

/** Returns the workspace ID. Throws if the session has no workspace yet. */
export function useWorkspaceId(): string {
  const { workspaceId } = useSessionViewContext();
  if (!workspaceId) throw new Error('useWorkspaceId: session has no workspace');
  return workspaceId;
}

/** Returns the WorkspaceViewModel. Throws if the session is not registered. */
export function useWorkspaceViewModel(): WorkspaceViewModel {
  const { projectId, sessionId } = useSessionViewContext();
  const viewModel = getSessionStore(projectId, sessionId)?.viewModel;
  if (!viewModel) {
    throw new Error('useWorkspaceViewModel: session is not registered (no view model)');
  }
  return viewModel;
}

/** Returns the ConversationManagerStore for the session. Throws if not registered. */
export function useConversations(): ConversationManagerStore {
  const { sessionId } = useSessionViewContext();
  const mgr = getConversationsForSession(sessionId);
  if (!mgr) {
    throw new Error('useConversations: session is not registered (no conversation manager)');
  }
  return mgr;
}

/** Returns the TerminalManagerStore for the session. Throws if not registered. */
export function useTerminals(): TerminalManagerStore {
  const { sessionId } = useSessionViewContext();
  const mgr = getTerminalsForSession(sessionId);
  if (!mgr) {
    throw new Error('useTerminals: session is not registered (no terminal manager)');
  }
  return mgr;
}
