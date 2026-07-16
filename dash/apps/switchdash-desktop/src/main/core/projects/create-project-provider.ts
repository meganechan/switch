import { getAgents } from '@main/core/agents/getAgents';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import type { MachineRef } from '@main/core/runtime/types';
import { ensureSshConnected } from '@main/core/ssh/connect/connect-agent-ssh';
import { agentSshConnectionId } from '@main/core/workspaces/resolve-agent-workspace';
import type { AgentRemoteConfig } from '@shared/core/agents/agent-connection';
import type { LocalProject } from '@shared/projects';
import { ProjectProvider, type ProjectProviderTransport } from './project-provider';
import type { ProjectSettingsProvider } from './settings/provider';
import { LocalProjectSettingsProvider } from './settings/providers/local-project-settings-provider';
import { RemoteProjectSettingsProvider } from './settings/providers/remote-project-settings-provider';

export async function createProvider(project: LocalProject): Promise<ProjectProvider> {
  // A project whose agent runs remotely (CHOO-1059) has its working directory,
  // git, scripts, search and Switch config on the SSH host — not locally (it may
  // have no local path at all). Build an SSH-backed provider so everything
  // operates on the remote dir. Otherwise fall back to the local provider.
  const agents = await getAgents(project.id);
  const remoteAgent = agents.find((agent) => agent.connection === 'remote');
  if (remoteAgent?.remoteConfig) {
    return createSshProvider(project, remoteAgent.remoteConfig);
  }
  return createLocalProvider(project);
}

async function createLocalProvider(project: LocalProject): Promise<ProjectProvider> {
  if (project.path === null) {
    throw new Error(
      `Project ${project.id} has no local path and no remote agent — cannot build a provider`
    );
  }
  const localFs = new LocalFileSystem(project.path);
  const ctx = new LocalExecutionContext({ root: project.path });
  const projectMachine: MachineRef = { kind: 'local' };

  const settings = new LocalProjectSettingsProvider(project.id, project.path);
  await settings.ensure();

  return buildProvider(
    project.id,
    project.path,
    {
      kind: 'local',
      projectMachine,
      defaultWorkspaceType: { kind: 'local' },
      defaultWorkspaceMachine: projectMachine,
      ctx,
    },
    localFs,
    settings,
    () => {}
  );
}

async function createSshProvider(
  project: LocalProject,
  remoteConfig: AgentRemoteConfig
): Promise<ProjectProvider> {
  const { sshHost, remoteRepoDir } = remoteConfig;
  const connectionId = agentSshConnectionId(sshHost);
  const proxy = await ensureSshConnected(connectionId, sshHost);
  const ctx = new SshExecutionContext(proxy, { root: remoteRepoDir });
  const remoteFs = new SshFileSystem(proxy, remoteRepoDir);
  // Mirror the SSH wiring resolveAgentWorkspace uses for remote sessions: the
  // workspace type is keyed by (host, remoteRepoDir, pooled connection id), and
  // the machine ref carries the host + connection.
  const projectMachine: MachineRef = { kind: 'ssh', host: sshHost, connectionId };

  const settings = new RemoteProjectSettingsProvider(project.id, remoteRepoDir, remoteFs);
  await settings.ensure();

  return buildProvider(
    project.id,
    remoteRepoDir,
    {
      kind: 'ssh',
      projectMachine,
      defaultWorkspaceType: { kind: 'ssh', host: sshHost, remoteRepoDir, connectionId },
      defaultWorkspaceMachine: projectMachine,
      ctx,
    },
    remoteFs,
    settings,
    () => {}
  );
}

function buildProvider(
  projectId: string,
  repoPath: string,
  transportMeta: Pick<
    ProjectProviderTransport,
    'kind' | 'projectMachine' | 'defaultWorkspaceType' | 'defaultWorkspaceMachine' | 'ctx'
  >,
  projectFs: FileSystemProvider,
  settings: ProjectSettingsProvider,
  dispose: () => void
): ProjectProvider {
  const transport: ProjectProviderTransport = {
    ...transportMeta,
    fs: projectFs,
    settings,
  };

  return new ProjectProvider(projectId, repoPath, transport, dispose);
}
