import { observer } from 'mobx-react-lite';
import { useEffect, type ReactNode } from 'react';
import { type GuardResult, type ViewDefinition } from '@renderer/app/view-registry';
import { SessionViewWrapper } from '@renderer/features/sessions/session-view-context';
import {
  getSessionManagerStore,
  getSessionStore,
  sessionViewKind,
} from '@renderer/features/sessions/stores/session-selectors';
import { appState } from '@renderer/lib/stores/app-state';
import { createSessionCommandProvider } from './commands';
import { SessionMainPanel } from './main-panel';
import { SessionTitlebar } from './session-titlebar';

const SessionViewWrapperWithProviders = observer(function SessionViewWrapperWithProviders({
  children,
  projectId,
  sessionId,
}: {
  children: ReactNode;
  projectId: string;
  sessionId: string;
}) {
  const sessionStore = getSessionStore(projectId, sessionId);
  const kind = sessionViewKind(sessionStore, projectId);

  // Auto-provision when the session view is rendered with an idle session — covers
  // session restore where the session wasn't in openSessionIds, direct navigation,
  // and any other path that lands on the session view before provisioning runs.
  useEffect(() => {
    if (kind !== 'idle') return;
    if (sessionStore && 'archivedAt' in sessionStore.data && sessionStore.data.archivedAt) return;

    getSessionManagerStore(projectId)
      ?.provisionSession(sessionId)
      .catch(() => {});
  }, [kind, projectId, sessionId, sessionStore]);

  if (kind !== 'ready') {
    return (
      <SessionViewWrapper projectId={projectId} sessionId={sessionId}>
        {children}
      </SessionViewWrapper>
    );
  }

  return (
    <SessionViewWrapper projectId={projectId} sessionId={sessionId}>
      {children}
    </SessionViewWrapper>
  );
});

export const sessionView = {
  WrapView: SessionViewWrapperWithProviders,
  TitlebarSlot: SessionTitlebar,
  MainPanel: SessionMainPanel,
  commandProvider: ({ projectId, sessionId }: { projectId: string; sessionId: string }) =>
    createSessionCommandProvider(projectId, sessionId),
  canActivate: (params: unknown): GuardResult => {
    const projectId =
      typeof params === 'object' && params !== null
        ? (params as { projectId?: unknown }).projectId
        : undefined;
    const sessionId =
      typeof params === 'object' && params !== null
        ? (params as { sessionId?: unknown }).sessionId
        : undefined;
    if (typeof projectId !== 'string' || typeof sessionId !== 'string') {
      return { ok: false, redirect: 'home' };
    }
    if (
      !appState.projects.projects.has(projectId) &&
      !appState.projects.pendingCreationIds.has(projectId)
    ) {
      return { ok: false, redirect: 'home' };
    }
    const sessionManager = getSessionManagerStore(projectId);
    if (sessionManager && !sessionManager.sessions.has(sessionId)) {
      return { ok: false, redirect: 'project', params: { projectId } };
    }
    return { ok: true };
  },
} satisfies ViewDefinition<{ projectId: string; sessionId: string }>;
