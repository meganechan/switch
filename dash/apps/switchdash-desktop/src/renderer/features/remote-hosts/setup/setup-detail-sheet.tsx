/**
 * One thing on a host, in detail (CHOO-1809).
 *
 * Deliberately the same shape as the agents settings sheet: an identity header,
 * an **Installation** section with the found/not-found card, and — for an agent
 * type — a **Switch setup** section for its connector. Setting up Claude Code
 * on a remote host should not look like a different product from setting it up
 * locally.
 *
 * The row says what state something is in; this says what was actually
 * observed and what you can do about it.
 */

import { Check, ChevronRight, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { Button } from '@renderer/lib/ui/button';
import { Field } from '@renderer/lib/ui/field';
import { Label } from '@renderer/lib/ui/label';
import { Sheet, SheetContent, SheetHeader } from '@renderer/lib/ui/sheet';
import { StatusBadge } from '@renderer/lib/ui/status-badge';
import { cn } from '@renderer/utils/utils';
import type { HostSetupStep } from '@shared/core/remote-hosts/setup';
import {
  agentTypeBadge,
  canSkip,
  outcomeLabel,
  stepBadge,
  type AgentTypeRow,
} from './step-presentation';

/**
 * A failed step's raw command output, collapsed by default. Hidden behind a
 * disclosure rather than dropped: it is usually the only thing that explains
 * *why* an install failed, but it is long enough to bury everything else.
 */
function FailureOutput({ output }: { output: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className="flex w-fit items-center gap-1 text-xs text-foreground-muted hover:text-foreground"
        onClick={() => setOpen((prev) => !prev)}
      >
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        {open ? 'Hide output' : 'Show output'}
      </button>
      {open && (
        <pre className="bg-background-subtle max-h-64 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap">
          {output}
        </pre>
      )}
    </div>
  );
}

/** The tick / spinner / cross tile the agents page uses for install status. */
function OutcomeTile({ step }: { step: HostSetupStep }) {
  if (step.state === 'satisfied') {
    return (
      <div className="flex size-6 items-center justify-center rounded-lg bg-background-success">
        <Check
          className="size-3.5 shrink-0 text-foreground-success"
          absoluteStrokeWidth
          strokeWidth={3}
        />
      </div>
    );
  }
  if (step.state === 'checking' || step.state === 'installing') {
    return (
      <div className="flex size-6 items-center justify-center rounded-lg bg-background-2">
        <Loader2 className="size-3.5 animate-spin text-foreground-muted" />
      </div>
    );
  }
  return (
    <div className="flex size-6 items-center justify-center rounded-lg bg-background-2">
      <X className="size-3.5 shrink-0 text-foreground-passive" strokeWidth={2.5} />
    </div>
  );
}

/** What a step observed, in the agents page's "Found `v…`" card. */
function ObservationCard({ step, actions }: { step: HostSetupStep; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 rounded-lg border p-3">
        <OutcomeTile step={step} />
        <div className="min-w-0 flex-1 truncate text-sm">
          {step.state === 'satisfied' ? (
            <>
              <span>Found</span>
              {step.version && (
                <span className="ml-1 rounded-md bg-background-quaternary-2 px-1 py-0.5 font-mono text-xs text-foreground-muted">
                  {step.version}
                </span>
              )}
              <span className="ml-1">on this host</span>
            </>
          ) : step.state === 'checking' ? (
            <span className="text-foreground-muted">Checking…</span>
          ) : step.state === 'installing' ? (
            <span className="text-foreground-muted">Installing…</span>
          ) : (
            <span className="text-foreground-muted">{outcomeLabel(step.outcome)}</span>
          )}
        </div>
        {actions}
      </div>

      {step.state === 'failed' && step.error && (
        <p className="text-destructive text-xs">{step.error}</p>
      )}
      {step.state === 'failed' && step.output && <FailureOutput output={step.output} />}
    </div>
  );
}

/** A gh-auth step whose own dependency has not been satisfied yet. */
function isBlockedByDep(step: HostSetupStep): boolean {
  return step.state === 'blocked' || step.state === 'pending';
}

function StepActions({
  step,
  onSkip,
  skipping,
  onAuthenticate,
}: {
  step: HostSetupStep;
  onSkip: () => void;
  skipping: boolean;
  onAuthenticate: () => void;
}) {
  // Only offer the GitHub sign-in once gh itself is there — the device flow
  // runs `gh` on the host, so offering it before the CLI exists sends the user
  // into a failure that says nothing about the real problem.
  const canSignIn = step.kind === 'gh-auth' && step.state !== 'satisfied' && !isBlockedByDep(step);
  if (!canSignIn && !canSkip(step)) return null;

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {canSignIn && (
        <Button size="xs" onClick={onAuthenticate}>
          {step.error?.includes('read:packages') ? 'Re-authenticate' : 'Sign in'}
        </Button>
      )}
      {canSkip(step) && (
        <Button size="xs" variant="ghost" disabled={skipping} onClick={onSkip}>
          {skipping ? 'Skipping…' : 'Skip'}
        </Button>
      )}
    </div>
  );
}

/** Identity header, mirroring the agents sheet. */
function ItemHeader({
  icon,
  name,
  subtitle,
  badge,
}: {
  icon: React.ReactNode;
  name: string;
  subtitle: string;
  badge: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-background-quaternary-1 p-1.5">
        {icon}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-lg text-foreground">{name}</span>
          {badge}
        </div>
        <span className="text-xs text-foreground-muted">{subtitle}</span>
      </div>
    </div>
  );
}

export type SheetTarget =
  | { kind: 'prerequisite'; step: HostSetupStep }
  | { kind: 'agent-type'; row: AgentTypeRow };

export function SetupDetailSheet({
  target,
  sshHost,
  icon,
  onClose,
  onSkip,
  skippingStepId,
  onAuthenticate,
}: {
  target: SheetTarget | null;
  sshHost: string;
  /** Icon for the prerequisite being shown; agent types use their own. */
  icon: React.ReactNode;
  onClose: () => void;
  onSkip: (stepId: string) => void;
  skippingStepId: string | null;
  onAuthenticate: () => void;
}) {
  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0">
        {target && (
          <>
            <SheetHeader label={target.kind === 'agent-type' ? 'Agent type' : 'Prerequisite'} />
            <div className="space-y-6 overflow-y-auto px-4 pb-6">
              {target.kind === 'prerequisite' ? (
                <>
                  <ItemHeader
                    icon={icon}
                    name={target.step.name}
                    subtitle={`On ${sshHost}`}
                    badge={
                      <StatusBadge tone={stepBadge(target.step).tone}>
                        {stepBadge(target.step).label}
                      </StatusBadge>
                    }
                  />
                  <Field>
                    <Label>Installation</Label>
                    <ObservationCard
                      step={target.step}
                      actions={
                        <StepActions
                          step={target.step}
                          onSkip={() => onSkip(target.step.id)}
                          skipping={skippingStepId === target.step.id}
                          onAuthenticate={onAuthenticate}
                        />
                      }
                    />
                  </Field>
                </>
              ) : (
                <AgentTypeDetail
                  row={target.row}
                  sshHost={sshHost}
                  onSkip={onSkip}
                  skippingStepId={skippingStepId}
                  onAuthenticate={onAuthenticate}
                />
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function AgentTypeDetail({
  row,
  sshHost,
  onSkip,
  skippingStepId,
  onAuthenticate,
}: {
  row: AgentTypeRow;
  sshHost: string;
  onSkip: (stepId: string) => void;
  skippingStepId: string | null;
  onAuthenticate: () => void;
}) {
  const badge = agentTypeBadge(row);
  return (
    <>
      <ItemHeader
        icon={<AgentIcon id={row.agentId} size={24} />}
        name={row.name}
        subtitle={`On ${sshHost}`}
        badge={<StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>}
      />

      <Field>
        <Label>Installation</Label>
        <ObservationCard
          step={row.cli}
          actions={
            <StepActions
              step={row.cli}
              onSkip={() => onSkip(row.cli.id)}
              skipping={skippingStepId === row.cli.id}
              onAuthenticate={onAuthenticate}
            />
          }
        />
      </Field>

      {row.plugin && (
        <Field>
          <Label>Switch setup</Label>
          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-sm text-foreground">switch-connector</span>
                <StatusBadge tone={stepBadge(row.plugin).tone}>
                  {stepBadge(row.plugin).label}
                </StatusBadge>
                {row.plugin.version && (
                  <span className="text-xs text-foreground-muted">v{row.plugin.version}</span>
                )}
              </div>
              <StepActions
                step={row.plugin}
                onSkip={() => onSkip(row.plugin!.id)}
                skipping={skippingStepId === row.plugin.id}
                onAuthenticate={onAuthenticate}
              />
            </div>
            {row.plugin.state === 'failed' && row.plugin.error && (
              <p className="text-destructive text-xs">{row.plugin.error}</p>
            )}
            {row.plugin.state === 'failed' && row.plugin.output && (
              <FailureOutput output={row.plugin.output} />
            )}
            <p className="text-xs text-foreground-muted">
              Connects this agent to a Switch instance. Without it the agent starts on this host
              with no Switch tools.
            </p>
          </div>
        </Field>
      )}
    </>
  );
}
