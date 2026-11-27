import type { ModelInfo } from "../../../shared/study/models.js";
import type { RunOpts } from "../claude.js";
import { bareSchema, maxTokensFor, systemText, type Turn } from "./request.js";
import type { Adapter } from "./stream.js";
import { normalizeOpenAI } from "./usage.js";

/* ── OpenAI: the Responses API, streamed (design-models §7.4, WP9) ──
 *
 * POST https://api.openai.com/v1/responses with stream: true and store: false
 * (OpenAI keeps no copy of the response for later retrieval). The system
 * blocks are `instructions`; the messages are `input` (input_text and
 * input_image as a base64 data URL; an assistant's turn is output_text);
 * effort is reasoning.effort; max_tokens is max_output_tokens (thinking
 * shares it); a JSON schema is text.format json_schema, strict when the
 * schema meets strict mode's rules (every property required, no keyword it
 * refuses), else best effort.
 *
 * Events read: response.created (the call began), response.output_text.delta
 * (text), response.refusal.delta (a refusal), response.completed (usage,
 * the end), response.incomplete (max_output_tokens: cut; content_filter:
 * refused), response.failed and error.
 */

export const OPENAI_URL = "https://api.openai.com/v1/responses";

/** Keywords strict structured outputs refuse. */
const NOT_STRICT = new Set(["default", "if", "then", "else", "not", "oneOf", "allOf", "patternProperties", "dependentRequired", "dependentSchemas", "unevaluatedProperties", "propertyNames", "$ref", "$defs", "definitions"]);

/** The schema for strict mode (every object closed), or null when it cannot be strict. */
export function strictSchema(schema: Record<string, unknown>): Record<string, unknown> | null {
  let ok = true;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const src = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (NOT_STRICT.has(k)) ok = false;
      out[k] = k === "properties" && v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([p, s]) => [p, walk(s)])) : walk(v);
    }
    if (src.type === "object" || src.properties) {
      const props = Object.keys((src.properties ?? {}) as object);
      const req = Array.isArray(src.required) ? (src.required as string[]) : [];
      if (props.some((p) => !req.includes(p))) ok = false;
      if (src.additionalProperties !== undefined && src.additionalProperties !== false) ok = false;
      out.additionalProperties = false;
    }
    return out;
  };
  const out = walk(bareSchema(schema)) as Record<string, unknown>;
  return ok ? out : null;
}

function inputOf(turns: Turn[]): unknown[] {
  return turns.map((t) => ({
    role: t.role,
    content: t.parts.map((p) =>
      p.kind === "text"
        ? { type: t.role === "assistant" ? "output_text" : "input_text", text: p.text }
        : { type: "input_image", image_url: `data:${p.mime};base64,${p.data}`, detail: "high" },
    ),
  }));
}

/** The request's body (pure; the tests compare it). */
export function openaiBody(o: Pick<RunOpts, "system" | "effort" | "maxTokens" | "format">, m: ModelInfo, turns: Turn[]): Record<string, unknown> {
  const strict = o.format ? strictSchema(o.format.schema) : null;
  const effort = m.effort ? m.effort[o.effort] : undefined;
  return {
    model: m.apiId,
    instructions: systemText(o.system),
    input: inputOf(turns),
    stream: true,
    store: false,
    max_output_tokens: maxTokensFor(o, m),
    ...(effort !== undefined ? { reasoning: { effort } } : {}),
    ...(o.format ? { text: { format: { type: "json_schema", name: "output", schema: strict ?? bareSchema(o.format.schema), strict: strict !== null } } } : {}),
  };
}

type Ev = {
  type?: string;
  delta?: string;
  message?: string;
  error?: { message?: string } | null;
  response?: { status?: string; usage?: unknown; incomplete_details?: { reason?: string } | null; error?: { message?: string } | null };
};

export const openaiAdapter: Adapter = {
  provider: "openai",
  request(o, m, turns, key) {
    return { url: OPENAI_URL, headers: { authorization: `Bearer ${key}` }, body: openaiBody(o, m, turns) };
  },
  read(ev, feed) {
    let d: Ev;
    try {
      d = JSON.parse(ev.data) as Ev;
    } catch {
      return; // not JSON (a keep-alive)
    }
    const type = d.type ?? ev.event ?? "";
    switch (type) {
      case "response.output_text.delta":
        feed.text(typeof d.delta === "string" ? d.delta : "");
        return;
      case "response.refusal.delta":
      case "response.refusal.done":
        feed.stop("refusal");
        return;
      case "response.completed":
        if (d.response?.usage) feed.usage(normalizeOpenAI(d.response.usage), true);
        feed.stop(feed.stopped() === "refusal" ? "refusal" : "end_turn");
        return;
      case "response.incomplete": {
        if (d.response?.usage) feed.usage(normalizeOpenAI(d.response.usage), true);
        const why = d.response?.incomplete_details?.reason;
        feed.stop(why === "content_filter" ? "refusal" : "max_tokens");
        return;
      }
      case "response.failed":
        if (d.response?.usage) feed.usage(normalizeOpenAI(d.response.usage), true);
        feed.fail(d.response?.error?.message ?? "the response failed");
        return;
      case "error":
        feed.fail(d.message ?? d.error?.message ?? "error");
        return;
    }
  },
  errorOf(body) {
    try {
      const j = JSON.parse(body) as { error?: { message?: string; code?: string } };
      return j.error?.message ?? j.error?.code ?? "error";
    } catch {
      return body.slice(0, 200) || "error";
    }
  },
};
