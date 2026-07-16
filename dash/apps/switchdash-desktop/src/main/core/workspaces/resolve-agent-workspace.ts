import type { WorkspaceType } from '@main/core/workspaces/workspace-factory';
import type { Agent } from '@shared/core/agents/agents';

export type ResolvedAgentWorkspace = {
  type: WorkspaceType;
  workspaceId: string;
  workDir: string;
};

/**
 * Maps an agent's connection (CHOO-1059) to the workspace its sessions run in.
 *
 * Local agents run in the project directory and key their workspace by project
 * id, exactly as switchdash always has. Remote agents run on an SSH host and
 * key their workspace by (host, remoteRepoDir) — NOT the local project dir — so
 * a project's local and remote sessions never collapse onto the same shared
 * workspace. The SSH connection id is derived from the host so every remote
 * session on the same host reuses one pooled connection.
 *
 * Fails loud if a `remote` agent has no `remoteConfig`: that is a corrupt record
 * we cannot provision, not a case to silently fall back to local.
 */
export function resolveAgentWorkspace(
  agent: Pick<Agent, 'connection' | 'remoteConfig'>,
  project: { projectId: string; repoPath: string }
): ResolvedAgentWorkspace {
  if (agent.connection === 'local') {
    return {
      type: { kind: 'local' },
      workspaceId: project.projectId,
      workDir: project.repoPath,
    };
  }

  const remote = agent.remoteConfig;
  if (!remote) {
    throw new Error(
      "agent connection is 'remote' but remoteConfig is missing — cannot provision a remote session"
    );
  }

  return {
    type: {
      kind: 'ssh',
      host: remote.sshHost,
      remoteRepoDir: remote.remoteRepoDir,
      connectionId: agentSshConnectionId(remote.sshHost),
    },
    workspaceId: `${project.projectId}:ssh:${remote.sshHost}:${remote.remoteRepoDir}`,
    workDir: remote.remoteRepoDir,
  };
}

/** Pooled SSH connection id for a host — shared by every remote session on it. */
export function agentSshConnectionId(sshHost: string): string {
  return `agent-ssh:${sshHost}`;
}
