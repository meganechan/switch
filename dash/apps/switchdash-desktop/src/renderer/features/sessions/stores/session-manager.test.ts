import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@shared/core/sessions/sessions';
import { SessionManagerStore } from './session-manager';
import { createUnprovisionedSession } from './session-store';

type MockViewModel = {
  initialize: ReturnType<typeof vi.fn>;
  suspend: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  restoreSnapshot: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  archiveSession: vi.fn(),
  conversationAcquire: vi.fn(),
  conversationRelease: vi.fn(),
  getConversationsForProject: vi.fn(),
  getProjectManagerStore: vi.fn(),
  getSessionGitWorktreeStore: vi.fn(),
  getSessions: vi.fn(),
  mountProject: vi.fn(),
  provisionWorkspace: vi.fn(),
  teardownSession: vi.fn(),
  terminalAcquire: vi.fn(),
  terminalRelease: vi.fn(),
  viewModels: [] as MockViewModel[],
  viewStateGet: vi.fn(),
  workspaceActivate: vi.fn(),
  workspaceAcquire: vi.fn(),
  workspaceRelease: vi.fn(),
  workspaceSetBootstrapState: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn(() => () => {}),
  },
  rpc: {
    agents: {
      getAgentById: vi.fn(),
    },
    sessions: {
      archiveSession: mocks.archiveSession,
      getConversationsForProject: mocks.getConversationsForProject,
      getSessions: mocks.getSessions,
      provisionWorkspace: mocks.provisionWorkspace,
      teardownSession: mocks.teardownSession,
    },
  },
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectManagerStore: mocks.getProjectManagerStore,
}));

vi.mock('@renderer/features/sessions/stores/session-selectors', () => ({
  getSessionGitWorktreeStore: mocks.getSessionGitWorktreeStore,
}));

vi.mock('@renderer/lib/stores/view-state-cache', () => ({
  viewStateCache: {
    get: mocks.viewStateGet,
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock('./workspace-view-model', () => ({
  WorkspaceViewModel: class {
    initialize = vi.fn();
    suspend = vi.fn();
    dispose = vi.fn();
    restoreSnapshot = vi.fn();

    constructor() {
      mocks.viewModels.push(this);
    }
  },
}));

vi.mock('./workspace-registry', () => ({
  workspaceRegistry: {
    activate: mocks.workspaceActivate,
    acquire: mocks.workspaceAcquire,
    release: mocks.workspaceRelease,
    setBootstrapState: mocks.workspaceSetBootstrapState,
  },
}));

vi.mock('./conversation-registry', () => ({
  conversationRegistry: {
    acquire: mocks.conversationAcquire,
    get: vi.fn(),
    release: mocks.conversationRelease,
  },
}));

vi.mock('./terminal-registry', () => ({
  terminalRegistry: {
    acquire: mocks.terminalAcquire,
    get: vi.fn(),
    release: mocks.terminalRelease,
  },
}));

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    agentId: 'agent-1',
    providerId: 'claude',
    title: 'Session 1',
    shellId: 'system',
    status: 'todo',
    agentSessionId: null,
    isInitialSession: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    statusChangedAt: '2026-01-01T00:00:00.000Z',
    isPinned: false,
    ...overrides,
  };
}

function makeSessionManager(): SessionManagerStore {
  return new SessionManagerStore('project-1', { pageData: { invalidate: vi.fn() } } as never);
}

describe('SessionManagerStore archive lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.viewModels.length = 0;
    mocks.archiveSession.mockResolvedValue(undefined);
    mocks.getConversationsForProject.mockResolvedValue([]);
    mocks.getProjectManagerStore.mockReturnValue({ mountProject: mocks.mountProject });
    mocks.getSessions.mockResolvedValue([]);
    mocks.mountProject.mockResolvedValue(undefined);
    mocks.provisionWorkspace.mockResolvedValue({
      success: true,
      data: {
        path: '/tmp/workspace-1',
        workspaceId: 'workspace-1',
      },
    });
    mocks.viewStateGet.mockResolvedValue(undefined);
  });

  it('archives by disposing frontend runtime instead of soft-tearing down the session', async () => {
    const manager = makeSessionManager();
    const session = makeSession();
    const store = createUnprovisionedSession('project-1', session);
    store.transitionToProvisioned(session, '/tmp/workspace-1', 'workspace-1');
    const viewModel = mocks.viewModels[0];
    manager.sessions.set(session.id, store);

    await manager.archiveSession(session.id);

    expect(mocks.archiveSession).toHaveBeenCalledWith('project-1', 'session-1');
    expect(mocks.teardownSession).not.toHaveBeenCalled();
    expect(mocks.conversationRelease).toHaveBeenCalledWith('session-1');
    expect(mocks.terminalRelease).toHaveBeenCalledWith('session-1');
    expect(viewModel.dispose).toHaveBeenCalledOnce();
    expect(store.state).toBe('unprovisioned');
    expect(store.phase).toBe('idle');
    expect(store.workspaceId).toBeNull();
    expect(store.viewModel).toBeNull();
    expect((store.data as Session).archivedAt).toBeDefined();

    manager.dispose();
  });

  it('reacquires frontend managers before provisioning a dry restored session', async () => {
    const manager = makeSessionManager();
    const session = makeSession({ archivedAt: undefined });
    const store = createUnprovisionedSession('project-1', session);
    store.transitionToDryUnprovisioned(session);
    manager.sessions.set(session.id, store);

    await manager.provisionSession(session.id);

    expect(mocks.conversationAcquire).toHaveBeenCalledWith('session-1', 'project-1');
    expect(mocks.terminalAcquire).toHaveBeenCalledWith('session-1', 'project-1');
    expect(store.state).toBe('provisioned');
    expect(store.viewModel).toBe(mocks.viewModels[1]);
    expect(mocks.viewModels[1].initialize).toHaveBeenCalledOnce();

    manager.dispose();
  });
});
