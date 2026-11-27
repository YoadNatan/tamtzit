import type { ModelInfo } from "../../../shared/study/models.js";
import type { RunOpts } from "../claude.js";
import { strictSchema } from "./openai.js";
import { bareSchema, maxTokensFor, systemText, type Turn } from "./request.js";
import type { Adapter } from "./stream.js";
import { normalizeChat } from "./usage.js";

/* ── OpenRouter: Chat Completions, streamed (design-models §7.4, WP10; OD22, D16) ──
 *
 * POST https://openrouter.ai/api/v1/chat/completions with stream: true and
 * stream_options.include_usage (the last chunk then carries the call's usage
 * and, with usage.include, its cost: without it a Chat Completions stream
 * reports no usage at all, D4). The DeepSeek, Qwen, Kimi and GLM models go
 * only this way, never to their makers' direct endpoints (OD22).
 *
 * Every request carries the provider preferences OD22 asks for:
 *   - zdr: true and data_collection: "deny": only hosts that keep nothing and
 *     train on nothing. Where no such host serves the model, OpenRouter
 *     refuses the request before anything is generated ($0, stop "error";
 *     in production D8 reruns it on the default);
 *   - ignore: the providers based in China (CHINA_HOSTS), so an open model
 *     runs on a host outside China. A model only its maker serves (the
 *     registry's `china: true`) goes without this list, and the screens say
 *     where it is processed (C43).
 *
 * The system blocks are one system message; the messages are user and
 * assistant turns (pictures as image_url data URLs, base64, never a link;
 * a model without vision fails before anything is sent); effort is
 * reasoning.effort, and its text is left out of the stream (reasoning
 * .exclude: it is billed as output, never shown); max_tokens is max_tokens
 * (thinking shares it); a JSON schema is response_format json_schema
 * (strict when the schema allows it), and its text is also put in the
 * system message, because a host may ignore response_format.
 *
 * Read: choices[0].delta.content (text), delta.refusal (a refusal),
 * finish_reason (stop, length, content_filter, error), the last chunk's
 * usage (Anthropic's shape through normalizeChat) and usage.cost (credits,
 * reported to the settle: the call costs the larger of it and the
 * registry's price, × the 5.5% fee), and an error object inside the stream.
 * "[DONE]" and OpenRouter's ": OPENROUTER PROCESSING" comments are skipped.
 */

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** OpenRouter's slugs for the providers based in China, left out of every
 *  request whose model a host outside China serves (OD22). The owner's
 *  OpenRouter account blocks the same list in its settings, as a second
 *  layer (RELEASE-Y2.md). */
export const CHINA_HOSTS: readonly string[] = [
  "deepseek",
  "alibaba",
  "moonshotai",
  "z-ai",
  "siliconflow",
  "baidu",
  "minimax",
  "stepfun",
  "tencent",
  "xiaomi",
  "bytedance",
  "baichuan",
];

/** The provider preferences every request carries (OD22). */
export function hostsOf(m: Pick<ModelInfo, "china">): Record<string, unknown> {
  return { data_collection: "deny", zdr: true, ...(m.china ? {} : { ignore: [...CHINA_HOSTS] }) };
}

function messagesOf(system: string, turns: Turn[], vision: boolean): unknown[] {
  const out: unknown[] = system ? [{ role: "system", content: system }] : [];
  for (const t of turns) {
    if (t.parts.some((p) => p.kind === "image") && !vision) throw new Error("no vision");
    const onlyText = t.parts.every((p) => p.kind === "text");
    out.push({
      role: t.role,
      content: onlyText
        ? t.parts.map((p) => (p.kind === "text" ? p.text : "")).join("\n\n")
        : t.parts.map((p) => (p.kind === "text" ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: `data:${p.mime};base64,${p.data}` } })),
    });
  }
  return out;
}

/** The request's body (pure; the tests compare it). */
export function compatBody(o: Pick<RunOpts, "system" | "effort" | "maxTokens" | "format">, m: ModelInfo, turns: Turn[]): Record<string, unknown> {
  const effort = m.effort ? m.effort[o.effort] : undefined;
  const schema = o.format ? bareSchema(o.format.schema) : null;
  const strict = o.format ? strictSchema(o.format.schema) : null;
  let system = systemText(o.system);
  if (schema) system = `${system}${system ? "\n\n" : ""}Answer with JSON only, matching this JSON schema:\n${JSON.stringify(schema)}`;
  return {
    model: m.apiId,
    messages: messagesOf(system, turns, m.vision),
    stream: true,
    stream_options: { include_usage: true },
    usage: { include: true },
    max_tokens: maxTokensFor(o, m),
    ...(effort !== undefined ? { reasoning: { effort, exclude: true } } : {}),
    ...(schema && m.json !== "prompt"
      ? m.json === "object"
        ? { response_format: { type: "json_object" } }
        : { response_format: { type: "json_schema", json_schema: { name: "output", strict: strict !== null, schema: strict ?? schema } } }
      : {}),
    provider: hostsOf(m),
  };
}

/** A choice's finish_reason, as run() names it. */
export function finishOfChat(reason: string): string {
  switch (reason) {
    case "stop":
    case "tool_calls":
    case "function_call":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      return "end_turn";
  }
}

type Chunk = {
  choices?: Array<{ delta?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }>;
  usage?: { cost?: unknown } & Record<string, unknown>;
  error?: { message?: string; code?: unknown } | null;
};

export const compatAdapter: Adapter = {
  provider: "openrouter",
  request(o, m, turns, key) {
    return { url: OPENROUTER_URL, headers: { authorization: `Bearer ${key}` }, body: compatBody(o, m, turns) };
  },
  read(ev, feed) {
    if (ev.data === "[DONE]") return;
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
    const c = d.choices?.[0];
    const text = c?.delta?.content;
    if (typeof text === "string") feed.text(text);
    if (c?.delta?.refusal) feed.stop("refusal");
    if (c?.finish_reason) {
      if (c.finish_reason === "error") {
        feed.fail("the model stopped with an error");
        return;
      }
      if (feed.stopped() !== "refusal") feed.stop(finishOfChat(c.finish_reason));
    }
    if (d.usage) {
      feed.usage(normalizeChat(d.usage), true);
      const cost = Number(d.usage.cost);
      if (Number.isFinite(cost) && cost > 0) feed.reported(cost);
    }
  },
  errorOf(body) {
    try {
      const j = JSON.parse(body) as { error?: { message?: string; code?: unknown } };
      return j.error?.message ?? "error";
    } catch {
      return body.slice(0, 200) || "error";
    }
  },
};
