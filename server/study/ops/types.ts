/* The /api/study/ai router's contract (spec §4.2; §12.2.4). Each package
 * fills its own op module: practice.ts (Q), cards.ts (C), collab.ts and
 * fixcheck.ts (K), wall.ts (J), pulse.ts (U), var.ts (V), extras.ts (E). */

/** The request body: `op` picks the op; the rest is the op's own. */
export type AiBody = { op?: string } & Record<string, unknown>;
/** One op: the request (for the member's token and its signal), the parsed
 *  body, and when the function started (for the op's deadline). */
export type Op = (req: Request, body: AiBody, started: number) => Promise<Response>;
