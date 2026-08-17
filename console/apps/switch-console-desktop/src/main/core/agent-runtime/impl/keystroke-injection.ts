import { getPlugin } from '@main/core/providers/plugin-registry';
import type { Pty } from '@main/core/pty/pty';
import { log } from '@main/lib/logger';
import type { Session } from '@shared/core/sessions/sessions';
import { buildPromptInjectionPayload } from '@shared/prompt-injection';

// Inject only after the TUI has produced output and stayed idle for a beat;
// fixed delays race the agent's startup (auth, sync, model load).
const QUIET_PERIOD_MS = 800;
const MAX_WAIT_MS = 15_000;

export function scheduleInitialPromptInjection(args: {
  pty: Pty;
  session: Session;
  initialPrompt: string | undefined;
  isResuming: boolean;
  /**
   * Called once the session's own prompt is in and the pane is free for anyone
   * else to type into — immediately when there is no prompt to deliver. Room
   * messages wait on this: delivered any earlier they land in a TUI that is
   * still booting, or in the middle of the prompt being typed.
   */
  onOpenForInjection: () => void;
}): void {
  if (args.isResuming) {
    args.onOpenForInjection();
    return;
  }
  if (!args.initialPrompt?.trim()) {
    args.onOpenForInjection();
    return;
  }

  const plugin = getPlugin(args.session.providerId);
  const promptDelivery = plugin.capabilities.prompt;
  if (promptDelivery.kind !== 'keystroke') {
    args.onOpenForInjection();
    return;
  }

  const submitSequence = promptDelivery.submitSequence ?? '\r';
  const submitDelayMs = promptDelivery.submitDelayMs;

  const payload = buildPromptInjectionPayload(args.initialPrompt);

  let injected = false;
  let sawAnyOutput = false;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;

  const inject = () => {
    if (injected) return;
    injected = true;
    if (quietTimer) clearTimeout(quietTimer);
    clearTimeout(maxWaitTimer);
    try {
      if (submitDelayMs) {
        args.pty.write(payload);
        // Opened after the submit, not after the text: in between, the prompt
        // is sitting unsent in the composer and anything else typed would be
        // appended to it and sent as one.
        setTimeout(() => {
          args.pty.write(submitSequence);
          args.onOpenForInjection();
        }, submitDelayMs);
        return;
      }
      args.pty.write(`${payload}${submitSequence}`);
      args.onOpenForInjection();
    } catch (error) {
      log.warn('AgentRuntime: failed to inject initial prompt', {
        providerId: args.session.providerId,
        sessionId: args.session.id,
        error: String(error),
      });
      // The pane is no worse off for a write that failed, and holding the gate
      // shut would strand every room message for the life of the session.
      args.onOpenForInjection();
    }
  };

  const maxWaitTimer = setTimeout(inject, MAX_WAIT_MS);

  args.pty.onData(() => {
    if (injected) return;
    sawAnyOutput = true;
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(inject, QUIET_PERIOD_MS);
  });

  args.pty.onExit(() => {
    const promptWasInjected = injected;
    injected = true;
    if (quietTimer) clearTimeout(quietTimer);
    clearTimeout(maxWaitTimer);
    if (!promptWasInjected) {
      log.warn('AgentRuntime: PTY exited before initial prompt could be injected', {
        providerId: args.session.providerId,
        sessionId: args.session.id,
        sawAnyOutput,
      });
    }
  });
}
