/* Package K's server slot (spec §4.2, §5.5): the op "ask" ("לשאול", spec
 * §4.8, §12.3.K; a library question is routed first; the share path posts a
 * question to the group with the answer attached). The op and its core live
 * in server/study/ask.ts. Op "mnemonic" moved to the association wall (J,
 * ops/wall.ts, §12.1.4), which imports K's checked server/study/mnemonic.ts. */
export { askOp } from "../ask.js";
