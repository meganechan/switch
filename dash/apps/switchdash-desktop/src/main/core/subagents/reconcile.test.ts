import type { LocalSubagent } from '@switchdash/core/agents/plugins';
import { describe, expect, it } from 'vitest';
import { reconcileSubagents } from './reconcile';

const local = (name: string, switchAgentId: string | null): LocalSubagent => ({
  name,
  description: null,
  model: null,
  switchAgentId,
  apiEndpoint: switchAgentId ? 'https://gw.example' : null,
});

describe('reconcileSubagents', () => {
  it('marks registered=null and reports no drift when there is no remote', () => {
    const { subagents, remoteOnly } = reconcileSubagents({
      parentAgentId: 'p1',
      serverId: 's1',
      local: [local('reviewer', 'sa-1')],
      remote: null,
    });
    expect(subagents).toEqual([
      {
        name: 'reviewer',
        description: null,
        model: null,
        switchAgentId: 'sa-1',
        apiEndpoint: 'https://gw.example',
        parentAgentId: 'p1',
        serverId: 's1',
        registered: null,
      },
    ]);
    expect(remoteOnly).toEqual([]);
  });

  it('flags a local subagent registered when its id is a gateway child', () => {
    const { subagents, remoteOnly } = reconcileSubagents({
      parentAgentId: 'p1',
      serverId: 's1',
      local: [local('reviewer', 'sa-1')],
      remote: { parentName: 'main', children: [{ id: 'sa-1', name: 'main.reviewer' }] },
    });
    expect(subagents[0].registered).toBe(true);
    expect(remoteOnly).toEqual([]);
  });

  it('flags a local subagent not on the gateway as registered=false', () => {
    const { subagents } = reconcileSubagents({
      parentAgentId: 'p1',
      serverId: 's1',
      local: [local('reviewer', 'sa-1'), local('orphan', null)],
      remote: { parentName: 'main', children: [{ id: 'sa-1', name: 'main.reviewer' }] },
    });
    expect(subagents.find((s) => s.name === 'reviewer')?.registered).toBe(true);
    expect(subagents.find((s) => s.name === 'orphan')?.registered).toBe(false);
  });

  it('reports gateway children with no local file as remote-only, prefix stripped', () => {
    const { remoteOnly } = reconcileSubagents({
      parentAgentId: 'p1',
      serverId: 's1',
      local: [local('reviewer', 'sa-1')],
      remote: {
        parentName: 'main',
        children: [
          { id: 'sa-1', name: 'main.reviewer' },
          { id: 'sa-2', name: 'main.planner' },
        ],
      },
    });
    expect(remoteOnly).toEqual([{ name: 'planner', switchAgentId: 'sa-2' }]);
  });

  it('keeps the raw child name when it lacks the parent prefix', () => {
    const { remoteOnly } = reconcileSubagents({
      parentAgentId: 'p1',
      serverId: 's1',
      local: [],
      remote: { parentName: 'main', children: [{ id: 'sa-9', name: 'weird-name' }] },
    });
    expect(remoteOnly).toEqual([{ name: 'weird-name', switchAgentId: 'sa-9' }]);
  });
});
