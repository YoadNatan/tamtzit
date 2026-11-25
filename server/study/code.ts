/* The personal code (docs/study/personal-code.md, SQL section I).
 *
 * POST /api/study/code  { code }   (no member token)
 *
 * A member's personal code brings back the same member on this device: the
 * same anonymous auth user. The server
 *   1. asks study_code_redeem (the server key, and the caller's address as
 *      Vercel saw it, for the limit on wrong tries) for a one-time address
 *      and password on the code's user;
 *   2. signs in with them at once (Auth's password sign-in), so they never
 *      reach a browser;
 *   3. calls study_code_finish as the new session, which puts the user back
 *      as it was (no address, no password, still anonymous). A failure here
 *      is only logged: the SQL's sweep puts it back within 5 minutes;
 *   4. answers 200 { access_token, refresh_token, expires_at, user_id }.
 *
 * Errors: 400 a missing or overlong code; 415 a body that is not
 * application/json (a cross-site form or text/plain post); 401 "code not found"; 429 "too
 * many tries"; 503 "codes off" (the switch, the SQL not run yet, or Auth's
 * email sign-in off); 502 "sign-in failed"; 500 "server".
 * Nothing secret is logged: a line is the status and the error's code, never
 * the body, the personal code, the one-time values or the tokens. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { json, keyed, serverClient, tokenClient } from "./study.js";

/** Longer than any code, link or WhatsApp message carrying one. */
export const CODE_MAX = 200;

/** What the handler needs from Supabase, injected by the tests. */
export type CodeDeps = {
  /** The anon key, no session: the redeem RPC and the password sign-in. */
  server: () => Pick<SupabaseClient, "rpc" | "auth">;
  /** A client calling as the just-signed-in session. */
  as: (accessToken: string) => Pick<SupabaseClient, "rpc">;
  log: (line: string) => void;
};

const realDeps: CodeDeps = {
  server: serverClient,
  as: tokenClient,
  log: (line) => console.error(line),
};

/** The caller's address: x-real-ip, which Vercel sets and overwrites, else
 *  the first x-forwarded-for entry; "" when neither is there. */
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  return (headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
}

type Redeemed = { email: string; password: string };
type Failure = { status: number; error: string };

const fail = (status: number, error: string): Failure => ({ status, error });

async function redeem(deps: CodeDeps, code: string, ip: string): Promise<Redeemed | Failure> {
  let data: unknown;
  let error: { code?: string; message?: string } | null;
  try {
    ({ data, error } = await deps.server().rpc("study_code_redeem", keyed({ p_code: code, p_ip: ip })));
  } catch {
    // keyed() without STUDY_WORKER_KEY, or the network.
    return fail(500, "server");
  }
  if (error) {
    if (error.code === "PGRST202") return fail(503, "codes off"); // section I not run yet
    if (error.message === "forbidden") return fail(500, "forbidden");
    return fail(500, "server");
  }
  const r = (data ?? {}) as { error?: unknown; email?: unknown; password?: unknown };
  if (r.error === "code not found") return fail(401, "code not found");
  if (r.error === "too many tries") return fail(429, "too many tries");
  if (r.error === "codes off") return fail(503, "codes off");
  if (typeof r.email === "string" && typeof r.password === "string") return { email: r.email, password: r.password };
  return fail(500, "server");
}

type Session = { access_token: string; refresh_token: string; expires_at?: number; user: { id: string } };

export async function handleCode(req: Request, deps: CodeDeps = realDeps): Promise<Response> {
  const done = (status: number, body: Record<string, unknown>, code: string) => {
    deps.log(`study code: ${status} ${code}`);
    return json(status, body);
  };
  const failed = (f: Failure) => done(f.status, { error: f.error }, f.error);
  if (req.method !== "POST") return failed(fail(405, "POST only"));
  // JSON only: a page elsewhere can send a "simple" cross-site POST (text/plain,
  // no preflight) from its visitors' browsers and spend the limit on wrong
  // tries; application/json needs a preflight, which this endpoint never answers.
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) return failed(fail(415, "json only"));
  let code: unknown;
  try {
    code = ((await req.json()) as { code?: unknown } | null)?.code;
  } catch {
    return failed(fail(400, "bad json"));
  }
  if (typeof code !== "string" || !code.trim()) return failed(fail(400, "code missing"));
  if (code.length > CODE_MAX) return failed(fail(400, "code too long"));
  const ip = clientIp(req.headers);

  // Two rounds at most: another device redeeming the same code at the same
  // moment replaces this round's one-time password ("invalid_credentials").
  for (let round = 0; round < 2; round++) {
    const r = await redeem(deps, code, ip);
    if ("status" in r) return failed(r);
    let session: Session | null = null;
    let errCode = "";
    try {
      const s = await deps.server().auth.signInWithPassword({ email: r.email, password: r.password });
      session = (s.data?.session as Session | null) ?? null;
      errCode = s.error ? String((s.error as { code?: unknown }).code ?? s.error.status ?? "error") : "";
    } catch {
      errCode = "network";
    }
    if (!session) {
      if (errCode === "invalid_credentials" && round === 0) continue;
      if (errCode === "email_provider_disabled") return failed(fail(503, "codes off"));
      if (errCode === "over_request_rate_limit" || errCode === "429") return failed(fail(429, "too many tries"));
      deps.log(`study code: sign-in ${errCode || "no session"}`);
      return failed(fail(502, "sign-in failed"));
    }
    try {
      const { error } = await deps.as(session.access_token).rpc("study_code_finish");
      if (error) deps.log(`study code: finish failed ${error.code ?? ""}`.trim());
    } catch {
      deps.log("study code: finish failed network");
    }
    return done(
      200,
      { access_token: session.access_token, refresh_token: session.refresh_token, expires_at: session.expires_at ?? null, user_id: session.user.id },
      "ok",
    );
  }
  return failed(fail(502, "sign-in failed"));
}
