import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pty, PtyExitInfo } from '@main/core/pty/pty';
import type { Session } from '@shared/core/sessions/sessions';
import { scheduleInitialPromptInjection } from './keystroke-injection';

function makeSession(providerId: Session['providerId']): Session {
  const now = '2024-01-01T00:00:00.000Z';
  return {
    id: 'session-1',
    agentId: 'agent-1',
    providerId,
    title: '',
    shellId: 'system',
    status: 'in_progress',
    statusChangedAt: now,
    agentSessionId: null,
    isInitialSession: false,
    isPinned: false,
    autoApprove: false,
    createdAt: now,
    updatedAt: now,
  };
}

function makePty(): {
  pty: Pty;
  write: ReturnType<typeof vi.fn>;
  emitData: (chunk: string) => void;
  emitExit: (info?: PtyExitInfo) => void;
} {
  const write = vi.fn();
  let dataHandler: ((data: string) => void) | undefined;
  let exitHandler: ((info: PtyExitInfo) => void) | undefined;
  const pty: Pty = {
    write,
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (handler: (data: string) => void) => {
      dataHandler = handler;
    },
    onExit: (handler: (info: PtyExitInfo) => void) => {
      exitHandler = handler;
    },
  } as unknown as Pty;
  return {
    pty,
    write,
    emitData: (chunk) => dataHandler?.(chunk),
    emitExit: (info = { exitCode: 0, signal: undefined }) => exitHandler?.(info),
  };
}

let onOpenForInjection: ReturnType<typeof vi.fn<() => void>>;

describe('scheduleInitialPromptInjection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    onOpenForInjection = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('injects after PTY output goes quiet', () => {
    const { pty, write, emitData } = makePty();
    scheduleInitialPromptInjection({
      pty,
      session: makeSession('hermes'),
      initialPrompt: 'Fix the bug',
      isResuming: false,
      onOpenForInjection,
    });

    emitData('booting...');
    vi.advanceTimersByTime(200);
    emitData('still booting...');
    expect(write).not.toHaveBeenCalled();

    vi.advanceTimersByTime(900);
    expect(write).toHaveBeenCalledExactlyOnceWith('\x1b[200~Fix the bug \x1b[201~\r');
  });

  it('falls back to a max wait when no output ever arrives', () => {
    const { pty, write } = makePty();
    scheduleInitialPromptInjection({
      pty,
      session: makeSession('hermes'),
      initialPrompt: 'Fix the bug',
      isResuming: false,
      onOpenForInjection,
    });

    vi.advanceTimersByTime(15_000);
    expect(write).toHaveBeenCalledExactlyOnceWith('\x1b[200~Fix the bug \x1b[201~\r');
  });

  it('wraps multi-line prompts in bracketed paste sequences', () => {
    const { pty, write, emitData } = makePty();
    scheduleInitialPromptInjection({
      pty,
      session: makeSession('hermes'),
      initialPrompt: 'line one\nline two',
      isResuming: false,
      onOpenForInjection,
    });

    emitData('ready');
    vi.advanceTimersByTime(900);
    expect(write).toHaveBeenCalledExactlyOnceWith('\x1b[200~line one\nline two \x1b[201~\r');
  });

  it('does nothing for OpenCode because its initial prompt is passed with --prompt', () => {
    const { pty, write, emitData } = makePty();
    scheduleInitialPromptInjection({
      pty,
      session: makeSession('opencode'),
      initialPrompt: 'Fix the bug',
      isResuming: false,
      onOpenForInjection,
    });

    emitData('ready');
    vi.advanceTimersByTime(20_000);
    expect(write).not.toHaveBeenCalled();
  });

  it('does nothing for Grok because its initial prompt is passed as a positional arg', () => {
    const { pty, write, emitData } = makePty();
    scheduleInitialPromptInjection({
      pty,
      session: makeSession('grok'),
      initialPrompt: 'Fix the bug',
      isResuming: false,
      onOpenForInjection,
    });

    emitData('ready');
    vi.advanceTimersByTime(20_000);
    expect(write).not.toHaveBeenCalled();
  });

  it('does nothing for providers without keystroke injection', () => {
    const { pty, write, emitData } = makePty();
    scheduleInitialPromptInjection({
      pty,
      session: makeSession('claude'),
      initialPrompt: 'Fix the bug',
      isResuming: false,
      onOpenForInjection,
    });

    emitData('ready');
    vi.advanceTimersByTime(20_000);
    expect(write).not.toHaveBeenCalled();
  });

  it('skips when resuming an existing session', () => {
    const { pty, write, emitData } = makePty();
    scheduleInitialPromptInjection({
      pty,
      session: makeSession('hermes'),
      initialPrompt: 'Fix the bug',
      isResuming: true,
      onOpenForInjection,
    });

    emitData('ready');
    vi.advanceTimersByTime(20_000);
    expect(write).not.toHaveBeenCalled();
  });

  it('skips when the prompt is empty or whitespace', () => {
    const { pty, write, emitData } = makePty();
    scheduleInitialPromptInjection({
      pty,
      session: makeSession('hermes'),
      initialPrompt: '   ',
      isResuming: false,
      onOpenForInjection,
    });

    emitData('ready');
    vi.advanceTimersByTime(20_000);
    expect(write).not.toHaveBeenCalled();
  });

  it('cancels injection when the PTY exits before idle', () => {
    const { pty, write, emitData, emitExit } = makePty();
    scheduleInitialPromptInjection({
      pty,
      session: makeSession('hermes'),
      initialPrompt: 'Fix the bug',
      isResuming: false,
      onOpenForInjection,
    });

    emitData('starting');
    emitExit();
    vi.advanceTimersByTime(20_000);
    expect(write).not.toHaveBeenCalled();
  });
});

/**
 * When the pane becomes free for anything else to type into (CHOO-2173).
 *
 * A session auto-started to answer a room message races two writers at the same
 * terminal: its own opening prompt, held back until the TUI is ready, and the
 * room message its connection has already received. Nothing sequenced them, and
 * a message typed into a booting TUI — or onto the end of the unsent opening
 * prompt — reads as a message that never arrived.
 */
describe('the gate on typing into a starting session', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    onOpenForInjection = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays shut while the opening prompt is still waiting for the TUI', () => {
    const { pty, emitData } = makePty();
    scheduleInitialPromptInjection({
      pty,
      session: makeSession('hermes'),
      initialPrompt: 'connect to switch room r-1',
      isResuming: false,
      onOpenForInjection,
    });

    emitData('booting...');
    vi.advanceTimersByTime(200);

    expect(onOpenForInjection).not.toHaveBeenCalled();
  });

  it('opens as the opening prompt goes in, and not before', () => {
    const { pty, write, emitData } = makePty();
    scheduleInitialPromptInjection({
      pty,
      session: makeSession('hermes'),
      initialPrompt: 'connect to switch room r-1',
      isResuming: false,
      onOpenForInjection,
    });

    emitData('ready');
    vi.advanceTimersByTime(200);
    expect(write).not.toHaveBeenCalled();
    expect(onOpenForInjection).not.toHaveBeenCalled();

    vi.advanceTimersByTime(800);

    expect(write).toHaveBeenCalled();
    expect(onOpenForInjection).toHaveBeenCalledTimes(1);
  });

  it('opens straight away when there is no opening prompt to wait for', () => {
    const { pty } = makePty();
    scheduleInitialPromptInjection({
      pty,
      session: makeSession('hermes'),
      initialPrompt: undefined,
      isResuming: false,
      onOpenForInjection,
    });

    expect(onOpenForInjection).toHaveBeenCalledTimes(1);
  });

  it('opens straight away when resuming, which sends no prompt', () => {
    const { pty } = makePty();
    scheduleInitialPromptInjection({
      pty,
      session: makeSession('hermes'),
      initialPrompt: 'Fix the bug',
      isResuming: true,
      onOpenForInjection,
    });

    expect(onOpenForInjection).toHaveBeenCalledTimes(1);
  });

  it('opens straight away for a provider that takes no keystrokes', () => {
    // Nothing is going to be typed here, so holding the gate shut would strand
    // every room message for the life of the session.
    const { pty } = makePty();
    scheduleInitialPromptInjection({
      pty,
      session: makeSession('claude'),
      initialPrompt: 'Fix the bug',
      isResuming: false,
      onOpenForInjection,
    });

    expect(onOpenForInjection).toHaveBeenCalledTimes(1);
  });
});
