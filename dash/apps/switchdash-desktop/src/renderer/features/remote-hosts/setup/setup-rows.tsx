/**
 * A host's contents as rows (CHOO-1809).
 *
 * The first cut of this page was a flat checklist of every step, which read as
 * a wall of text and buried the one line that mattered. This is the same
 * language the agents settings page uses — icon tile, name, status pill, click
 * for detail — so a host reads like the rest of the product.
 */

import { GitBranch, Github, KeyRound, Package, Server, SquareTerminal } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { Button } from '@renderer/lib/ui/button';
import { Label } from '@renderer/lib/ui/label';
import { StatusBadge } from '@renderer/lib/ui/status-badge';
import { cn } from '@renderer/utils/utils';
import type { HostSetupStep } from '@shared/core/remote-hosts/setup';
import {
  agentTypeBadge,
  canInstall,
  stepBadge,
  type AgentTypeRow,
  type BadgeSpec,
} from './step-presentation';

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
  progress,
  badge,
  highlighted,
  action,
  onClick,
}: {
  icon: React.ReactNode;
  name: string;
  subtitle?: string | null;
  /** What the running command last printed. Takes the subtitle's place while it runs. */
  progress?: string | null;
  badge: BadgeSpec;
  highlighted?: boolean;
  /** Inline fix-it control, so acting on one item costs no navigation. */
  action?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <div
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg p-3 hover:bg-background-1',
        highlighted && 'bg-background-1 ring-1 ring-amber-500/40'
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
      >
        <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-background-1 p-1.5 group-hover:bg-background-2">
          {icon}
        </div>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm text-foreground">{name}</span>
          {progress ? (
            <span className="truncate font-mono text-[11px] text-foreground-muted">{progress}</span>
          ) : (
            subtitle && <span className="truncate text-xs text-foreground-muted">{subtitle}</span>
          )}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
        {action}
      </div>
    </div>
  );
}

/** The inline Install / Retry control, shown only when there is something to do. */
function InstallAction({
  step,
  installing,
  onInstall,
}: {
  step: HostSetupStep;
  installing: boolean;
  onInstall: () => void;
}) {
  if (!canInstall(step)) return null;
  const busy = installing || step.state === 'installing' || step.state === 'checking';
  return (
    <Button
      size="xs"
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        onInstall();
      }}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : step.state === 'failed' ? (
        'Retry'
      ) : (
        'Install'
      )}
    </Button>
  );
}

export function PrerequisiteRow({
  step,
  isCurrent,
  installing,
  activity,
  onInstall,
  onOpen,
}: {
  step: HostSetupStep;
  isCurrent: boolean;
  installing: boolean;
  activity: string | null;
  onInstall: () => void;
  onOpen: () => void;
}) {
  return (
    <Row
      icon={<PrerequisiteIcon step={step} />}
      name={step.name}
      subtitle={step.state === 'satisfied' ? step.version : null}
      progress={activity}
      badge={stepBadge(step)}
      highlighted={isCurrent}
      action={<InstallAction step={step} installing={installing} onInstall={onInstall} />}
      onClick={onOpen}
    />
  );
}

export function AgentTypeRowItem({
  row,
  isCurrent,
  installingStepId,
  activityFor,
  onInstall,
  onOpen,
}: {
  row: AgentTypeRow;
  isCurrent: boolean;
  installingStepId: string | null;
  /** A row covers two steps, so it asks per step which one is talking. */
  activityFor: (stepId: string) => string | null;
  onInstall: (stepId: string) => void;
  onOpen: () => void;
}) {
  // Fix whichever half is outstanding: the CLI first, then its connector. One
  // button, because the row states one question — is this usable?
  const next = canInstall(row.cli)
    ? row.cli
    : row.plugin && canInstall(row.plugin)
      ? row.plugin
      : null;
  return (
    <Row
      icon={<AgentIcon id={row.agentId} size={16} />}
      name={row.name}
      subtitle={row.cli.state === 'satisfied' ? row.cli.version : null}
      progress={activityFor(row.cli.id) ?? (row.plugin ? activityFor(row.plugin.id) : null)}
      badge={agentTypeBadge(row)}
      highlighted={isCurrent}
      action={
        next ? (
          <InstallAction
            step={next}
            installing={installingStepId === next.id}
            onInstall={() => onInstall(next.id)}
          />
        ) : null
      }
      onClick={onOpen}
    />
  );
}
