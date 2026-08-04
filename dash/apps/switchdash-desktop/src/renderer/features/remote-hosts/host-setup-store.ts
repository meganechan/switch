/**
 * Every host's readiness, app-wide (CHOO-1809).
 *
 * Readiness used to live only in the host page's react-query cache, so nothing
 * else could see it: uninstalling git from a host made that page honest and
 * changed nothing anywhere else — the sidebar said nothing and agents could
 * still be created there.
 *
 * This puts it on the same footing as reachability: one store, hydrated once,
 * kept current by the pushed plan events, readable from any component. Pair it
 * with `hostReachabilityStore` through `deriveHostStatus` — never read one
 * without the other, or an unreachable host reads as "missing dependencies".
 */

import { makeAutoObservable, runInAction } from 'mobx';
import { events, rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { hostSetupPlanEventChannel, type HostSetupPlan } from '@shared/core/remote-hosts/setup';

class HostSetupStore {
  private plans = new Map<string, HostSetupPlan>();
  private hydrated = false;
  private hydrating: Promise<void> | null = null;

  constructor() {
    makeAutoObservable<this, 'plans' | 'hydrating'>(this, {
      plans: true,
      hydrating: false,
    });

    events.on(hostSetupPlanEventChannel, (plan) => {
      runInAction(() => {
        this.plans.set(plan.sshHost, plan);
      });
    });
  }

  /** Load once. Idempotent and safe to call from every component that needs it. */
  hydrate(): Promise<void> {
    if (this.hydrated) return Promise.resolve();
    this.hydrating ??= rpc.remoteHosts
      .listSetupPlans()
      .then((plans) => {
        runInAction(() => {
          for (const plan of plans) this.plans.set(plan.sshHost, plan);
          this.hydrated = true;
        });
      })
      .catch((error: unknown) => {
        // Leave `hydrated` false so a later caller retries rather than the app
        // quietly treating "we failed to load" as "no host needs anything".
        log.error('Could not load remote host setup plans', { error });
      })
      .finally(() => {
        this.hydrating = null;
      });
    return this.hydrating;
  }

  /** Null when the host has no persisted plan — which is not the same as ready. */
  get(sshHost: string | null): HostSetupPlan | null {
    if (!sshHost) return null;
    return this.plans.get(sshHost) ?? null;
  }
}

export const hostSetupStore = new HostSetupStore();
