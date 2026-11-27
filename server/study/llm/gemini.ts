import type { ModelInfo } from "../../../shared/study/models.js";
import type { RunOpts } from "../claude.js";
import { bareSchema, maxTokensFor, systemText, type Turn } from "./request.js";
import type { Adapter } from "./stream.js";
import { normalizeGemini } from "./usage.js";

/* ── Google Gemini: streamGenerateContent over SSE (design-models §7.4, WP9) ──
 *
 * POST https://generativelanguage.googleapis.com/v1beta/models/<id>:streamGenerateContent?alt=sse
 * with the key in the x-goog-api-key header (never in the URL, so no log of
 * a link holds it). The system blocks are systemInstruction; the messages
 * are contents (an assistant's turn is role "model"; pictures inlineData,
 * base64); effort is thinkingConfig.thinkingLevel; max_tokens is
 * maxOutputTokens (thinking shares it); a JSON schema is responseMimeType
 * application/json with responseJsonSchema.
 *
 * Each event is one GenerateContentResponse: the candidate's text parts
 * (thought parts are skipped: they are not asked for), its finishReason at
 * the end, usageMetadata (the last one counts; thoughtsTokenCount is output),
 * promptFeedback.blockReason when the prompt itself was blocked.
 */

export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

/** The end of a candidate, as run() names it. */
export function finishOf(reason: string, chars: number): string {
  switch (reason) {
    case "STOP":
      return "end_turn";
    case "MAX_TOKENS":
      return "max_tokens";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
    case "IMAGE_SAFETY":
      return "refusal";
    default:
      return chars > 0 ? "end_turn" : "error";
  }
}

/** The request's body (pure; the tests compare it). */
export function geminiBody(o: Pick<RunOpts, "system" | "effort" | "maxTokens" | "format">, m: ModelInfo, turns: Turn[]): Record<string, unknown> {
  const level = m.effort ? m.effort[o.effort] : undefined;
  const system = systemText(o.system);
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: turns.map((t) => ({
      role: t.role === "assistant" ? "model" : "user",
      parts: t.parts.map((p) => (p.kind === "text" ? { text: p.text } : { inlineData: { mimeType: p.mime, data: p.data } })),
    })),
    generationConfig: {
      maxOutputTokens: maxTokensFor(o, m),
      ...(level !== undefined ? { thinkingConfig: { thinkingLevel: level } } : {}),
      ...(o.format ? { responseMimeType: "application/json", responseJsonSchema: bareSchema(o.format.schema) } : {}),
    },
  };
}

type Chunk = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  usageMetadata?: unknown;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

export const geminiAdapter: Adapter = {
  provider: "google",
  request(o, m, turns, key) {
    return { url: `${GEMINI_BASE}${encodeURIComponent(m.apiId)}:streamGenerateContent?alt=sse`, headers: { "x-goog-api-key": key }, body: geminiBody(o, m, turns) };
  },
  read(ev, feed) {
    let d: Chunk;
    try {
      d = JSON.parse(ev.data) as Chunk;
    } catch {
      return;
    }
    if (d.error) {
      feed.fail(d.error.message ?? "error");
      return;
    }
    const c = d.candidates?.[0];
    for (const p of c?.content?.parts ?? []) if (!p.thought && typeof p.text === "string") feed.text(p.text);
    const ends = Boolean(c?.finishReason) || Boolean(d.promptFeedback?.blockReason);
    if (d.usageMetadata) feed.usage(normalizeGemini(d.usageMetadata), ends);
    if (d.promptFeedback?.blockReason) feed.stop("refusal");
    else if (c?.finishReason) feed.stop(finishOf(c.finishReason, feed.chars()));
  },
  errorOf(body) {
    try {
      const j = JSON.parse(body) as { error?: { message?: string; status?: string } } | Array<{ error?: { message?: string } }>;
      const e = Array.isArray(j) ? j[0]?.error : j.error;
      return e?.message ?? "error";
    } catch {
      return body.slice(0, 200) || "error";
    }
  },
};
