import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  checkForUpdates: vi.fn(),
  listAgentTypeStatuses: vi.fn(),
  probe: vi.fn(),
  remoteDependencyDescriptor: vi.fn(),
  probeGhAuthStatus: vi.fn(),
  getUpdateInfo: vi.fn(),
}));

vi.mock('@main/core/switch-setup/remote-switch-setup', () => ({
  getRemoteSwitchSetupService: () =>
    Promise.resolve({
      getStatus: mocks.getStatus,
      checkForUpdates: mocks.checkForUpdates,
      listAgentTypeStatuses: mocks.listAgentTypeStatuses,
    }),
}));

vi.mock('@main/core/dependencies/agent-update-service', () => ({
  agentUpdateService: { getUpdateInfo: mocks.getUpdateInfo },
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
import type { HostSetupPlan, HostSetupStep } from '@shared/core/remote-hosts/setup';
import { checkStep, readAllSetupPlans } from './host-setup-service';
import { listSetupPlans, saveSetupPlan } from './setup-plan-store';

const SSH_HOST = 'dev-vm';

function step(patch: Partial<HostSetupStep>): HostSetupStep {
  return {
    id: 'claude:plugin',
    kind: 'agent-plugin',
    name: 'Claude Code · Switch connector',
    state: 'pending',
    outcome: null,
    version: null,
    latestVersion: null,
    updateAvailable: false,
    error: null,
    output: null,
    optional: false,
    dependsOn: ['claude'],
    updatedAt: '2026-02-02T00:00:00.000Z',
    ...patch,
  };
}

const manager = { probe: mocks.probe } as unknown as HostDependencyManager;

/** A full connector status, the shape the service always returns. */
function status(patch: Record<string, unknown> = {}) {
  return {
    agentId: 'claude',
    supported: true,
    installed: true,
    installedVersion: '0.7.7',
    latestVersion: null,
    updateAvailable: false,
    refreshError: null,
    ...patch,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.remoteDependencyDescriptor.mockReturnValue({ name: 'Claude Code' });
  mocks.getUpdateInfo.mockReturnValue({ latestVersion: null, updateAvailable: false });
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
    mocks.checkForUpdates.mockResolvedValue(status());

    await checkStep(SSH_HOST, manager, step({}));

    expect(mocks.checkForUpdates).toHaveBeenCalledExactlyOnceWith('claude');
  });

  it('never enumerates the other agent types', async () => {
    mocks.checkForUpdates.mockResolvedValue(status());

    await checkStep(SSH_HOST, manager, step({}));

    expect(mocks.listAgentTypeStatuses).not.toHaveBeenCalled();
  });

  it('strips the plugin suffix to get the agent id', async () => {
    mocks.checkForUpdates.mockResolvedValue(status({ installed: false }));

    await checkStep(SSH_HOST, manager, step({ id: 'codex:plugin' }));

    expect(mocks.checkForUpdates).toHaveBeenCalledWith('codex');
  });

  it('reports an installed connector as satisfied, carrying its version', async () => {
    mocks.checkForUpdates.mockResolvedValue(status({ installedVersion: '0.7.7' }));

    expect(await checkStep(SSH_HOST, manager, step({}))).toEqual({
      outcome: 'satisfied',
      version: '0.7.7',
      latestVersion: null,
      updateAvailable: false,
    });
  });

  it('reports an absent connector as missing', async () => {
    mocks.checkForUpdates.mockResolvedValue(status({ installed: false }));

    expect(await checkStep(SSH_HOST, manager, step({}))).toEqual({ outcome: 'missing' });
  });

  it('reports unknown — not missing — for a type switchdash cannot drive', async () => {
    // "We cannot answer this" is not "it is not installed".
    mocks.checkForUpdates.mockResolvedValue(status({ supported: false, installed: false }));

    const result = await checkStep(SSH_HOST, manager, step({}));

    expect(result.outcome).toBe('unknown');
    expect(result.error).toContain('no longer a known agent type');
  });
});

/**
 * A check that cannot see an update is a check that will report a stale
 * connector as fine forever.
 */
describe('update detection', () => {
  it('refreshes the catalog rather than reading what the host last fetched', async () => {
    // `getStatus` reads the host's cached marketplace snapshot, which can be
    // arbitrarily old; only `checkForUpdates` refreshes it first. Reading the
    // cache would let a published update go unreported indefinitely.
    mocks.checkForUpdates.mockResolvedValue(status());

    await checkStep(SSH_HOST, manager, step({}));

    expect(mocks.getStatus).not.toHaveBeenCalled();
  });

  it('carries an available connector update through', async () => {
    mocks.checkForUpdates.mockResolvedValue(
      status({ installedVersion: '0.7.6', latestVersion: '0.7.7', updateAvailable: true })
    );

    expect(await checkStep(SSH_HOST, manager, step({}))).toMatchObject({
      outcome: 'satisfied',
      latestVersion: '0.7.7',
      updateAvailable: true,
    });
  });

  it('does not claim an update when the latest version is unknowable', async () => {
    // Null latest means "we could not tell", which is not "there is one" and
    // not "you are current" either.
    mocks.checkForUpdates.mockResolvedValue(status({ latestVersion: null }));

    expect(await checkStep(SSH_HOST, manager, step({}))).toMatchObject({
      latestVersion: null,
      updateAvailable: false,
    });
  });

  it('reports an agent CLI update from the shared coordinator', async () => {
    // Latest-version data is host-agnostic, so the same service that answers
    // for local agents answers here — no extra SSH to find it out.
    mocks.probe.mockResolvedValue({ id: 'claude', status: 'installed', version: '2.1.0' });
    mocks.getUpdateInfo.mockReturnValue({ latestVersion: '2.2.0', updateAvailable: true });

    const result = await checkStep(
      SSH_HOST,
      manager,
      step({ id: 'claude', kind: 'agent-cli', name: 'Claude Code' })
    );

    expect(mocks.getUpdateInfo).toHaveBeenCalledWith('claude', '2.1.0');
    expect(result).toMatchObject({ latestVersion: '2.2.0', updateAvailable: true });
  });
});

describe('checking a core-dependency step', () => {
  it('goes to the dependency manager, not the plugin CLIs', async () => {
    mocks.probe.mockResolvedValue({ id: 'git', status: 'installed', version: '2.43.0' });

    await checkStep(SSH_HOST, manager, step({ id: 'git', kind: 'core-dependency', name: 'Git' }));

    expect(mocks.probe).toHaveBeenCalledExactlyOnceWith('git');
    expect(mocks.checkForUpdates).not.toHaveBeenCalled();
  });
});

/**
 * A persisted plan is a record of progress, not a fixed roster (CHOO-1809).
 *
 * Reported from a real host: Codex was absent from one host's page and present
 * on another. The plan had been built before Codex shipped, and nothing ever
 * rebuilt it — the page only built a plan when none existed at all. Worse than
 * the missing row: a *missing* step reads as no objection, so the readiness
 * verdict called that host fine for an agent type it had never looked for.
 */
describe('readAllSetupPlans', () => {
  function persisted(steps: HostSetupStep[]): HostSetupPlan {
    return {
      sshHost: 'dev-vm',
      status: 'idle',
      steps,
      currentStepId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  const claudeCli = step({
    id: 'claude',
    kind: 'agent-cli',
    name: 'Claude Code',
    state: 'satisfied',
    outcome: 'satisfied',
    version: '2.1.221',
    dependsOn: ['node'],
  });

  it('adds a step for an agent type that shipped after the plan was built', async () => {
    vi.mocked(listSetupPlans).mockResolvedValue([persisted([claudeCli])]);

    const [plan] = await readAllSetupPlans();

    expect(plan!.steps.some((s) => s.id === 'codex')).toBe(true);
  });

  it('keeps what was already known about the steps that survive', async () => {
    vi.mocked(listSetupPlans).mockResolvedValue([persisted([claudeCli])]);

    const [plan] = await readAllSetupPlans();
    const claude = plan!.steps.find((s) => s.id === 'claude');

    expect(claude).toMatchObject({ state: 'satisfied', version: '2.1.221' });
  });

  it('persists the new shape, so the next read is not a rebuild again', async () => {
    vi.mocked(listSetupPlans).mockResolvedValue([persisted([claudeCli])]);

    await readAllSetupPlans();

    expect(saveSetupPlan).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the step set is already current', async () => {
    // The common case. Rebuilding costs no SSH, but it must not turn every read
    // into a write and a push to the renderer.
    vi.mocked(listSetupPlans).mockResolvedValue([persisted([claudeCli])]);
    const [rebuilt] = await readAllSetupPlans();
    vi.mocked(saveSetupPlan).mockClear();
    vi.mocked(listSetupPlans).mockResolvedValue([rebuilt!]);

    await readAllSetupPlans();

    expect(saveSetupPlan).not.toHaveBeenCalled();
  });
});
