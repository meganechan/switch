import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  listAgentTypeStatuses: vi.fn(),
  probe: vi.fn(),
  remoteDependencyDescriptor: vi.fn(),
  probeGhAuthStatus: vi.fn(),
}));

vi.mock('@main/core/switch-setup/remote-switch-setup', () => ({
  getRemoteSwitchSetupService: () =>
    Promise.resolve({
      getStatus: mocks.getStatus,
      listAgentTypeStatuses: mocks.listAgentTypeStatuses,
    }),
}));

vi.mock('@main/core/dependencies/remote-dependency-manager', () => ({
  getRemoteDependencyManager: vi.fn(),
  remoteDependencyDescriptor: mocks.remoteDependencyDescriptor,
}));

vi.mock('../gh-auth', () => ({
  probeGhAuthStatus: mocks.probeGhAuthStatus,
  startGhAuth: vi.fn(),
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), child: () => ({ warn: vi.fn() }) },
}));

// The module under test reaches the plan store, the event bus and the
// reachability service at import time; all three land in Electron. None is
// involved in observing a single step.
vi.mock('./setup-plan-store', () => ({
  getSetupPlan: vi.fn(),
  saveSetupPlan: vi.fn(),
  listSetupPlans: vi.fn(),
  deleteSetupPlan: vi.fn(),
}));

vi.mock('@main/lib/events', () => ({ events: { emit: vi.fn() } }));

vi.mock('../production-host-reachability', () => ({
  hostReachabilityService: { requireReachable: vi.fn() },
}));

vi.mock('@main/core/dependencies/install-output', () => ({
  installOutput: { subscribe: vi.fn(() => () => {}) },
}));

import type { HostDependencyManager } from '@switchdash/core/deps/runtime';
import type { HostSetupStep } from '@shared/core/remote-hosts/setup';
import { checkStep } from './host-setup-service';

const SSH_HOST = 'dev-vm';

function step(patch: Partial<HostSetupStep>): HostSetupStep {
  return {
    id: 'claude:plugin',
    kind: 'agent-plugin',
    name: 'Claude Code · Switch connector',
    state: 'pending',
    outcome: null,
    version: null,
    error: null,
    output: null,
    optional: false,
    dependsOn: ['claude'],
    updatedAt: '2026-02-02T00:00:00.000Z',
    ...patch,
  };
}

const manager = { probe: mocks.probe } as unknown as HostDependencyManager;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.remoteDependencyDescriptor.mockReturnValue({ name: 'Claude Code' });
});

/**
 * Checking one row must touch one agent type.
 *
 * This branch used to ask for *every* agent type's status and then discard all
 * but the one it wanted. Each discarded status ran that type's CLI over SSH, so
 * re-checking the Claude Code connector shelled out to `codex` as well — which
 * on a host without Codex produced `command not found` failures attributed to
 * the row the user had not touched, and cost two extra round trips per type.
 */
describe('checking an agent-plugin step', () => {
  it('asks about its own agent type only', async () => {
    mocks.getStatus.mockResolvedValue({
      supported: true,
      installed: true,
      installedVersion: '1.0',
    });

    await checkStep(SSH_HOST, manager, step({}));

    expect(mocks.getStatus).toHaveBeenCalledExactlyOnceWith('claude');
  });

  it('never enumerates the other agent types', async () => {
    mocks.getStatus.mockResolvedValue({
      supported: true,
      installed: true,
      installedVersion: '1.0',
    });

    await checkStep(SSH_HOST, manager, step({}));

    expect(mocks.listAgentTypeStatuses).not.toHaveBeenCalled();
  });

  it('strips the plugin suffix to get the agent id', async () => {
    mocks.getStatus.mockResolvedValue({ supported: true, installed: false });

    await checkStep(SSH_HOST, manager, step({ id: 'codex:plugin' }));

    expect(mocks.getStatus).toHaveBeenCalledWith('codex');
  });

  it('reports an installed connector as satisfied, carrying its version', async () => {
    mocks.getStatus.mockResolvedValue({
      supported: true,
      installed: true,
      installedVersion: '0.7.7',
    });

    expect(await checkStep(SSH_HOST, manager, step({}))).toEqual({
      outcome: 'satisfied',
      version: '0.7.7',
    });
  });

  it('reports an absent connector as missing', async () => {
    mocks.getStatus.mockResolvedValue({ supported: true, installed: false });

    expect(await checkStep(SSH_HOST, manager, step({}))).toEqual({ outcome: 'missing' });
  });

  it('reports unknown — not missing — for a type switchdash cannot drive', async () => {
    // "We cannot answer this" is not "it is not installed".
    mocks.getStatus.mockResolvedValue({ supported: false, installed: false });

    const result = await checkStep(SSH_HOST, manager, step({}));

    expect(result.outcome).toBe('unknown');
    expect(result.error).toContain('no longer a known agent type');
  });
});

describe('checking a core-dependency step', () => {
  it('goes to the dependency manager, not the plugin CLIs', async () => {
    mocks.probe.mockResolvedValue({ id: 'git', status: 'installed', version: '2.43.0' });

    await checkStep(SSH_HOST, manager, step({ id: 'git', kind: 'core-dependency', name: 'Git' }));

    expect(mocks.probe).toHaveBeenCalledExactlyOnceWith('git');
    expect(mocks.getStatus).not.toHaveBeenCalled();
  });
});
