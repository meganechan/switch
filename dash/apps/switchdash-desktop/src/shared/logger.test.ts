import { describe, expect, it, vi } from 'vitest';
import { createLogger, type LogSinkEntry } from './logger';

function collect() {
  const entries: LogSinkEntry[] = [];
  return { entries, sink: (entry: LogSinkEntry) => entries.push(entry) };
}

describe('createLogger levels', () => {
  it('records to the sink below the console level', () => {
    const { entries, sink } = collect();
    const log = createLogger({ envLevel: 'warn', sinkLevel: 'info', sink });

    log.info('boot complete');

    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe('info');
  });

  it('keeps the console quiet while the sink records', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { sink } = collect();
    const log = createLogger({ envLevel: 'warn', sinkLevel: 'info', sink });

    log.info('boot complete');

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('drops entries below the sink level', () => {
    const { entries, sink } = collect();
    const log = createLogger({ envLevel: 'warn', sinkLevel: 'info', sink });

    log.debug('noisy');

    expect(entries).toHaveLength(0);
  });

  it('always records errors regardless of level', () => {
    const { entries, sink } = collect();
    const log = createLogger({ envLevel: 'error', sinkLevel: 'error', sink });

    log.error('exploded');

    expect(entries).toHaveLength(1);
  });

  it('defaults the sink level to the console level when unset', () => {
    const log = createLogger({ envLevel: 'warn' });

    expect(log.sinkLevel).toBe('warn');
  });
});

describe('child loggers', () => {
  it('attaches bound context to every entry', () => {
    const { entries, sink } = collect();
    const log = createLogger({ envLevel: 'debug', sink }).child({ component: 'updater' });

    log.info('checking');

    expect(entries[0]?.context).toMatchObject({ component: 'updater' });
  });

  it('merges nested children, innermost winning', () => {
    const { entries, sink } = collect();
    const log = createLogger({ envLevel: 'debug', sink })
      .child({ component: 'updater', sessionId: 'session-1' })
      .child({ component: 'updater:download' });

    log.info('downloading');

    expect(entries[0]?.context).toMatchObject({
      component: 'updater:download',
      sessionId: 'session-1',
    });
  });

  it('does not mutate the parent logger', () => {
    const { entries, sink } = collect();
    const parent = createLogger({ envLevel: 'debug', sink });
    parent.child({ component: 'child-only' });

    parent.info('from parent');

    expect(entries[0]?.context?.component).toBeUndefined();
  });

  it('lets bound context override the ambient provider', () => {
    const { entries, sink } = collect();
    const log = createLogger({
      envLevel: 'debug',
      sink,
      contextProvider: () => ({ sessionId: 'ambient' }),
    }).child({ sessionId: 'bound' });

    log.info('hello');

    expect(entries[0]?.context?.sessionId).toBe('bound');
  });
});

describe('sink failures', () => {
  it('reports rather than swallows them', () => {
    const onSinkError = vi.fn();
    const log = createLogger({
      envLevel: 'debug',
      sink: () => {
        throw new Error('disk full');
      },
      onSinkError,
    });

    expect(() => log.info('hello')).not.toThrow();
    expect(onSinkError).toHaveBeenCalledOnce();
  });
});
