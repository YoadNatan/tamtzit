/* ── Release flags (spec §2.10, §5.7; §12.2.2) ──
 * The app's VITE_STUDY_* flags are read here, through the pure table in
 * shared/study/flags.ts (which /api/study/health also reads, so its
 * schemaOk asks for what this build needs). They are off until
 * Yoad sets them to "1" in Vercel and redeploys (VITE_ values are compiled
 * into the build). They only show or hide screens: what the database and
 * the functions accept is decided on the server (the key, the budget and the
 * switches `recordings`, `exams`, `bank` and `pulse`), so a flag turned off
 * never leaves a flow open there (review M10). The approved phases turn them
 * on release by release (§12.7.6). */

import { flagsFrom, requiredSchema, type Flags } from "../../../shared/study/flags";

export { ENDS, flagsFrom, requiredSchema, type Ends, type Flags } from "../../../shared/study/flags";

export const flags: Flags = flagsFrom((import.meta.env ?? {}) as Record<string, unknown>);

export const REQUIRED_SCHEMA: Record<string, number> = requiredSchema(flags);

/** "≈ ₪" beside spend figures, labelled "בערך"; Yoad updates it. */
export const ILS_PER_USD = 3.65;

/** The service that sends sign-in codes, as the privacy note names it (§6.2,
 *  its account line, shown with `account`). Yoad writes its name here when
 *  D18 is decided (for example "Resend"), before VITE_STUDY_ACCOUNT goes on;
 *  until then the note says "ספק המייל". */
export const EMAIL_PROVIDER = "ספק המייל";
