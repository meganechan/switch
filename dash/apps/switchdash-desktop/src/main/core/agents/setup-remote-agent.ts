import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { ensureSshConnected } from '@main/core/ssh/connect/connect-agent-ssh';
import { readSwitchAgentCredentials } from '@main/core/switch-rooms/switch-credentials';
import { agentSshConnectionId } from '@main/core/workspaces/resolve-agent-workspace';
import { log } from '@main/lib/logger';
import type { AgentRemoteConfig } from '@shared/core/agents/agent-connection';
import { writeRemoteSwitchSettings } from './write-remote-switch-settings';

/**
 * Set up a remote agent's host (CHOO-1059, option A): copy the agent's Switch
 * credentials to the VM the moment it is configured remote.
 *
 * switchdash does not persist the agent's API token — it is minted at
 * onboarding and written only to the local `.claude/settings.local.json`. So we
 * read it back from there and write it into the remote working dir over SFTP,
 * where the sidecar reads it. Fails loud if the agent has no local creds yet
 * (it must be onboarded locally first) — there is no token to ship otherwise.
 */
export async function setupRemoteAgent(params: {
  remoteConfig: AgentRemoteConfig;
  /** The agent's local working dir (its project dir) holding the minted creds. */
  localDir: string;
}): Promise<void> {
  const creds = await readSwitchAgentCredentials(params.localDir, log);
  if (!creds) {
    throw new Error(
      `cannot set up remote agent: no Switch credentials at ${params.localDir}/.claude/settings.local.json — onboard the agent locally first so its token exists to copy.`
    );
  }

  const proxy = await ensureSshConnected(
    agentSshConnectionId(params.remoteConfig.sshHost),
    params.remoteConfig.sshHost
  );
  const fs = new SshFileSystem(proxy, params.remoteConfig.remoteRepoDir);
  try {
    await writeRemoteSwitchSettings(fs, {
      apiEndpoint: creds.apiEndpoint,
      apiToken: creds.token,
      agentId: creds.agentId,
    });
  } finally {
    fs.close();
  }
}
