import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Result } from '@switchdash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalProject } from './create-local-project';

const { GatewayErrorStub, mocks } = vi.hoisted(() => {
  class GatewayErrorStub extends Error {
    constructor(
      readonly kind: 'unauthorized' | 'http' | 'network',
      message: string
    ) {
      super(message);
      this.name = 'GatewayError';
    }
  }
  return {
    GatewayErrorStub,
    mocks: {
      openProjectMock: vi.fn(),
      getProjectMock: vi.fn(),
      insertMock: vi.fn(),
      valuesMock: vi.fn(),
      returningMock: vi.fn(),
      detectSwitchAgentMock: vi.fn(),
      createAgentMock: vi.fn(),
      getServerMock: vi.fn(),
      agentExistsOnServerMock: vi.fn(),
      reconcileAutoSessionMock: vi.fn(),
    },
  };
});

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: {
    openProject: mocks.openProjectMock,
    getProject: mocks.getProjectMock,
  },
}));

vi.mock('@main/db/client', () => ({
  db: {
    insert: mocks.insertMock,
  },
}));

vi.mock('@main/core/agents/detect', () => ({
  detectSwitchAgent: mocks.detectSwitchAgentMock,
}));

vi.mock('@main/core/agents/createAgent', () => ({
  createAgent: mocks.createAgentMock,
}));

vi.mock('@main/core/agents/setAgentAutoSession', () => ({
  reconcileAgentAutoSessionFromGateway: mocks.reconcileAutoSessionMock,
}));

vi.mock('@main/core/switch-servers/servers-store', () => ({
  getServer: mocks.getServerMock,
}));

vi.mock('@main/core/switch-servers/gateway-client', () => ({
  agentExistsOnServer: mocks.agentExistsOnServerMock,
  GatewayError: GatewayErrorStub,
}));

function expectOk<T, E>(result: Result<T, E>): T {
  expect(result.success).toBe(true);
  if (!result.success) throw new Error(`Expected success, got ${JSON.stringify(result.error)}`);
  return result.data;
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.insertMock.mockReturnValue({ values: mocks.valuesMock });
  mocks.valuesMock.mockReturnValue({ returning: mocks.returningMock });
  mocks.openProjectMock.mockResolvedValue(undefined);
  mocks.getProjectMock.mockReturnValue(undefined);
  mocks.createAgentMock.mockResolvedValue({ id: 'agent-1' });
  mocks.reconcileAutoSessionMock.mockResolvedValue(true);
  // Default: the chosen server exists and owns the agent (signed in).
  mocks.getServerMock.mockResolvedValue({
    id: 'server-1',
    name: 'Pilot',
    gatewayUrl: 'https://switch-gateway.example.com',
    apiUrl: 'https://switch-api.example.com',
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
  });
  mocks.agentExistsOnServerMock.mockResolvedValue(true);
});

describe('createLocalProject', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('onboards a directory configured as a Switch agent', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'switchdash-project-'));
    tempDirs.push(projectPath);
    mocks.detectSwitchAgentMock.mockResolvedValue({
      agentId: 'switch-agent-1',
      apiEndpoint: 'https://switch.example.com',
      dir: projectPath,
    });
    const row = {
      id: 'project-id',
      name: 'Project',
      path: projectPath,
      createdAt: '2026-04-16T00:00:00.000Z',
      updatedAt: '2026-04-16T00:00:00.000Z',
    };
    mocks.returningMock.mockResolvedValue([row]);

    const created = expectOk(
      await createLocalProject({
        id: 'project-id',
        name: 'Project',
        path: projectPath,
        serverId: 'server-1',
        providerId: 'claude',
      })
    );

    expect(mocks.valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'project-id', name: 'Project', path: projectPath })
    );
    expect(created).toMatchObject({
      id: 'project-id',
      name: 'Project',
      path: projectPath,
      type: 'local',
    });
    expect(mocks.createAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-id',
        providerId: 'claude',
        switchAgentId: 'switch-agent-1',
        apiEndpoint: 'https://switch.example.com',
        serverId: 'server-1',
      })
    );
    expect(mocks.openProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'project-id', type: 'local' })
    );
    // The new agent's auto_session state is reconciled from the gateway so a
    // fresh agent registered with auto_session on starts watching immediately
    // (CHOO-1185), without the operator toggling it off→on.
    expect(mocks.reconcileAutoSessionMock).toHaveBeenCalledWith('agent-1');
  });

  it('does not fail project creation when auto_session reconcile fails', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'switchdash-project-'));
    tempDirs.push(projectPath);
    mocks.detectSwitchAgentMock.mockResolvedValue({
      agentId: 'switch-agent-1',
      apiEndpoint: 'https://switch.example.com',
      dir: projectPath,
    });
    mocks.returningMock.mockResolvedValue([
      {
        id: 'project-id',
        name: 'Project',
        path: projectPath,
        createdAt: '2026-04-16T00:00:00.000Z',
        updatedAt: '2026-04-16T00:00:00.000Z',
      },
    ]);
    mocks.reconcileAutoSessionMock.mockRejectedValue(new Error('gateway unreachable'));

    const created = expectOk(
      await createLocalProject({
        id: 'project-id',
        name: 'Project',
        path: projectPath,
        serverId: 'server-1',
        providerId: 'claude',
      })
    );

    expect(created).toMatchObject({ id: 'project-id', type: 'local' });
    expect(mocks.openProjectMock).toHaveBeenCalled();
  });

  it('rejects when the chosen server does not have the agent', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'switchdash-project-'));
    tempDirs.push(projectPath);
    mocks.detectSwitchAgentMock.mockResolvedValue({
      agentId: 'switch-agent-1',
      apiEndpoint: 'https://switch.example.com',
      dir: projectPath,
    });
    mocks.agentExistsOnServerMock.mockResolvedValue(false);

    const result = await createLocalProject({
      id: 'project-id',
      name: 'Project',
      path: projectPath,
      serverId: 'server-1',
      providerId: 'claude',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('switch-agent-not-on-server');
    }
    expect(mocks.insertMock).not.toHaveBeenCalled();
    expect(mocks.createAgentMock).not.toHaveBeenCalled();
  });

  it('rejects when not signed in to the chosen server', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'switchdash-project-'));
    tempDirs.push(projectPath);
    mocks.detectSwitchAgentMock.mockResolvedValue({
      agentId: 'switch-agent-1',
      apiEndpoint: 'https://switch.example.com',
      dir: projectPath,
    });
    mocks.agentExistsOnServerMock.mockRejectedValue(
      new GatewayErrorStub('unauthorized', 'Not signed in.')
    );

    const result = await createLocalProject({
      id: 'project-id',
      name: 'Project',
      path: projectPath,
      serverId: 'server-1',
      providerId: 'claude',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('switch-server-unauthenticated');
    }
    expect(mocks.insertMock).not.toHaveBeenCalled();
    expect(mocks.createAgentMock).not.toHaveBeenCalled();
  });

  it('rejects a directory that is not configured as a Switch agent', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'switchdash-project-'));
    tempDirs.push(projectPath);
    mocks.detectSwitchAgentMock.mockResolvedValue(null);

    const result = await createLocalProject({
      id: 'project-id',
      name: 'Project',
      path: projectPath,
      serverId: 'server-1',
      providerId: 'claude',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('invalid-directory');
    }
    expect(mocks.insertMock).not.toHaveBeenCalled();
    expect(mocks.createAgentMock).not.toHaveBeenCalled();
  });

  it('rejects a path that is not a valid directory', async () => {
    const missingPath = path.join(os.tmpdir(), 'switchdash-project-does-not-exist-xyz');

    const result = await createLocalProject({
      id: 'project-id',
      name: 'Project',
      path: missingPath,
      serverId: 'server-1',
      providerId: 'claude',
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'invalid-directory',
        path: missingPath,
        message: 'Invalid directory',
      },
    });
    expect(mocks.insertMock).not.toHaveBeenCalled();
  });
});
