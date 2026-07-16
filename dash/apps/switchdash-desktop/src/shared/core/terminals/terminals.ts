import type { TerminalShellId } from './terminal-settings';

export type Terminal = {
  id: string;
  projectId: string;
  sessionId: string;
  shellId: TerminalShellId;
  name: string;
};

export type CreateTerminalParams = {
  id: string;
  projectId: string;
  sessionId: string;
  name: string;
  shell?: TerminalShellId;
  initialSize?: { cols: number; rows: number };
};

export function createLifecycleScriptTerminalId(type: 'setup' | 'run' | 'teardown') {
  return `script-lifecycle-${type}`;
}
