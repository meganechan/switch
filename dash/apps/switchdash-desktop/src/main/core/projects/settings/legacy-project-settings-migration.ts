import type { Result } from '@switchdash/shared';
import type { FileSystemProvider } from '@main/core/fs/types';
import { log } from '@main/lib/logger';
import {
  baseProjectSettingsSchema,
  legacyBaseProjectSettingsSchema,
  legacyProjectConfigSchema,
  shareableProjectSettingsSchema,
  type BaseProjectSettings,
  type ShareableProjectSettings,
} from '@shared/core/project-settings/project-settings';
import { mergeShareableProjectSettings } from '@shared/core/project-settings/project-settings-fields';
import type { UpdateProjectSettingsError } from '@shared/projects';
import {
  hasLegacyShareableConfigMigrated,
  serializeShareableProjectSettings,
} from './legacy-shareable-migration-marker';
import { compactUndefined, parseJsonObject, readJson } from './project-settings-json';
import type { ProjectSettingsStorage, StoredProjectSettings } from './project-settings-storage';

export type LegacyProjectSettingsMigrationArgs = {
  projectId: string;
  row: StoredProjectSettings | undefined;
  configReader: Pick<FileSystemProvider, 'exists' | 'read'> | undefined;
  storage: ProjectSettingsStorage;
  git?: ProjectSettingsGitInspector;
  normalizeStoredWorktreeDirectory: (
    worktreeDirectory: string
  ) => Promise<Result<string, UpdateProjectSettingsError>>;
};

export type ProjectSettingsGitInspector = {
  isFileCleanlyTracked(filePath: string): Promise<boolean>;
};

async function readLegacyProjectConfig(
  configReader: Pick<FileSystemProvider, 'exists' | 'read'> | undefined
): Promise<BaseProjectSettings | undefined> {
  if (!configReader) return undefined;
  try {
    if (!(await configReader.exists('.switchdash.json'))) return undefined;
    const { content } = await configReader.read('.switchdash.json');
    const parsed = legacyProjectConfigSchema.safeParse(parseJsonObject(content));
    if (!parsed.success) {
      log.warn('Failed to parse legacy .switchdash.json for migration', parsed.error);
      return undefined;
    }
    return parsed.data;
  } catch (error) {
    log.warn('Failed to read legacy .switchdash.json for migration', error);
    return undefined;
  }
}

export async function migrateLegacyProjectSettingsIfNeeded({
  projectId,
  row,
  configReader,
  storage,
  git,
  normalizeStoredWorktreeDirectory,
}: LegacyProjectSettingsMigrationArgs): Promise<void> {
  if (!row) return;

  const baseAlreadyMigrated = Boolean(row.legacyConfigMigratedAt);
  const shareableAlreadyMigrated = hasLegacyShareableConfigMigrated(
    row.shareableProjectSettingsJson
  );
  if (baseAlreadyMigrated && shareableAlreadyMigrated) return;

  const current = readJson(
    row.baseProjectSettingsJson,
    legacyBaseProjectSettingsSchema,
    'base project settings'
  );
  const currentShareable = readJson(
    row.shareableProjectSettingsJson,
    shareableProjectSettingsSchema,
    'shareable project settings'
  );
  const legacy = await readLegacyProjectConfig(configReader);
  const next: BaseProjectSettings = baseProjectSettingsSchema.parse(current);
  let nextShareable: ShareableProjectSettings | undefined;

  if (legacy && !baseAlreadyMigrated) {
    if (legacy.worktreeDirectory !== undefined) {
      const normalized = await normalizeStoredWorktreeDirectory(legacy.worktreeDirectory);
      if (normalized.success) next.worktreeDirectory = normalized.data;
    }
    if (legacy.tmux !== undefined) next.tmux = legacy.tmux;
    if (legacy.workspaceProvider !== undefined) {
      next.workspaceProvider = legacy.workspaceProvider;
    }
  }

  if (legacy && !shareableAlreadyMigrated) {
    if ((await git?.isFileCleanlyTracked('.switchdash.json')) === false) {
      const legacyShareable = shareableProjectSettingsSchema.parse(legacy);
      nextShareable = mergeShareableProjectSettings(currentShareable, legacyShareable);
    }
  }

  const update: Partial<StoredProjectSettings> = {
    ...(nextShareable
      ? {
          shareableProjectSettingsJson: serializeShareableProjectSettings(nextShareable, {
            previousRaw: row.shareableProjectSettingsJson,
            markLegacyShareableConfigMigrated: true,
          }),
        }
      : {}),
  };

  if (!baseAlreadyMigrated) {
    update.baseProjectSettingsJson = JSON.stringify(compactUndefined(next));
    update.legacyConfigMigratedAt = new Date().toISOString();
  }

  if (Object.keys(update).length > 0) {
    await storage.update(projectId, update);
  }
}
