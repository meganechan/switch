import type { FileSystemProvider } from '@main/core/fs/types';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/provider';
import type { LifecycleScriptService } from './workspace-lifecycle-service';

export interface Workspace {
  readonly id: string;
  readonly path: string;
  readonly fs: FileSystemProvider;
  readonly settings: ProjectSettingsProvider;
  readonly lifecycleService: LifecycleScriptService;
  dispose?(): void | Promise<void>;
}
