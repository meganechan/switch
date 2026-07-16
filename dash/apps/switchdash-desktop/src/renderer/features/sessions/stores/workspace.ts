import type { ILifecycle } from '@switchdash/shared';
import { LifecycleScriptsStore } from './lifecycle-scripts';

export class WorkspaceStore implements ILifecycle {
  readonly path: string;
  readonly lifecycleScripts: LifecycleScriptsStore;

  constructor(projectId: string, workspaceId: string, path: string) {
    this.path = path;
    this.lifecycleScripts = new LifecycleScriptsStore(projectId, workspaceId);
  }

  activate(): void {}

  initialize(): void {
    this.activate();
  }

  dispose(): void {
    this.lifecycleScripts.dispose();
  }
}
