/**
 * Wires the setup runner to a real remote host (CHOO-1809).
 *
 * The runner is deliberately ignorant of SSH, dependency managers and plugin
 * registries — it only knows how to sequence steps. This module supplies the
 * `check` and `install` implementations for each step kind, and owns the
 * per-host lifecycle (build, resume, run, skip, discard).
 */

import type { HostDependencyManager } from '@switchdash/core/deps/runtime';
import { CORE_DEPENDENCIES } from '@main/core/dependencies/core-dependencies';
import {
  getRemoteDependencyManager,
  remoteDependencyDescriptor,
} from '@main/core/dependencies/remote-dependency-manager';
import { getRemoteSwitchSetupService } from '@main/core/switch-setup/remote-switch-setup';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import {
  hostSetupPlanEventChannel,
  type HostSetupPlan,
  type HostSetupStep,
} from '@shared/core/remote-hosts/setup';
import { probeGhAuthStatus } from '../gh-auth';
import { hostReachabilityService } from '../production-host-reachability';
import { HostSetupRunner, type StepCheckResult, type StepInstallResult } from './host-setup-runner';
import {
  agentPluginStepId,
  buildSetupPlan,
  GH_AUTH_STEP_ID,
  reconcileInterruptedPlan,
} from './plan-builder';
import { deleteSetupPlan, getSetupPlan, listSetupPlans, saveSetupPlan } from './setup-plan-store';
import { outcomeForDependency, outcomeForGhAuth } from './step-outcomes';

/** Runners are per-host so two hosts can be set up at once, but a host only once. */
const runners = new Map<string, HostSetupRunner>();

async function plannableAgentTypes(sshHost: string) {
  const service = await getRemoteSwitchSetupService(sshHost);
  const statuses = await service.listAgentTypeStatuses();
  return statuses
    .filter((status) => status.supported)
    .map((status) => ({
      agentId: status.agentId,
      name: remoteDependencyDescriptor(status.agentId)?.name ?? status.agentId,
    }));
}

/**
 * Build or refresh a host's plan. Rebuilding merges onto whatever was
 * persisted, so progress is preserved when the known dependency set changes,
 * and any step interrupted by the app closing is reset to pending rather than
 * left claiming a state nobody verified.
 */
export async function ensureSetupPlan(sshHost: string): Promise<HostSetupPlan> {
  const existing = await getSetupPlan(sshHost);
  const now = new Date().toISOString();

  const plan = buildSetupPlan({
    sshHost,
    coreDependencies: CORE_DEPENDENCIES.map((dep) => ({ id: dep.id, name: dep.name })),
    agentTypes: await plannableAgentTypes(sshHost),
    existing: existing ? reconcileInterruptedPlan(existing, now) : null,
    now,
  });

  await saveSetupPlan(plan);
  events.emit(hostSetupPlanEventChannel, plan);
  return plan;
}

/**
 * Every host's persisted plan. Feeds the renderer store that the sidebar and
 * the agent-creation gate read — both need readiness for hosts whose page
 * nobody has opened.
 */
export async function readAllSetupPlans(): Promise<HostSetupPlan[]> {
  return await listSetupPlans();
}

/** The persisted plan, without rebuilding it. Null when the host has never run setup. */
export async function readSetupPlan(sshHost: string): Promise<HostSetupPlan | null> {
  return await getSetupPlan(sshHost);
}

function stepAgentId(step: HostSetupStep): string {
  return step.kind === 'agent-plugin' ? step.id.replace(/:plugin$/, '') : step.id;
}

function runnerFor(sshHost: string, manager: HostDependencyManager): HostSetupRunner {
  const existing = runners.get(sshHost);
  if (existing) return existing;

  const runner = new HostSetupRunner({
    sshHost,
    load: (host) => getSetupPlan(host),
    save: (plan) => saveSetupPlan(plan),
    publish: (plan) => events.emit(hostSetupPlanEventChannel, plan),
    requireReachable: (host) => hostReachabilityService.requireReachable(host),
    canInstall: (step) => {
      // The gh device flow is interactive by nature — it needs a terminal the
      // user types into, so it can never be part of an unattended run.
      if (step.kind === 'gh-auth') return false;
      if (step.kind === 'agent-plugin') return true;
      return manager.getInstallOptions(step.id).length > 0;
    },
    check: (step) => checkStep(sshHost, manager, step),
    install: (step) => installStep(sshHost, manager, step),
  });

  runners.set(sshHost, runner);
  return runner;
}

async function checkStep(
  sshHost: string,
  manager: HostDependencyManager,
  step: HostSetupStep
): Promise<StepCheckResult> {
  if (step.kind === 'gh-auth') {
    return outcomeForGhAuth(await probeGhAuthStatus(sshHost));
  }

  if (step.kind === 'agent-plugin') {
    const service = await getRemoteSwitchSetupService(sshHost);
    const statuses = await service.listAgentTypeStatuses();
    const agentId = stepAgentId(step);
    const status = statuses.find((s) => s.agentId === agentId);
    if (!status) {
      return {
        outcome: 'unknown',
        error: `${agentId} is no longer a known agent type on this host.`,
      };
    }
    return status.installed
      ? { outcome: 'satisfied', version: status.installedVersion ?? null }
      : { outcome: 'missing' };
  }

  const state = await manager.probe(step.id);
  return outcomeForDependency(state, Boolean(remoteDependencyDescriptor(step.id)?.minVersion));
}

async function installStep(
  sshHost: string,
  manager: HostDependencyManager,
  step: HostSetupStep
): Promise<StepInstallResult> {
  if (step.kind === 'agent-plugin') {
    const service = await getRemoteSwitchSetupService(sshHost);
    const result = await service.install(stepAgentId(step));
    return result.success
      ? { ok: true }
      : { ok: false, error: result.message ?? `Could not install the Switch connector.` };
  }

  const result = await manager.install(step.id);
  if (result.success) return { ok: true };

  // Surface the installer's own words. The old page discarded these and
  // rendered a bare "Install failed" — or, for a Result-typed failure, nothing.
  const error = result.error as { message?: string; output?: string; type?: string };
  return {
    ok: false,
    error: error.message ?? error.type ?? 'Install failed.',
    output: error.output ?? null,
  };
}

/** Run (or resume) a host's setup. Returns the plan as it stands when the run stops. */
export async function runSetup(sshHost: string): Promise<HostSetupPlan> {
  const plan = await ensureSetupPlan(sshHost);
  const manager = await getRemoteDependencyManager(sshHost);
  try {
    return await runnerFor(sshHost, manager).run(plan);
  } catch (error) {
    log.warn('[HostSetup] run stopped', {
      event: 'host-setup-run-stopped',
      sshHost,
      error: String((error as Error)?.message ?? error),
    });
    throw error;
  }
}

/**
 * Observe a host without changing it — the "Re-check" button.
 *
 * Rebuilds the plan first so newly-known dependencies are included, then probes
 * every step and installs nothing.
 */
export async function recheckSetup(sshHost: string): Promise<HostSetupPlan> {
  const plan = await ensureSetupPlan(sshHost);
  const manager = await getRemoteDependencyManager(sshHost);
  try {
    return await runnerFor(sshHost, manager).checkAll(plan);
  } catch (error) {
    log.warn('[HostSetup] re-check stopped', {
      event: 'host-setup-recheck-stopped',
      sshHost,
      error: String((error as Error)?.message ?? error),
    });
    throw error;
  }
}

/** Move past a step the user has chosen not to fix, unblocking the rest. */
export async function skipSetupStep(sshHost: string, stepId: string): Promise<HostSetupPlan> {
  const plan = await getSetupPlan(sshHost);
  if (!plan) throw new Error(`No setup plan exists for ${sshHost}`);
  const manager = await getRemoteDependencyManager(sshHost);
  return await runnerFor(sshHost, manager).skip(plan, stepId);
}

/** Drop a host's plan and its runner — called when the host is removed. */
export async function discardSetupPlan(sshHost: string): Promise<void> {
  runners.delete(sshHost);
  await deleteSetupPlan(sshHost);
}

export { agentPluginStepId, GH_AUTH_STEP_ID };
