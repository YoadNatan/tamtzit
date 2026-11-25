/* ── The personal code (docs/study/personal-code.md; SQL section I) ──
 * A member's private code, kept (e.g. sent to oneself on WhatsApp), brings
 * back the same member on any phone or browser: the same name, progress,
 * answers and cards. 16 characters from 32 (no 0/O, no 1/I), shown as
 * XXXX-XXXX-XXXX-XXXX, and a link that carries it: <origin>/#k=<16>.
 *
 * Pure helpers here (a test runs them in Node); the calls are api.ts's
 * redeemPersonalCode, newPersonalCode, personalCodeStatus, personalCodeSeen
 * and issuePersonalCode, and the screens are features/account.tsx's. */

export const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const SYM = "[2-9A-HJ-NP-Z]";
const WHOLE = new RegExp(`^${SYM}{16}$`);

/** The 16 characters a text carries, upper case, or null: a plain code (any
 *  case, with spaces or dashes), a whole link (#k=…), or the WhatsApp
 *  message the code sheet sends. Wrong length or characters: null. */
export function parseCode(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const whole = text.replace(/[\s‐-―-]/g, "").toUpperCase();
  if (WHOLE.test(whole)) return whole;
  // A link: k=<16> after # or & or ?.
  const link = /[#&?]k=([0-9A-Za-z-]{16,19})(?![0-9A-Za-z])/.exec(text);
  if (link) {
    const c = link[1].replace(/-/g, "").toUpperCase();
    if (WHOLE.test(c)) return c;
  }
  // A message: four groups of four, apart from the words around them.
  const shown = new RegExp(`(?:^|[^0-9A-Za-z])(${SYM}{4})[-\\s]?(${SYM}{4})[-\\s]?(${SYM}{4})[-\\s]?(${SYM}{4})(?![0-9A-Za-z])`, "i").exec(text);
  if (shown) {
    const c = (shown[1] + shown[2] + shown[3] + shown[4]).toUpperCase();
    if (WHOLE.test(c)) return c;
  }
  return null;
}

/** Whether what was typed looks like the group's 6-character invite code
 *  (or its link), not a personal code. */
export function looksLikeGroupCode(raw: string | null | undefined): boolean {
  const text = (raw ?? "").trim();
  if (/[?&]join=[0-9A-Za-z]{6}\b/.test(text)) return true;
  return /^[0-9A-Za-z]{6}$/.test(text.replace(/[\s-]/g, ""));
}

/** XXXX-XXXX-XXXX-XXXX (from the 16 characters, or anything parseCode reads). */
export function formatCode(code: string): string {
  const c = parseCode(code) ?? code.replace(/[\s-]/g, "").toUpperCase();
  return c.match(/.{1,4}/g)?.join("-") ?? c;
}

/** ••••-••••-••••-H4NA: the code's last four, the rest hidden. */
export function maskCode(code: string): string {
  const c = parseCode(code) ?? "";
  return `••••-••••-••••-${c.slice(12) || "••••"}`;
}

/** The link that signs a device in with the code: <origin>/#k=<16>. In the
 *  fragment, so it never reaches a server log; never "#code=", which Auth's
 *  client would take for a sign-in callback. */
export function codeLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/#k=${parseCode(code) ?? code}`;
}

/** WhatsApp's own "send" page with the text filled in (to oneself or anyone). */
export function waLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** The message "שליחה לעצמי בוואטסאפ" sends. */
export function selfMessage(origin: string, code: string): string {
  return `הקוד האישי שלי בתמצית: ${formatCode(code)}\nכניסה בנגיעה: ${codeLink(origin, code)}\nלא להעביר לאף אחד.`;
}

/** The message the group's opener sends to the member. */
export function issuedMessage(origin: string, code: string, name: string): string {
  return `${name}, זה הקוד האישי החדש שלך בתמצית: ${formatCode(code)}\nכניסה בנגיעה: ${codeLink(origin, code)}`;
}

/** A #k= link opened on this page: its code (null when it is malformed), or
 *  null when there is none. The fragment leaves the address bar at once
 *  (history.replaceState), before anything else can read or share it. */
export function takeLinkCode(): { code: string | null } | null {
  let hash = "";
  try {
    hash = location.hash;
  } catch {
    return null;
  }
  const m = /^#(?:.*&)?k=([^&]*)/.exec(hash);
  if (!m) return null;
  try {
    history.replaceState(history.state, "", location.pathname + location.search);
  } catch {
    /* an old browser: the fragment stays, and is read once */
  }
  let raw = m[1];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* kept as it is */
  }
  return { code: parseCode(raw) };
}

/* ── This device's copy of the member's own code ──
 * "שלי" shows the code it made here ("הצגה"); a code made elsewhere, or
 * replaced since, is not shown. A personal entry (api.ts PERSONAL): it
 * leaves the device with its member. */
export const CODE_PREFIX = "study-code:";
export const LATER_PREFIX = "study-code-later:";
export const LATER_MS = 3 * 86_400_000;

export type CachedCode = { code: string; at: string };

export function cacheCode(userId: string, code: string, at = new Date().toISOString()): void {
  try {
    localStorage.setItem(CODE_PREFIX + userId, JSON.stringify({ code: parseCode(code) ?? code, at }));
  } catch {
    /* private mode: "שלי" says it is not on this device */
  }
}

export function cachedCode(userId: string): CachedCode | null {
  try {
    const v = JSON.parse(localStorage.getItem(CODE_PREFIX + userId) ?? "null") as Partial<CachedCode> | null;
    return v && typeof v.code === "string" && typeof v.at === "string" && parseCode(v.code) ? { code: v.code, at: v.at } : null;
  } catch {
    return null;
  }
}

/** Whether the device's copy is the code the server has now: made here no
 *  earlier than the status's date (a minute's grace for the two clocks). */
export function cacheFresh(cached: CachedCode | null, createdAt: string | null | undefined): boolean {
  if (!cached || !createdAt) return false;
  return Date.parse(cached.at) >= Date.parse(createdAt) - 1000 * 60;
}

/** "אחר כך" on the prompt for existing members: hidden for 3 days. */
export function laterNow(userId: string, now = Date.now()): void {
  try {
    localStorage.setItem(LATER_PREFIX + userId, String(now + LATER_MS));
  } catch {
    /* private mode: the prompt comes back next time */
  }
}

export function laterActive(userId: string, now = Date.now()): boolean {
  try {
    return Number(localStorage.getItem(LATER_PREFIX + userId) ?? 0) > now;
  } catch {
    return false;
  }
}

/* ── Whether the server offers codes (/api/study/health "codes") ── */
const ON_KEY = "study-codes-on";
let asked: Promise<boolean> | null = null;

/** Whether this device last heard that codes work (false when unknown). */
export function codesKnownOn(): boolean {
  try {
    return sessionStorage.getItem(ON_KEY) === "1";
  } catch {
    return false;
  }
}

/** Health's "codes", asked once a session (again after a failed ask). */
export function codesOn(): Promise<boolean> {
  if (!asked) {
    asked = import("./api")
      .then((m) => m.health())
      .then((h) => {
        if (!h) {
          asked = null;
          return codesKnownOn();
        }
        const on = h.codes === true;
        try {
          sessionStorage.setItem(ON_KEY, on ? "1" : "0");
        } catch {
          /* private mode */
        }
        return on;
      })
      .catch(() => {
        asked = null;
        return false;
      });
  }
  return asked;
}

/** Whether this page runs as the home-screen app (its own storage on iOS). */
export function standalone(): boolean {
  try {
    return (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia("(display-mode: standalone)").matches;
  } catch {
    return false;
  }
}

/* ── Copying, with the fallbacks in-app browsers need ── */

/** Copies text: the clipboard API, else a selected read-only field and
 *  execCommand("copy"). False when neither worked (the sheet then asks to
 *  select the code by hand). */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* refused: try the old way */
  }
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.readOnly = true;
    field.setAttribute("aria-hidden", "true");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    field.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    field.remove();
    return ok;
  } catch {
    return false;
  }
}
