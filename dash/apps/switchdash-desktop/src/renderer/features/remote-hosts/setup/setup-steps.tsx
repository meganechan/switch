/**
 * The visible setup sequence for one host (CHOO-1809).
 *
 * Every step renders its own state, its own error and its own command output.
 * The previous page showed a bare "Install failed" — and, when the failure came
 * back as a Result rather than a thrown error, showed nothing at all.
 */

import { CheckCircle2, ChevronRight, Circle, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';
import type { HostSetupStep } from '@shared/core/remote-hosts/setup';
import { canSkip, stepStatusLabel, stepTone, type StepTone } from './step-presentation';

const TONE_TEXT: Record<StepTone, string> = {
  done: 'text-green-500',
  busy: 'text-amber-500',
  failed: 'text-destructive',
  skipped: 'text-foreground-muted',
  waiting: 'text-foreground-muted',
  idle: 'text-foreground-muted',
};

function StepIcon({ tone }: { tone: StepTone }) {
  const className = cn('size-4 shrink-0', TONE_TEXT[tone]);
  switch (tone) {
    case 'done':
      return <CheckCircle2 className={className} />;
    case 'busy':
      return <Loader2 className={cn(className, 'animate-spin')} />;
    case 'failed':
      return <XCircle className={className} />;
    case 'skipped':
      return <MinusCircle className={className} />;
    case 'waiting':
      return <Circle className={className} />;
    case 'idle':
      return <Circle className={className} />;
  }
}

/**
 * A failed step's raw command output, collapsed by default. Hidden behind a
 * disclosure rather than dropped: it is usually the only thing that explains
 * *why* an install failed, but it is long enough to bury the rest of the page.
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
        <pre className="bg-background-subtle max-h-48 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap">
          {output}
        </pre>
      )}
    </div>
  );
}

export function SetupStepRow({
  step,
  isCurrent,
  onSkip,
  skipping,
  onAuthenticate,
}: {
  step: HostSetupStep;
  isCurrent: boolean;
  onSkip: () => void;
  skipping: boolean;
  /** Starts the interactive GitHub sign-in. Only meaningful for the gh-auth step. */
  onAuthenticate: () => void;
}) {
  const tone = stepTone(step);

  return (
    <li
      className={cn(
        'flex flex-col gap-2 rounded-md border px-3 py-2',
        isCurrent ? 'border-amber-500/50' : 'border-border',
        tone === 'failed' && 'border-destructive/50'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span className="pt-0.5">
            <StepIcon tone={tone} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-2 text-sm">
              {step.name}
              {step.optional && (
                <span className="rounded-sm border border-border px-1 text-[10px] text-foreground-muted">
                  optional
                </span>
              )}
            </span>
            <span className={cn('text-xs', TONE_TEXT[tone])}>{stepStatusLabel(step)}</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {step.kind === 'gh-auth' && step.state !== 'satisfied' && (
            <Button size="sm" onClick={onAuthenticate}>
              Sign in
            </Button>
          )}
          {canSkip(step) && (
            <Button size="sm" variant="ghost" disabled={skipping} onClick={onSkip}>
              {skipping ? 'Skipping…' : 'Skip'}
            </Button>
          )}
        </div>
      </div>

      {step.state === 'failed' && step.error && (
        <p className="text-destructive pl-6 text-xs">{step.error}</p>
      )}
      {step.state === 'failed' && step.output && (
        <div className="pl-6">
          <FailureOutput output={step.output} />
        </div>
      )}
    </li>
  );
}

export function SetupStepList({
  steps,
  currentStepId,
  onSkip,
  skippingStepId,
  onAuthenticate,
}: {
  steps: HostSetupStep[];
  currentStepId: string | null;
  onSkip: (stepId: string) => void;
  skippingStepId: string | null;
  onAuthenticate: () => void;
}) {
  if (steps.length === 0) {
    return (
      <p className="text-sm text-foreground-muted">
        No setup steps yet — prepare the host to work out what it needs.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-2">
      {steps.map((step) => (
        <SetupStepRow
          key={step.id}
          step={step}
          isCurrent={step.id === currentStepId}
          onSkip={() => onSkip(step.id)}
          skipping={skippingStepId === step.id}
          onAuthenticate={onAuthenticate}
        />
      ))}
    </ol>
  );
}
