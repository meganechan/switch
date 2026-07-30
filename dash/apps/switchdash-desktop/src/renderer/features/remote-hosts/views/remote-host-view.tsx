/**
 * A single remote host's page (CHOO-1809).
 *
 * A host is not a settings row — it has an ongoing lifecycle: reach it, work
 * out what it needs, install those things one at a time, and later manage the
 * agent types running on it. It gets its own route so that lifecycle has
 * somewhere to live and somewhere to grow.
 *
 * The page does no probing of its own. Reachability comes from the central
 * model (CHOO-1682/1780) and the setup plan is pushed from the main process, so
 * opening this page costs nothing and cannot disagree with the rest of the app.
 */

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Play, RefreshCw, RotateCcw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import type { GuardResult, ViewDefinition } from '@renderer/app/view-registry';
import { PageHeader } from '@renderer/lib/components/page-header';
import { rpc } from '@renderer/lib/ipc';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { Spinner } from '@renderer/lib/ui/spinner';
import { isHostBlocked } from '@shared/core/remote-hosts/reachability';
import { isPlanComplete } from '@shared/core/remote-hosts/setup';
import { GhAuthPanel } from '../gh-auth-panel';
import { hostReachabilityStore } from '../host-reachability-store';
import { HostUnreachablePanel } from '../host-unreachable-panel';
import { SetupStepList } from '../setup/setup-steps';
import { summarisePlan } from '../setup/step-presentation';
import {
  useHostSetupPlan,
  usePrepareSetup,
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
  const run = useRunSetup(sshHost);
  const skip = useSkipSetupStep(sshHost);

  const [authenticatingGh, setAuthenticatingGh] = useState(false);
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

  const summary = summarisePlan(plan.data ?? null);
  const busy = run.isPending || prepare.isPending;
  const complete = plan.data ? isPlanComplete(plan.data) : false;

  return (
    <div className="space-y-8 px-8 pb-10">
      <PageHeader
        sticky
        title={host?.name ?? sshHost}
        description={`Remote host · ${sshHost}. Auth uses your SSH agent — switchdash stores no credentials.`}
      >
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => navigate('remoteHosts')}>
            <ArrowLeft className="size-4" /> All hosts
          </Button>
        </div>
      </PageHeader>

      {blocked ? (
        <HostUnreachablePanel reachability={reachability} />
      ) : (
        <section className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">Setup</h3>
              <p className="text-xs text-foreground-muted">
                {summary.total > 0
                  ? `${summary.done} of ${summary.total} required steps done · ${summary.headline}`
                  : summary.headline}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => prepare.mutate()}
                aria-label="Re-check this host"
              >
                <RefreshCw className={`size-3.5 ${prepare.isPending ? 'animate-spin' : ''}`} />
                Re-check
              </Button>
              {!complete && (
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
            </div>
          </div>

          {/*
            A run that stops because the host went away is reported as exactly
            that, rather than being attributed to whichever step was next.
          */}
          {run.isError && (
            <p className="text-destructive text-xs">{(run.error as Error).message}</p>
          )}
          {prepare.isError && (
            <p className="text-destructive text-xs">
              Could not work out what this host needs: {(prepare.error as Error).message}
            </p>
          )}

          {plan.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-foreground-muted">
              <Spinner /> Loading setup…
            </div>
          ) : (
            <SetupStepList
              steps={plan.data?.steps ?? []}
              currentStepId={plan.data?.currentStepId ?? null}
              onSkip={(stepId) => skip.mutate(stepId)}
              skippingStepId={skip.isPending ? (skip.variables ?? null) : null}
              onAuthenticate={() => setAuthenticatingGh(true)}
            />
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
                prepare.mutate();
              }}
            />
          )}

          {complete && <p className="text-xs text-green-500">This host is ready to run agents.</p>}
        </section>
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
