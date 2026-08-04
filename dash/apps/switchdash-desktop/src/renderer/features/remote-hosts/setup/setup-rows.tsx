/**
 * A host's contents as rows (CHOO-1809).
 *
 * The first cut of this page was a flat checklist of every step, which read as
 * a wall of text and buried the one line that mattered. This is the same
 * language the agents settings page uses — icon tile, name, status pill, click
 * for detail — so a host reads like the rest of the product.
 */

import { GitBranch, Github, KeyRound, Package, Server, SquareTerminal } from 'lucide-react';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { Label } from '@renderer/lib/ui/label';
import { StatusBadge } from '@renderer/lib/ui/status-badge';
import { cn } from '@renderer/utils/utils';
import type { HostSetupStep } from '@shared/core/remote-hosts/setup';
import { agentTypeBadge, stepBadge, type AgentTypeRow, type BadgeSpec } from './step-presentation';

/** Lucide icons for the host tools. Agent types use their own brand icon. */
const PREREQUISITE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  git: GitBranch,
  tmux: SquareTerminal,
  node: Package,
  gh: Github,
};

export function PrerequisiteIcon({ step, size = 16 }: { step: HostSetupStep; size?: 16 | 24 }) {
  const Icon = step.kind === 'gh-auth' ? KeyRound : (PREREQUISITE_ICON[step.id] ?? Server);
  return <Icon className={cn('text-foreground-muted', size === 24 ? 'size-6' : 'size-4')} />;
}

export function SectionLabel({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <div className="px-3 py-2">
      <Label>
        {children}
        {` (${count})`}
      </Label>
    </div>
  );
}

/**
 * One row. Deliberately the same shape as the agents page's `AgentRow`: a
 * tile, a name, a subtitle, and the status on the right.
 */
function Row({
  icon,
  name,
  subtitle,
  badge,
  highlighted,
  onClick,
}: {
  icon: React.ReactNode;
  name: string;
  subtitle?: string | null;
  badge: BadgeSpec;
  highlighted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex w-full cursor-pointer items-center gap-3 rounded-lg p-3 text-left hover:bg-background-1',
        highlighted && 'bg-background-1 ring-1 ring-amber-500/40'
      )}
    >
      <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-background-1 p-1.5 group-hover:bg-background-2">
        {icon}
      </div>
      <div className="flex w-full min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm text-foreground">{name}</span>
          {subtitle && <span className="truncate text-xs text-foreground-muted">{subtitle}</span>}
        </span>
        <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
      </div>
    </button>
  );
}

export function PrerequisiteRow({
  step,
  isCurrent,
  onOpen,
}: {
  step: HostSetupStep;
  isCurrent: boolean;
  onOpen: () => void;
}) {
  return (
    <Row
      icon={<PrerequisiteIcon step={step} />}
      name={step.name}
      subtitle={step.state === 'satisfied' ? step.version : null}
      badge={stepBadge(step)}
      highlighted={isCurrent}
      onClick={onOpen}
    />
  );
}

export function AgentTypeRowItem({
  row,
  isCurrent,
  onOpen,
}: {
  row: AgentTypeRow;
  isCurrent: boolean;
  onOpen: () => void;
}) {
  return (
    <Row
      icon={<AgentIcon id={row.agentId} size={16} />}
      name={row.name}
      subtitle={row.cli.state === 'satisfied' ? row.cli.version : null}
      badge={agentTypeBadge(row)}
      highlighted={isCurrent}
      onClick={onOpen}
    />
  );
}
