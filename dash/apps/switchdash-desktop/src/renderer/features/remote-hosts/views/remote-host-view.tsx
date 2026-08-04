/**
 * A single remote host's page (CHOO-1809).
 *
 * A host is not a settings row — it has an ongoing lifecycle: reach it, work
 * out what it needs, install those things one at a time, and later manage the
 * agent types running on it. It gets its own route so that lifecycle has
 * somewhere to live and somewhere to grow.
 *
 * Presented as a catalogue of what is on the host rather than a checklist of
 * steps: prerequisites and agent types, each a row with its status, each
 * opening a sheet with the detail and the actions. The same language the
 * agents settings page uses, so a host reads like the rest of the product.
 *
 * The page does no probing of its own on open. Reachability comes from the
 * central model (CHOO-1682/1780) and the setup plan is pushed from the main
 * process, so opening this page costs nothing and cannot disagree with the
 * rest of the app.
 */

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Play, RefreshCw, RotateCcw, Server } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useState } from 'react';
import type { GuardResult, ViewDefinition } from '@renderer/app/view-registry';
import { PageHeader } from '@renderer/lib/components/page-header';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { Spinner } from '@renderer/lib/ui/spinner';
import { StatusBadge } from '@renderer/lib/ui/status-badge';
import { deriveHostStatus } from '@shared/core/remote-hosts/host-status';
import { isHostBlocked } from '@shared/core/remote-hosts/reachability';
import { GhAuthPanel } from '../gh-auth-panel';
import { hostReachabilityStore } from '../host-reachability-store';
import { HostUnreachablePanel } from '../host-unreachable-panel';
import { SetupDetailSheet, type SheetTarget } from '../setup/setup-detail-sheet';
import {
  AgentTypeRowItem,
  PrerequisiteIcon,
  PrerequisiteRow,
  SectionLabel,
} from '../setup/setup-rows';
import { groupPlanSteps } from '../setup/step-presentation';
import {
  useHostSetupPlan,
  useInstallSetupStep,
  usePrepareSetup,
  useRecheckSetup,
  useRunSetup,
  useSkipSetupStep,
} from '../setup/use-host-setup';
import { REMOTE_HOSTS_QUERY_KEY } from './remote-hosts-view';

function useSshHost(): string {
  return useParams('remoteHost').params.sshHost;
}

export const RemoteHostMainPanel = observer(function RemoteHostMainPanel() {
  const sshHost = useSshHost();
  const { navigate } = useNavigate();

  const hosts = useQuery({
    queryKey: REMOTE_HOSTS_QUERY_KEY,
    queryFn: () => rpc.remoteHosts.listHosts(),
  });
  const host = hosts.data?.find((candidate) => candidate.sshHost === sshHost);

  const plan = useHostSetupPlan(sshHost);
  const prepare = usePrepareSetup(sshHost);
  const recheck = useRecheckSetup(sshHost);
  const run = useRunSetup(sshHost);
  const skip = useSkipSetupStep(sshHost);
  const installStep = useInstallSetupStep(sshHost);

  const [authenticatingGh, setAuthenticatingGh] = useState(false);
  const [sheetTarget, setSheetTarget] = useState<SheetTarget | null>(null);
  const reachability = hostReachabilityStore.get(sshHost);
  const blocked = isHostBlocked(reachability);

  useEffect(() => {
    void hostReachabilityStore.hydrate();
  }, []);

  // Build the plan once the host is known to be reachable. Deliberately not on
  // mount: probing a host the model already knows is down would only mislabel
  // every prerequisite as missing.
  const { mutate: startPrepare } = prepare;
  const hasPlan = plan.data != null;
  useEffect(() => {
    if (blocked || plan.isLoading || hasPlan) return;
    startPrepare();
  }, [blocked, plan.isLoading, hasPlan, startPrepare]);

  const status = deriveHostStatus(reachability, plan.data ?? null);
  const { prerequisites, agentTypes } = useMemo(
    () => groupPlanSteps(plan.data ?? null),
    [plan.data]
  );
  const busy = run.isPending || prepare.isPending || recheck.isPending || installStep.isPending;
  const installingStepId = installStep.isPending ? (installStep.variables ?? null) : null;
  const currentStepId = plan.data?.currentStepId ?? null;

  // Keep an open sheet in step with pushed plan updates, so a row's detail
  // advances while a run is in flight instead of freezing at the state it had
  // when it was opened.
  const liveTarget = useMemo((): SheetTarget | null => {
    if (!sheetTarget) return null;
    if (sheetTarget.kind === 'prerequisite') {
      const step = prerequisites.find((s) => s.id === sheetTarget.step.id);
      return step ? { kind: 'prerequisite', step } : null;
    }
    const row = agentTypes.find((r) => r.agentId === sheetTarget.row.agentId);
    return row ? { kind: 'agent-type', row } : null;
  }, [sheetTarget, prerequisites, agentTypes]);

  return (
    <div className="space-y-6 px-8 pb-10">
      <PageHeader
        sticky
        title={host?.name ?? sshHost}
        description={`Remote host · ${sshHost}. Auth uses your SSH agent — switchdash stores no credentials.`}
      >
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => navigate('remoteHosts')}>
            <ArrowLeft className="size-4" /> All hosts
          </Button>
          {!blocked && (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => recheck.mutate()}
                aria-label="Re-check this host"
              >
                <RefreshCw className={`size-3.5 ${recheck.isPending ? 'animate-spin' : ''}`} />
                Re-check
              </Button>
              {status.kind !== 'ready' && (
                <Button size="sm" disabled={busy} onClick={() => run.mutate()}>
                  {plan.data?.status === 'halted' ? (
                    <>
                      <RotateCcw className="size-3.5" /> {run.isPending ? 'Resuming…' : 'Resume'}
                    </>
                  ) : (
                    <>
                      <Play className="size-3.5" /> {run.isPending ? 'Running…' : 'Run setup'}
                    </>
                  )}
                </Button>
              )}
            </>
          )}
        </div>
      </PageHeader>

      {blocked ? (
        <HostUnreachablePanel reachability={reachability} />
      ) : (
        <>
          <section className="flex items-center gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-background-quaternary-1 p-1.5">
              <Server className="size-6 text-foreground-muted" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-lg text-foreground">{host?.name ?? sshHost}</span>
                <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              </div>
              <span className="text-xs text-foreground-muted">
                {status.readinessKnown && status.total > 0
                  ? `${status.done} of ${status.total} required · ${sshHost}`
                  : sshHost}
              </span>
            </div>
          </section>

          {/*
            A run that stops because the host went away is reported as exactly
            that, rather than being attributed to whichever step was next.
          */}
          {run.isError && (
            <p className="text-destructive text-xs">{(run.error as Error).message}</p>
          )}
          {installStep.isError && (
            <p className="text-destructive text-xs">
              Could not install: {(installStep.error as Error).message}
            </p>
          )}
          {recheck.isError && (
            <p className="text-destructive text-xs">
              Could not check this host: {(recheck.error as Error).message}
            </p>
          )}
          {prepare.isError && (
            <p className="text-destructive text-xs">
              Could not work out what this host needs: {(prepare.error as Error).message}
            </p>
          )}

          {plan.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-foreground-muted">
              <Spinner /> Loading…
            </div>
          ) : prerequisites.length === 0 && agentTypes.length === 0 ? (
            <p className="text-sm text-foreground-muted">
              Nothing known about this host yet. Re-check to see what it has.
            </p>
          ) : (
            <div className="flex flex-col">
              {prerequisites.length > 0 && (
                <section>
                  <SectionLabel count={prerequisites.length}>Prerequisites</SectionLabel>
                  {prerequisites.map((step) => (
                    <div key={step.id} className="w-full py-0.5">
                      <PrerequisiteRow
                        step={step}
                        isCurrent={step.id === currentStepId}
                        installing={installingStepId === step.id}
                        onInstall={() => installStep.mutate(step.id)}
                        onOpen={() => setSheetTarget({ kind: 'prerequisite', step })}
                      />
                    </div>
                  ))}
                </section>
              )}

              {agentTypes.length > 0 && (
                <section className="pt-2">
                  <SectionLabel count={agentTypes.length}>Agent types</SectionLabel>
                  {agentTypes.map((row) => (
                    <div key={row.agentId} className="w-full py-0.5">
                      <AgentTypeRowItem
                        row={row}
                        isCurrent={row.cli.id === currentStepId || row.plugin?.id === currentStepId}
                        installingStepId={installingStepId}
                        onInstall={(stepId) => installStep.mutate(stepId)}
                        onOpen={() => setSheetTarget({ kind: 'agent-type', row })}
                      />
                    </div>
                  ))}
                </section>
              )}
            </div>
          )}

          {/*
            The GitHub device flow needs a real terminal the user types into, so
            it runs inline rather than in a dialog — switchdash disables terminal
            input while a dialog is open. Re-check on close so the step reflects
            what actually happened rather than assuming it worked.
          */}
          {authenticatingGh && (
            <GhAuthPanel
              sshHost={sshHost}
              onDone={() => {
                setAuthenticatingGh(false);
                recheck.mutate();
              }}
            />
          )}

          <SetupDetailSheet
            target={liveTarget}
            sshHost={sshHost}
            icon={
              liveTarget?.kind === 'prerequisite' ? (
                <PrerequisiteIcon step={liveTarget.step} size={24} />
              ) : null
            }
            onClose={() => setSheetTarget(null)}
            onInstall={(stepId) => installStep.mutate(stepId)}
            installingStepId={installingStepId}
            onSkip={(stepId) => skip.mutate(stepId)}
            skippingStepId={skip.isPending ? (skip.variables ?? null) : null}
            onAuthenticate={() => {
              setSheetTarget(null);
              setAuthenticatingGh(true);
            }}
          />
        </>
      )}
    </div>
  );
});

function RemoteHostTitlebar() {
  const sshHost = useSshHost();
  return <span className="text-sm text-foreground-muted">{sshHost}</span>;
}

export const remoteHostView = {
  WrapView: ({ children }: { children: React.ReactNode; sshHost: string }) => <>{children}</>,
  TitlebarSlot: RemoteHostTitlebar,
  MainPanel: RemoteHostMainPanel,
  canActivate: (params: unknown): GuardResult => {
    // Params can come from a snapshot written by an older build, so validate
    // rather than trust: a view with no host to show has nothing to render.
    const sshHost =
      typeof params === 'object' && params !== null
        ? (params as { sshHost?: unknown }).sshHost
        : undefined;
    if (typeof sshHost !== 'string' || sshHost.length === 0) {
      return { ok: false, redirect: 'remoteHosts' };
    }
    return { ok: true };
  },
} satisfies ViewDefinition<{ sshHost: string }>;
