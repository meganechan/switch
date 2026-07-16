import { makeAutoObservable, runInAction } from 'mobx';
import { rpc } from '@renderer/lib/ipc';
import type { Agent } from '@shared/core/agents/agents';

/**
 * Renderer cache of every agent across all projects, used to resolve which
 * Switch server a project belongs to. The sidebar scopes its tree to the active
 * server (see {@link switchServersStore.activeServerId}), so it needs a reactive
 * project→serverId lookup that does not depend on each row's own react-query.
 *
 * A project holds one parent agent plus any subagents, which all share the same
 * server; {@link serverIdForProject} returns the first non-null serverId among a
 * project's agents.
 */
export class AgentsStore {
  /** All agents grouped by their project id. */
  readonly byProject = new Map<string, Agent[]>();
  /**
   * Server id a just-created project's agent will belong to, recorded by the
   * add-agent modal before {@link load} has re-fetched the new agent. Used as a
   * fallback in {@link serverIdForProject} so a freshly-created project does not
   * flicker out of the sidebar's server-scoped view during the gap between the
   * project mounting and the agent list refreshing.
   */
  readonly optimisticServerByProject = new Map<string, string>();
  loaded = false;

  constructor() {
    makeAutoObservable(this);
  }

  async load(): Promise<void> {
    const agents = await rpc.agents.getAgents();
    runInAction(() => {
      this.byProject.clear();
      for (const agent of agents) {
        const list = this.byProject.get(agent.projectId);
        if (list) list.push(agent);
        else this.byProject.set(agent.projectId, [agent]);
      }
      // Drop optimistic notes now superseded by a real agent record.
      for (const projectId of this.byProject.keys()) {
        this.optimisticServerByProject.delete(projectId);
      }
      this.loaded = true;
    });
  }

  /** Record the server a project's agent will bind to, ahead of {@link load}. */
  noteProjectServer(projectId: string, serverId: string): void {
    runInAction(() => {
      this.optimisticServerByProject.set(projectId, serverId);
    });
  }

  /** The Switch server a project's agents belong to, or null if unlinked. */
  serverIdForProject(projectId: string): string | null {
    const agents = this.byProject.get(projectId);
    const resolved = agents?.find((a) => a.serverId !== null)?.serverId ?? null;
    return resolved ?? this.optimisticServerByProject.get(projectId) ?? null;
  }
}

export const agentsStore = new AgentsStore();
