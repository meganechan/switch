/**
 * One thing on a host, in detail (CHOO-1809).
 *
 * The row says what state something is in; this says what we actually observed
 * and what you can do about it. Mirrors the agents settings page, where a row
 * opens a sheet carrying the install detail rather than expanding the list.
 */

import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@renderer/lib/ui/button';
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

/** What one step observed, plus its failure detail. */
function StepDetail({
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
  const badge = stepBadge(step);
  // Only offer the GitHub sign-in once gh itself is there — the device flow
  // runs `gh` on the host, so offering it before the CLI exists sends the user
  // into a failure that says nothing about the real problem.
  const canSignIn = step.kind === 'gh-auth' && step.state !== 'satisfied' && !isBlockedByDep(step);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-sm">
            {step.name}
            {step.optional && (
              <span className="rounded-sm border border-border px-1 text-[10px] text-foreground-muted">
                optional
              </span>
            )}
          </span>
          <span className="text-xs text-foreground-muted">
            {step.state === 'satisfied' && step.version
              ? `Found ${step.version}`
              : outcomeLabel(step.outcome)}
          </span>
        </div>
        <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
      </div>

      {step.state === 'failed' && step.error && (
        <p className="text-destructive text-xs">{step.error}</p>
      )}
      {step.state === 'failed' && step.output && <FailureOutput output={step.output} />}

      {(canSignIn || canSkip(step)) && (
        <div className="flex items-center gap-2 pt-1">
          {canSignIn && (
            <Button size="sm" onClick={onAuthenticate}>
              {step.state === 'failed' && step.error?.includes('read:packages')
                ? 'Re-authenticate'
                : 'Sign in'}
            </Button>
          )}
          {canSkip(step) && (
            <Button size="sm" variant="ghost" disabled={skipping} onClick={onSkip}>
              {skipping ? 'Skipping…' : 'Skip this step'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** A gh-auth step whose own dependency has not been satisfied yet. */
function isBlockedByDep(step: HostSetupStep): boolean {
  return step.state === 'blocked' || step.state === 'pending';
}

export type SheetTarget =
  | { kind: 'prerequisite'; step: HostSetupStep }
  | { kind: 'agent-type'; row: AgentTypeRow };

export function SetupDetailSheet({
  target,
  onClose,
  onSkip,
  skippingStepId,
  onAuthenticate,
}: {
  target: SheetTarget | null;
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
            <SheetHeader
              label={target.kind === 'agent-type' ? target.row.name : target.step.name}
            />
            <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-6">
              {target.kind === 'prerequisite' ? (
                <StepDetail
                  step={target.step}
                  onSkip={() => onSkip(target.step.id)}
                  skipping={skippingStepId === target.step.id}
                  onAuthenticate={onAuthenticate}
                />
              ) : (
                <AgentTypeDetail
                  row={target.row}
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
  onSkip,
  skippingStepId,
  onAuthenticate,
}: {
  row: AgentTypeRow;
  onSkip: (stepId: string) => void;
  skippingStepId: string | null;
  onAuthenticate: () => void;
}) {
  const badge = agentTypeBadge(row);
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-foreground-muted">
          An agent type is usable once its CLI is installed <em>and</em> its Switch connector is set
          up. Without the connector it starts with no Switch tools.
        </p>
        <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>
      </div>
      <StepDetail
        step={row.cli}
        onSkip={() => onSkip(row.cli.id)}
        skipping={skippingStepId === row.cli.id}
        onAuthenticate={onAuthenticate}
      />
      {row.plugin && (
        <StepDetail
          step={row.plugin}
          onSkip={() => onSkip(row.plugin!.id)}
          skipping={skippingStepId === row.plugin.id}
          onAuthenticate={onAuthenticate}
        />
      )}
    </>
  );
}
