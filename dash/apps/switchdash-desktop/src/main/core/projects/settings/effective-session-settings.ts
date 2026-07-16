import type { FileSystemProvider } from '@main/core/fs/types';
import { log } from '@main/lib/logger';
import {
  defaultShareableProjectSettings,
  shareableProjectSettingsSchema,
  type ProjectSettings,
} from '@shared/core/project-settings/project-settings';
import { mergeShareableProjectSettings } from '@shared/core/project-settings/project-settings-fields';
import type { ProjectSettingsProvider } from './provider';

export async function getEffectiveSessionSettings(args: {
  projectSettings: ProjectSettingsProvider;
  sessionFs: FileSystemProvider;
}): Promise<ProjectSettings> {
  const { projectSettings, sessionFs } = args;
  const parsedSettings = shareableProjectSettingsSchema.safeParse(await projectSettings.get());
  const localShareableSettings = parsedSettings.success ? parsedSettings.data : {};
  const defaults = defaultShareableProjectSettings();
  const exists = await sessionFs.exists('.switchdash.json');
  if (!exists) {
    return mergeShareableProjectSettings(defaults, localShareableSettings);
  }

  try {
    const { content } = await sessionFs.read('.switchdash.json');
    const projectFileSettings = shareableProjectSettingsSchema.parse(JSON.parse(content));
    return mergeShareableProjectSettings(defaults, projectFileSettings, localShareableSettings);
  } catch (err) {
    log.warn('Failed to parse session .switchdash.json, falling back to project settings', err);
    return mergeShareableProjectSettings(defaults, localShareableSettings);
  }
}
