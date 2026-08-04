import type { InstallCommandError } from '@switchdash/core/deps/runtime';
import { err, ok, type Result } from '@switchdash/shared';
import { openSsh2Pty } from '@main/core/pty/ssh2-pty';
import { buildRemoteShellCommand } from '@main/core/ssh/lifecycle/remote-shell-profile';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { log } from '@main/lib/logger';
import { classifyInstallCommandFailure, type InstallCommandRunner } from './install-runner';

/**
 * Runs an install/update command string on a remote host over SSH.
 *
 * Mirrors the local install runner: install commands are full shell lines run
 * through the remote shell in a PTY (many installers want a TTY), with the exit
 * code classified into an InstallCommandError rather than thrown. Uses the same
 * remote shell wrapping as agent session execution so PATH/env match.
 *
 * Output is both accumulated (for the failure transcript) and handed to
 * `onOutput` as it arrives, so a caller can show what the host is doing during
 * an install that takes minutes rather than only once it is over.
 */
export function createSshInstallCommandRunner(
  proxy: SshClientProxy,
  onOutput: (chunk: string) => void
): InstallCommandRunner {
  return async (command) => {
    const profile = await proxy.getRemoteShellProfile();
    const remoteCommand = buildRemoteShellCommand(profile, command);
    const installId = `ssh-install:${crypto.randomUUID()}`;

    const opened = await openSsh2Pty(proxy, {
      id: installId,
      command: remoteCommand,
      cols: 80,
      rows: 24,
    });
    if (!opened.success) {
      const error: InstallCommandError = {
        type: 'pty-open-failed',
        message: opened.error.message,
      };
      return err(error);
    }

    const pty = opened.data;
    return new Promise<Result<void, InstallCommandError>>((resolve) => {
      const chunks: string[] = [];
      pty.onData((chunk) => {
        chunks.push(chunk);
        onOutput(chunk);
      });
      pty.onExit(({ exitCode }) => {
        if (exitCode === 0) {
          log.info('[SshDependencyManager] Remote install succeeded');
          resolve(ok());
          return;
        }
        const output = chunks.join('').trim();
        log.error('[SshDependencyManager] Remote install failed', { exitCode, output });
        resolve(err(classifyInstallCommandFailure({ exitCode, output })));
      });
    });
  };
}
