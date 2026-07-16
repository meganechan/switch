import { describe, expect, it } from 'vitest';
import { buildRepoRootWorkspaceConfig } from './build-workspace-config';

describe('buildRepoRootWorkspaceConfig', () => {
  it('targets the repository-instance workspace when known', () => {
    expect(buildRepoRootWorkspaceConfig('ws-1')).toEqual({
      version: '3',
      workspace: { kind: 'repository-instance', workspaceId: 'ws-1' },
    });
  });

  it('falls back to a transient target before the project is mounted', () => {
    expect(buildRepoRootWorkspaceConfig()).toEqual({
      version: '3',
      workspace: { kind: 'new-worktree' },
    });
  });
});
