import { homedir } from 'node:os';
import type { PluginFs } from '@switchdash/core/agents/plugins';
import { eq } from 'drizzle-orm';
import { getAgentById } from '@main/core/agents/getAgentById';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { createPluginFs } from '@main/core/providers/plugin-fs';
import { createRemotePluginFs } from '@main/core/providers/remote-plugin-fs';
import { ensureSshConnected } from '@main/core/ssh/connect/connect-agent-ssh';
import { agentSshConnectionId } from '@main/core/workspaces/resolve-agent-workspace';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import type { Agent } from '@shared/core/agents/agents';

/**
 * A PluginFs that resolves nothing. Used for the user (home) scope of a remote
 * agent, whose VM home dir is not mounted here — project-scoped subagent IO,
 * which is what switchdash authors, is unaffected.
 */
const EMPTY_PLUGIN_FS: PluginFs = {
  read: () => Promise.resolve(null),
  write: () => Promise.reject(new Error('home scope is read-only for remote agents')),
  delete: () => Promise.resolve(),
  exists: () => Promise.resolve(false),
  list: () => Promise.resolve([]),
};

export type SubagentWorkspace = {
  agent: Agent;
  /** FS rooted at the parent's working dir — local disk or the remote repo dir. */
  fs: PluginFs;
  /** FS for user-scoped (`~/.claude`) definitions; empty for remote agents. */
  homeFs: PluginFs;
  /** Release resources (the remote SFTP channel). Always call in a `finally`. */
  close: () => void;
};

/**
 * Open a {@link PluginFs} rooted at a remote agent's working dir over SFTP,
 * without needing a switchdash agent record — used at onboarding time (keyed on
 * ssh host + repo dir) as well as by {@link resolveSubagentWorkspace}. Callers
 * MUST invoke `close()` in a `finally` to release the SFTP channel.
 */
export async function openRemoteSubagentFs(
  sshHost: string,
  remoteRepoDir: string
): Promise<{ fs: PluginFs; close: () => void }> {
  const proxy = await ensureSshConnected(agentSshConnectionId(sshHost), sshHost);
  const sshFs = new SshFileSystem(proxy, remoteRepoDir);
  return { fs: createRemotePluginFs(sshFs), close: () => sshFs.close() };
}

async function getProjectPath(projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ path: projects.path })
    .from(projects)
    .where(eq(projects.id, projectId));
  return row?.path ?? null;
}

/**
 * Resolve the filesystem where a parent agent's subagent definitions and
 * credentials live, transparently for local and remote agents. Local agents use
 * their project dir on disk; remote agents use their SSH host's repo dir over
 * SFTP (the same connect seam the remote credential shipping in setupRemoteAgent
 * uses).
 *
 * Callers MUST invoke `close()` in a `finally` — for remote agents it releases
 * the SFTP channel, which otherwise leaks and eventually exhausts the host's
 * MaxSessions.
 */
export async function resolveSubagentWorkspace(parentAgentId: string): Promise<SubagentWorkspace> {
  const agent = await getAgentById(parentAgentId);
  if (!agent) throw new Error(`No agent with id ${parentAgentId}`);

  if (agent.connection === 'remote') {
    if (!agent.remoteConfig) {
      throw new Error(`Remote agent ${parentAgentId} has no remote config.`);
    }
    const { sshHost, remoteRepoDir } = agent.remoteConfig;
    const remote = await openRemoteSubagentFs(sshHost, remoteRepoDir);
    return { agent, fs: remote.fs, homeFs: EMPTY_PLUGIN_FS, close: remote.close };
  }

  const projectPath = await getProjectPath(agent.projectId);
  if (!projectPath) {
    throw new Error(`Local agent ${parentAgentId} has no project directory on disk.`);
  }
  return {
    agent,
    fs: createPluginFs(projectPath),
    homeFs: createPluginFs(homedir()),
    close: () => {},
  };
}
