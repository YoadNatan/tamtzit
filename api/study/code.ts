/* POST /api/study/code  { code }
 * A member's personal code in, a session for that same member out
 * (server/study/code.ts; docs/study/personal-code.md). No member token: a
 * device that lost its session or was never signed in calls it. */

/// <reference path="../../server/study/env.d.ts" />
import { handleCode } from "../../server/study/code.js";

// Node.js runtime (see health.ts): one RPC, one sign-in and one more RPC.
export const config = { maxDuration: 10 };

export default { fetch: (req: Request) => handleCode(req) };
