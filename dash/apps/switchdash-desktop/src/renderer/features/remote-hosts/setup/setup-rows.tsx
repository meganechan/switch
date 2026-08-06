/**
 * A host's contents as rows (CHOO-1809).
 *
 * The first cut of this page was a flat checklist of every step, which read as
 * a wall of text and buried the one line that mattered. This is the same
 * language the agents settings page uses — icon tile, name, status pill, click
 * for detail — so a host reads like the rest of the product.
 */

import {
  GitBranch,
  Github,
  KeyRound,
  Package,
  RefreshCw,
  Server,
  SquareTerminal,
} from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { Button } from '@renderer/lib/ui/button';
import { Label } from '@renderer/lib/ui/label';
import { StatusBadge } from '@renderer/lib/ui/status-badge';
import { cn } from '@renderer/utils/utils';
import {
  isStepInFlight,
  type HostSetupPlan,
  type HostSetupStep,
} from '@shared/core/remote-hosts/setup';
import {
  agentTypeBadge,
  canInstall,
  canOfferAction,
  canSignIn,
  canUpdate,
  signInLabel,
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

/**
 * Re-observe just this row.
 *
 * Always offered, including on a satisfied row: "is this still installed?" is a
 * fair question about something that was verified at some point in the past,
 * and answering it host-wide costs an SSH round trip per step. Disabled while
 * any host-level operation is in flight, so a whole-host re-check and a single
 * row cannot race for the runner.
 */
function RecheckAction({
  rechecking,
  disabled,
  label,
  onRecheck,
}: {
  rechecking: boolean;
  disabled: boolean;
  label: string;
  onRecheck: () => void;
}) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      disabled={disabled || rechecking}
      aria-label={`Re-check ${label}`}
      title={`Re-check ${label}`}
      onClick={(event) => {
        event.stopPropagation();
        onRecheck();
      }}
    >
      <RefreshCw className={cn('size-3.5', rechecking && 'animate-spin')} />
    </Button>
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
  const busy = installing || isStepInFlight(step);
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

/**
 * The inline Update control, shown only when a newer version is known to exist.
 *
 * Separate from Install because the step is already satisfied: this replaces
 * something working, rather than supplying something absent, and the two want
 * different words and different risk.
 */
function UpdateAction({
  step,
  updating,
  onUpdate,
}: {
  step: HostSetupStep;
  updating: boolean;
  onUpdate: () => void;
}) {
  if (!canUpdate(step)) return null;
  const busy = updating || step.state === 'updating';
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={busy}
      title={step.latestVersion ? `Update to ${step.latestVersion}` : 'Update'}
      onClick={(event) => {
        event.stopPropagation();
        onUpdate();
      }}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : 'Update'}
    </Button>
  );
}

export function PrerequisiteRow({
  step,
  plan,
  isCurrent,
  installing,
  updating,
  rechecking,
  hostBusy,
  activity,
  authenticating,
  onInstall,
  onUpdate,
  onRecheck,
  onAuthenticate,
  onOpen,
}: {
  step: HostSetupStep;
  /** Needed to tell whether this step's own prerequisites are in place. */
  plan: HostSetupPlan | null;
  isCurrent: boolean;
  installing: boolean;
  /** True while this row's update is the operation in flight. */
  updating: boolean;
  rechecking: boolean;
  /** True while any operation is running on this host. */
  hostBusy: boolean;
  activity: string | null;
  /** True while the sign-in terminal for this step is already open. */
  authenticating: boolean;
  onInstall: () => void;
  onUpdate: () => void;
  onRecheck: () => void;
  onAuthenticate: () => void;
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
      action={
        <>
          {/*
            Signing in is this row's install: it is the one action that makes the
            step satisfied, so it belongs beside it rather than one click away
            inside the detail sheet.
          */}
          {canOfferAction(hostBusy, installing || updating) &&
            (canSignIn(step, plan) ? (
              <Button
                size="xs"
                disabled={authenticating}
                onClick={(event) => {
                  event.stopPropagation();
                  onAuthenticate();
                }}
              >
                {signInLabel(step)}
              </Button>
            ) : (
              <>
                <UpdateAction step={step} updating={updating} onUpdate={onUpdate} />
                <InstallAction step={step} installing={installing} onInstall={onInstall} />
              </>
            ))}
          {/* Last, so the primary action keeps the same place whether or not
              there is one to take. */}
          <RecheckAction
            rechecking={rechecking || step.state === 'checking'}
            disabled={hostBusy}
            label={step.name}
            onRecheck={onRecheck}
          />
        </>
      }
      onClick={onOpen}
    />
  );
}

export function AgentTypeRowItem({
  row,
  isCurrent,
  installingStepId,
  updatingStepId,
  rechecking,
  hostBusy,
  activityFor,
  onInstall,
  onUpdate,
  onRecheck,
  onOpen,
}: {
  row: AgentTypeRow;
  isCurrent: boolean;
  installingStepId: string | null;
  /** The step whose update is in flight, if any. */
  updatingStepId: string | null;
  /** True while either of this row's two steps is being re-checked. */
  rechecking: boolean;
  /** True while any operation is running on this host. */
  hostBusy: boolean;
  /** A row covers two steps, so it asks per step which one is talking. */
  activityFor: (stepId: string) => string | null;
  onInstall: (stepId: string) => void;
  onUpdate: (stepId: string) => void;
  /** Re-checks both of the row's steps — it presents them as one thing. */
  onRecheck: () => void;
  onOpen: () => void;
}) {
  // Fix whichever half is outstanding: the CLI first, then its connector. One
  // button, because the row states one question — is this usable?
  const next = canInstall(row.cli)
    ? row.cli
    : row.plugin && canInstall(row.plugin)
      ? row.plugin
      : null;
  // Update the CLI before its connector when both are behind: the connector is
  // installed *through* the CLI, so the newer CLI is what will fetch it.
  const stale = canUpdate(row.cli)
    ? row.cli
    : row.plugin && canUpdate(row.plugin)
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
        <>
          {stale && canOfferAction(hostBusy, updatingStepId === stale.id) ? (
            <UpdateAction
              step={stale}
              updating={updatingStepId === stale.id}
              onUpdate={() => onUpdate(stale.id)}
            />
          ) : null}
          {next && canOfferAction(hostBusy, installingStepId === next.id) ? (
            <InstallAction
              step={next}
              installing={installingStepId === next.id}
              onInstall={() => onInstall(next.id)}
            />
          ) : null}
          <RecheckAction
            rechecking={
              rechecking ||
              row.cli.state === 'checking' ||
              row.plugin?.state === 'checking' ||
              false
            }
            disabled={hostBusy}
            label={row.name}
            onRecheck={onRecheck}
          />
        </>
      }
      onClick={onOpen}
    />
  );
}
