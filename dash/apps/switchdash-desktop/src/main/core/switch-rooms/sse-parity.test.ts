import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSse, type SseFrame } from './sse';

/**
 * The agent bridge's SSE framing is implemented on two clients that cannot
 * import from each other — the plugin runtime is a standalone bun script in a
 * plugin cache, switchdash is an Electron monorepo — so the parser is copied.
 *
 * Copies rot silently. These tests make that loud in two ways: the parser's
 * *behaviour* is pinned by fixtures, and the copy is compared to its original
 * byte for byte. Behaviour is tested once because identity guarantees the other
 * side behaves the same; without the identity check, testing one would prove
 * nothing about the other.
 *
 * This has already happened once on this branch — heartbeat backoff was fixed
 * on switchdash's side only, because that is where the test was.
 */

const CANONICAL = path.resolve(
  __dirname,
  '../../../../../../../connectors/claude-code-plugin/runtime/sse.ts'
);
const COPY = path.join(__dirname, 'sse.ts');

/**
 * Everything below the header comment, normalised for formatting.
 *
 * The two files live in repos with different formatters — switchdash's adds
 * semicolons and drops trailing commas, the plugin's does neither — so raw
 * byte equality would fail on every `format` run and get switched off within a
 * week. Whitespace, semicolons and trailing commas are stripped; anything that
 * changes what the code *does* still shows up.
 */
function body(source: string): string {
  const start = source.indexOf('export type SseFrame');
  if (start === -1) throw new Error('sse.ts no longer starts with `export type SseFrame`');
  return source
    .slice(start)
    .replace(/\/\/.*$/gm, '')
    .replace(/,(\s*[)\]}])/g, '$1')
    .replace(/;/g, '')
    .replace(/\s+/g, '');
}

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function parse(chunks: string[]): Promise<SseFrame[]> {
  const frames: SseFrame[] = [];
  for await (const frame of readSse(stream(chunks), new AbortController().signal)) {
    frames.push(frame);
  }
  return frames;
}

describe('the SSE parser copy has not drifted from its original', () => {
  it('matches the canonical file once formatting is normalised away', () => {
    expect(fs.existsSync(CANONICAL), `canonical source missing at ${CANONICAL}`).toBe(true);

    const canonical = body(fs.readFileSync(CANONICAL, 'utf8'));
    const copy = body(fs.readFileSync(COPY, 'utf8'));

    // If this fails, one side was edited. Copy the canonical file over the
    // copy — do not hand-reconcile them, that is how they drifted before.
    expect(copy, `copy the canonical file: ${CANONICAL} -> ${COPY}`).toBe(canonical);
  });
});

describe('SSE framing', () => {
  it('parses event, id and data', async () => {
    const frames = await parse(['id: 7\nevent: message\ndata: {"body":"hi"}\n\n']);
    expect(frames).toEqual([{ event: 'message', id: '7', data: { body: 'hi' } }]);
  });

  it('defaults the event name to message when absent', async () => {
    const frames = await parse(['data: {"a":1}\n\n']);
    expect(frames[0].event).toBe('message');
  });

  it('leaves id undefined when the server sends none', async () => {
    // Control frames carry no sequence — treating a missing id as 0 would drag
    // the cursor backwards and replay the whole buffer on reconnect.
    const frames = await parse(['event: connection_state\ndata: {"rooms":[]}\n\n']);
    expect(frames[0].id).toBeUndefined();
  });

  it('skips keepalive comments without emitting a frame', async () => {
    const frames = await parse([': keepalive\n\n', 'event: gap\ndata: {"from_sequence":3}\n\n']);
    expect(frames).toHaveLength(1);
    expect(frames[0].event).toBe('gap');
  });

  it('reassembles a frame split across chunk boundaries', async () => {
    // The network splits wherever it likes; a frame torn mid-JSON must not be
    // dropped or parsed twice.
    const frames = await parse(['id: 1\nevent: mes', 'sage\ndata: {"bo', 'dy":"split"}\n\n']);
    expect(frames).toEqual([{ event: 'message', id: '1', data: { body: 'split' } }]);
  });

  it('emits several frames arriving in one chunk', async () => {
    const frames = await parse([
      'id: 1\nevent: message\ndata: {"n":1}\n\nid: 2\nevent: message\ndata: {"n":2}\n\n',
    ]);
    expect(frames.map((f) => f.data.n)).toEqual([1, 2]);
  });

  it('joins multi-line data fields', async () => {
    const frames = await parse(['event: message\ndata: {"a":\ndata: 1}\n\n']);
    expect(frames[0].data).toEqual({ a: 1 });
  });

  it('ignores a frame with no data lines', async () => {
    const frames = await parse(['event: message\nid: 4\n\n']);
    expect(frames).toEqual([]);
  });

  it('throws on unparseable JSON rather than skipping it', async () => {
    // A frame we cannot read is a frame we have lost. Silently dropping it
    // would advance nothing and hide the loss.
    await expect(parse(['event: message\ndata: {not json}\n\n'])).rejects.toThrow();
  });

  it('stops when the signal aborts', async () => {
    const abort = new AbortController();
    abort.abort();
    const frames: SseFrame[] = [];
    for await (const frame of readSse(stream(['data: {"a":1}\n\n']), abort.signal)) {
      frames.push(frame);
    }
    expect(frames).toEqual([]);
  });
});
