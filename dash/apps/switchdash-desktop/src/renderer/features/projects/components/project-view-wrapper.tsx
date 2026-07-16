import type { ReactNode } from 'react';

interface ProjectViewWrapperProps {
  children: ReactNode;
  projectId: string;
  /** When set, the view is scoped to this Claude Code subagent of the project's
   * agent: Sessions lists only its sessions and Settings shows its own config. */
  subagentName?: string;
}

export function ProjectViewWrapper({ children }: ProjectViewWrapperProps) {
  return <>{children}</>;
}
