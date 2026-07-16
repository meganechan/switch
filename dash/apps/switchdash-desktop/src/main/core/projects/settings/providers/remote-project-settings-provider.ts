import { posix as pathPosix } from 'node:path';
import { ok, type Result } from '@switchdash/shared';
import type { FileSystemProvider } from '@main/core/fs/types';
import type { UpdateProjectSettingsError } from '@shared/projects';
import {
  DbProjectSettingsProvider,
  type DbProjectSettingsProviderOptions,
} from './db-project-settings-provider';

/**
 * DB-backed project settings for a remote (SSH) agent. Its working directory
 * lives on the host, so there is no local path to read/validate; the config
 * reader is backed by the SSH filesystem. switchdash runs every session in the
 * remote working dir (no worktrees), so worktree-directory handling is a no-op.
 */
export class RemoteProjectSettingsProvider extends DbProjectSettingsProvider {
  constructor(
    projectId: string,
    remoteRepoDir: string,
    fs: Pick<FileSystemProvider, 'exists' | 'read'>,
    options: DbProjectSettingsProviderOptions = {}
  ) {
    super(projectId, remoteRepoDir, fs, options);
  }

  protected defaultWorktreeDirectory(): Promise<string> {
    return Promise.resolve(this.projectPath);
  }

  protected validateWorktreeDirectory(
    worktreeDirectory: string | undefined
  ): Promise<Result<string | undefined, UpdateProjectSettingsError>> {
    return Promise.resolve(ok(worktreeDirectory));
  }

  protected normalizeStoredWorktreeDirectory(
    worktreeDirectory: string
  ): Promise<Result<string, UpdateProjectSettingsError>> {
    return Promise.resolve(ok(pathPosix.normalize(worktreeDirectory)));
  }
}
