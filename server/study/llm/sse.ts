/* ── Server-sent events, read from a fetch body (design-models §7.4, D6) ──
 *
 * Both providers stream with SSE: OpenAI's Responses API names each event
 * (`event:` and a JSON `data:` with the same `type`), Gemini's
 * streamGenerateContent?alt=sse sends `data:` lines only. One event ends at
 * a blank line; several `data:` lines join with "\n"; a line starting with
 * ":" is a comment; "\r\n" and "\r" end lines too (the SSE standard).
 */

export type SseEvent = { event: string | null; data: string };

/** The events of a stream, in order, as they arrive. A last event without its
 *  blank line still counts. Errors of the body (an abort) are the caller's. */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let event: string | null = null;
  let data: string[] = [];
  const flush = (): SseEvent | null => {
    const out = data.length ? { event, data: data.join("\n") } : null;
    event = null;
    data = [];
    return out;
  };
  const line = (l: string): SseEvent | null => {
    if (l === "") return flush();
    if (l.startsWith(":")) return null;
    const i = l.indexOf(":");
    const field = i < 0 ? l : l.slice(0, i);
    let value = i < 0 ? "" : l.slice(i + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    return null;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buf += done ? dec.decode() : dec.decode(value, { stream: true });
      let m: RegExpExecArray | null;
      const eol = /\r\n|\r|\n/g;
      let from = 0;
      while ((m = eol.exec(buf))) {
        // A "\r" at the very end may be the first half of "\r\n": wait for more.
        if (m[0] === "\r" && m.index === buf.length - 1 && !done) break;
        const ev = line(buf.slice(from, m.index));
        from = m.index + m[0].length;
        if (ev) yield ev;
      }
      buf = buf.slice(from);
      if (done) {
        if (buf) {
          const ev = line(buf);
          if (ev) yield ev;
          buf = "";
        }
        const last = flush();
        if (last) yield last;
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
