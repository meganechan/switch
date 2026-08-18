import path from 'node:path';
import { appSettingsService } from '@main/core/settings/settings-service';
import { log } from '@main/lib/logger';
import type { AgentProviderId } from '@shared/core/providers/agent-provider-registry';
import {
  configWriteLock,
  isPlainObject,
  readLocalConfig,
  writeLocalConfigAtomic,
} from './trust-config-io';

const CLAUDE_PROVIDER_ID: AgentProviderId = 'claude';
const COPILOT_PROVIDER_ID: AgentProviderId = 'copilot';
const CLAUDE_CONFIG_NAME = '.claude.json';
const CLAUDE_SETTINGS_NAME = '.claude/settings.json';
const CLAUDE_SKIP_BYPASS_PROMPT_KEY = 'skipDangerousModePermissionPrompt';
const COPILOT_CONFIG_NAME = '.copilot/config.json';

export class ClaudeTrustService {
  constructor(
    private readonly deps: {
      getSessionSettings: () => Promise<{ autoTrustWorktrees: boolean }>;
    }
  ) {}

  async maybeAutoTrustLocal({
    providerId,
    cwd,
    homedir,
    force = false,
  }: {
    providerId: AgentProviderId;
    cwd?: string;
    homedir: string;
    force?: boolean;
  }): Promise<void> {
    if (!cwd) return;
    if (providerId === CLAUDE_PROVIDER_ID && force) {
      await this.acceptBypassPermissionsMode(homedir);
    }
    const trustConfig = await this.getTrustConfig(providerId, force);
    if (!trustConfig) return;
    const normalizedPath = path.resolve(cwd);
    const configPath = path.join(homedir, trustConfig.configName);
    await configWriteLock.run(configPath, () =>
      this.ensureTrusted(normalizedPath, {
        readConfig: () => readLocalConfig(configPath),
        writeConfig: (content) => writeLocalConfigAtomic(configPath, content),
        trustConfig,
      })
    );
  }

  /**
   * Records acceptance of Claude Code's bypass-permissions warning, the last
   * prompt between a `--dangerously-skip-permissions` launch and a live
   * session.
   *
   * Only reached when the agent's own auto-approve toggle is on, which is where
   * the user accepted that risk; Switch Console does not decide it for them.
   * The warning's default answer is "No, exit", so a detached session left to
   * answer it does not merely stall — the first stray keypress kills it.
   */
  private async acceptBypassPermissionsMode(homedir: string): Promise<void> {
    const settingsPath = path.join(homedir, CLAUDE_SETTINGS_NAME);
    await configWriteLock.run(settingsPath, async () => {
      try {
        const settings = parseConfig(await readLocalConfig(settingsPath), 'Claude settings');
        if (!settings) return;
        if (settings[CLAUDE_SKIP_BYPASS_PROMPT_KEY] === true) return;
        await writeLocalConfigAtomic(
          settingsPath,
          JSON.stringify({ ...settings, [CLAUDE_SKIP_BYPASS_PROMPT_KEY]: true }, null, 2) + '\n'
        );
      } catch (error: unknown) {
        log.warn('ClaudeTrustService: failed to accept bypass-permissions mode', {
          settingsPath,
          error: String(error),
        });
      }
    });
  }

  private async getTrustConfig(
    providerId: AgentProviderId,
    force: boolean
  ): Promise<TrustConfig | null> {
    if (providerId !== CLAUDE_PROVIDER_ID && providerId !== COPILOT_PROVIDER_ID) return null;
    if (!force) {
      const { autoTrustWorktrees } = await this.deps.getSessionSettings();
      if (!autoTrustWorktrees) return null;
    }

    if (providerId === COPILOT_PROVIDER_ID) {
      return {
        configName: COPILOT_CONFIG_NAME,
        parseWarningName: 'Copilot',
        withTrustedPath: withCopilotTrustedFolder,
      };
    }

    return {
      configName: CLAUDE_CONFIG_NAME,
      parseWarningName: 'Claude',
      withTrustedPath: withClaudeTrustedProject,
    };
  }

  private async ensureTrusted(
    normalizedPath: string,
    io: {
      readConfig: () => Promise<string | null>;
      writeConfig: (content: string) => Promise<void>;
      trustConfig: TrustConfig;
    }
  ): Promise<void> {
    try {
      const rawConfig = await io.readConfig();
      const config = parseConfig(rawConfig, io.trustConfig.parseWarningName);
      if (!config) return;
      const nextConfig = io.trustConfig.withTrustedPath(config, normalizedPath);
      if (!nextConfig) return;
      await io.writeConfig(JSON.stringify(nextConfig, null, 2) + '\n');
    } catch (error: unknown) {
      log.warn('ClaudeTrustService: failed to auto-trust worktree', {
        path: normalizedPath,
        error: String(error),
      });
    }
  }
}

export const claudeTrustService = new ClaudeTrustService({
  getSessionSettings: () => appSettingsService.get('sessions'),
});

type TrustConfig = {
  configName: string;
  parseWarningName: string;
  withTrustedPath: (
    config: Record<string, unknown>,
    worktreePath: string
  ) => Record<string, unknown> | null;
};

function parseConfig(raw: string | null, warningName: string): Record<string, unknown> | null {
  if (!raw || raw.trim() === '') return {};

  try {
    const parsed = JSON.parse(raw);
    if (isPlainObject(parsed)) return parsed;
    log.warn(`ClaudeTrustService: refusing to overwrite non-object ${warningName} config root`);
    return null;
  } catch (error: unknown) {
    log.warn(`ClaudeTrustService: refusing to overwrite corrupt ${warningName} config`, {
      error: String(error),
    });
    return null;
  }
}

/**
 * Clears the two prompts Claude Code raises before a session exists: the
 * first-run setup wizard (global) and "is this a project you trust?" (per
 * directory). Both block on a keypress in the TUI, so a session that hits
 * either never starts and never says why.
 *
 * `hasCompletedOnboarding`, `projects` and the two per-directory flags are
 * Claude Code's names for its own config, not Switch Console's. They track
 * whatever Claude Code calls them and must not be renamed to follow our
 * vocabulary — CHOO-1426 renamed them alongside our own project→location
 * refactor, which silently disabled auto-trust for every Claude session while
 * the (equally renamed) test kept passing.
 */
function withClaudeTrustedProject(
  config: Record<string, unknown>,
  worktreePath: string
): Record<string, unknown> | null {
  const projects = isPlainObject(config.projects) ? config.projects : {};
  const existing = isPlainObject(projects[worktreePath]) ? projects[worktreePath] : {};

  const alreadyTrusted =
    config['hasCompletedOnboarding'] === true &&
    existing['hasTrustDialogAccepted'] === true &&
    existing['hasCompletedProjectOnboarding'] === true;
  if (alreadyTrusted) return null;

  return {
    ...config,
    hasCompletedOnboarding: true,
    projects: {
      ...projects,
      [worktreePath]: {
        ...existing,
        hasTrustDialogAccepted: true,
        hasCompletedProjectOnboarding: true,
      },
    },
  };
}

function withCopilotTrustedFolder(
  config: Record<string, unknown>,
  worktreePath: string
): Record<string, unknown> | null {
  const trustedFolders = Array.isArray(config.trustedFolders) ? config.trustedFolders : [];
  if (trustedFolders.includes(worktreePath)) return null;

  return {
    ...config,
    trustedFolders: [...trustedFolders, worktreePath],
  };
}
