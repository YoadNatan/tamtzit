/// <reference path="../env.d.ts" />
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelInfo } from "../../../shared/study/models.js";
import { estimateUsd, imageTokens } from "../budget.js";
import type { RunOpts } from "../claude.js";

/* ── One request, in the shape every adapter starts from (design-models §7.4, D18) ──
 *
 * run()'s request is Anthropic's (system blocks, messages with text and
 * image blocks, cache_control marks). An adapter reads it through here:
 *   - the system blocks as one text (cache_control is dropped: OpenAI and
 *     Gemini cache a repeated prefix by themselves);
 *   - each message's text and pictures, in order;
 *   - every picture inline as base64 (D18): a picture given as a link is
 *     fetched by the server, only from the study's own Supabase host, and
 *     its bytes are sent, so no provider ever gets a link to the group's
 *     storage, short or long;
 *   - max_tokens within the model's floor and cap (thinking shares it).
 */

export type Part = { kind: "text"; text: string } | { kind: "image"; mime: string; data: string };
export type Turn = { role: "user" | "assistant"; parts: Part[] };

/** A picture's bytes may be at most this large, and a request's pictures together this large. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES_BYTES = 18 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** The system blocks as one text. */
export function systemText(system: RunOpts["system"]): string {
  return system.map((b) => b.text).join("\n\n");
}

/** max_tokens as the model takes it: at least its floor (thinking shares it), at most its cap. */
export function maxTokensFor(o: Pick<RunOpts, "maxTokens">, m: Pick<ModelInfo, "maxOut" | "minMaxTokens">): number {
  return Math.min(m.maxOut, Math.max(o.maxTokens, m.minMaxTokens ?? 0));
}

/** The request's worst case on this model (as a reservation counts it): the
 *  floor of a call whose reservation was not passed in (D4). */
export function requestUsd(o: Pick<RunOpts, "system" | "messages" | "maxTokens" | "format">, m: Pick<ModelInfo, "id">): number {
  let chars = o.system.reduce((n, b) => n + b.text.length, 0) + (o.format ? JSON.stringify(o.format.schema).length : 0);
  let pictures = 0;
  for (const msg of o.messages) {
    if (typeof msg.content === "string") chars += msg.content.length;
    else
      for (const b of msg.content ?? []) {
        if (b.type === "text") chars += b.text.length;
        else if (b.type === "image") pictures += 1;
      }
  }
  return estimateUsd(m.id, chars, o.maxTokens, pictures * imageTokens());
}

/** The hosts a picture's link may be fetched from: the study's Supabase project. */
export function pictureHosts(env: Record<string, string | undefined> = process.env): Set<string> {
  const out = new Set<string>();
  for (const v of [env.VITE_STUDY_SUPABASE_URL, env.VITE_SUPABASE_URL]) {
    try {
      if (v) out.add(new URL(v).host);
    } catch {
      /* not a URL */
    }
  }
  return out;
}

export type Fetch = typeof globalThis.fetch;

/** A picture's bytes from its link (the study's own storage only), base64. */
async function fetchPicture(url: string, o: { fetch: Fetch; hosts: Set<string>; signal: AbortSignal }): Promise<{ mime: string; data: string; bytes: number }> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("picture: not a link");
  }
  if (u.protocol !== "https:" || !o.hosts.has(u.host)) throw new Error("picture: not the study's storage");
  const res = await o.fetch(u.toString(), { signal: o.signal, redirect: "error" });
  if (!res.ok) throw new Error(`picture: ${res.status}`);
  const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim().toLowerCase();
  if (!IMAGE_TYPES.has(mime)) throw new Error("picture: not an image");
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error("picture: too large");
  return { mime, data: base64Of(buf), bytes: buf.byteLength };
}

/** Bytes as base64 (btoa over chunks: no Node Buffer in the shared types). */
export function base64Of(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** The messages as turns of text and inline pictures. A picture that cannot
 *  be read fails the call before anything is sent (as a picture without a
 *  good link fails a part today). */
export async function turnsOf(messages: Anthropic.Beta.BetaMessageParam[], o: { fetch: Fetch; signal: AbortSignal; hosts?: Set<string> }): Promise<Turn[]> {
  const hosts = o.hosts ?? pictureHosts();
  let total = 0;
  const out: Turn[] = [];
  for (const msg of messages) {
    const parts: Part[] = [];
    if (typeof msg.content === "string") parts.push({ kind: "text", text: msg.content });
    else
      for (const b of msg.content ?? []) {
        if (b.type === "text") parts.push({ kind: "text", text: b.text });
        else if (b.type === "image") {
          const src = b.source as { type: string; url?: string; media_type?: string; data?: string };
          if (src.type === "base64" && typeof src.data === "string") {
            total += Math.ceil((src.data.length * 3) / 4);
            parts.push({ kind: "image", mime: src.media_type ?? "image/jpeg", data: src.data });
          } else if (src.type === "url" && typeof src.url === "string") {
            const p = await fetchPicture(src.url, { fetch: o.fetch, hosts, signal: o.signal });
            total += p.bytes;
            parts.push({ kind: "image", mime: p.mime, data: p.data });
          } else throw new Error("picture: unknown source");
          if (total > MAX_IMAGES_BYTES) throw new Error("picture: too many bytes");
        }
        // Other blocks (none in this app's requests) are left out.
      }
    out.push({ role: msg.role === "assistant" ? "assistant" : "user", parts });
  }
  return out;
}

/** The JSON schema without its "$schema" line (neither provider wants it). */
export function bareSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _drop, ...rest } = schema;
  void _drop;
  return rest;
}
