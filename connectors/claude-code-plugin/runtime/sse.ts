// CANONICAL SOURCE — copied verbatim into switchdash.
//
// The agent bridge's SSE framing is implemented twice, because the two clients
// are separate deployables: this runtime ships inside the Claude Code plugin
// (standalone, one dependency, run straight from a plugin cache) and switchdash
// is an Electron monorepo. Neither can import from the other, and there is no
// published package to share yet.
//
// So it is copied, and the copy is checked. `sse-parity.test.ts` in switchdash
// reads both files and fails if they differ, naming this one as the original.
// Edit here, then copy to:
//
//   dash/apps/switchdash-desktop/src/main/core/switch-rooms/sse.ts
//
// Keep this file free of imports and of anything specific to either host: it is
// the wire format and nothing else. Reporting, reconnection, heartbeats and
// cursors belong to the caller, which is where the two clients legitimately
// differ.

export type SseFrame = { event: string; id?: string; data: Record<string, unknown> }

/** Parse an SSE byte stream into frames, ending when the stream or signal does. */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<SseFrame> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) return
      buffered += decoder.decode(value, { stream: true })

      let split: number
      while ((split = buffered.indexOf('\n\n')) !== -1) {
        const raw = buffered.slice(0, split)
        buffered = buffered.slice(split + 2)

        let event = 'message'
        let id: string | undefined
        const dataLines: string[] = []
        for (const line of raw.split('\n')) {
          // A comment line is the server's keepalive: it stops proxies timing
          // the stream out for idleness and carries nothing.
          if (line.startsWith(':')) continue
          if (line.startsWith('event: ')) event = line.slice(7)
          else if (line.startsWith('id: ')) id = line.slice(4)
          else if (line.startsWith('data: ')) dataLines.push(line.slice(6))
        }
        if (!dataLines.length) continue
        // A frame we cannot parse is a frame we have lost. Surface it rather
        // than skipping quietly; the caller decides how loud to be.
        yield { event, id, data: JSON.parse(dataLines.join('\n')) }
      }
    }
  } finally {
    void reader.cancel().catch(() => {})
  }
}
