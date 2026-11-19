import { HttpError } from "../study.js";
import type { Op } from "./types.js";

/* Package U's server slot, seeded by package F (F1Δ, §12.2.4): the op
 * "plaque" (U-3: a funny plaque for a museum exhibit). Until U builds it, it
 * answers 501 "not built" and calls no model. */
export const plaqueOp: Op = async () => {
  throw new HttpError(501, "not built");
};
