import { describe, expect, it } from 'vitest';
import type { Agent } from '@shared/core/agents/agents';
import { agentSshConnectionId, resolveAgentWorkspace } from './resolve-agent-workspace';

const PROJECT = { projectId: 'proj-1', repoPath: '/local/repo' };

function agent(
  overrides: Partial<Pick<Agent, 'connection' | 'remoteConfig'>>
): Pick<Agent, 'connection' | 'remoteConfig'> {
  return { connection: 'local', remoteConfig: null, ...overrides };
}

describe('resolveAgentWorkspace', () => {
  it('keys a local agent by project id and runs in the project dir', () => {
    const result = resolveAgentWorkspace(agent({ connection: 'local' }), PROJECT);
    expect(result).toEqual({
      type: { kind: 'local' },
      workspaceId: 'proj-1',
      workDir: '/local/repo',
    });
  });

  it('keys a remote agent by host+dir and runs in the remote dir', () => {
    const result = resolveAgentWorkspace(
      agent({
        connection: 'remote',
        remoteConfig: { sshHost: 'box', remoteRepoDir: '/home/dev/r' },
      }),
      PROJECT
    );
    expect(result).toEqual({
      type: {
        kind: 'ssh',
        host: 'box',
        remoteRepoDir: '/home/dev/r',
        connectionId: 'agent-ssh:box',
      },
      workspaceId: 'proj-1:ssh:box:/home/dev/r',
      workDir: '/home/dev/r',
    });
  });

  it('shares one pooled connection id per host', () => {
    expect(agentSshConnectionId('box')).toBe('agent-ssh:box');
  });

  it('fails loud when a remote agent has no remoteConfig', () => {
    expect(() => resolveAgentWorkspace(agent({ connection: 'remote' }), PROJECT)).toThrow(
      /remoteConfig is missing/
    );
  });
});
