/* Package C's server slot (spec §4.2, §5.5): the op "cards" of /api/study/ai,
 * which writes one part of a flashcard round (spec §4.7). The op and its core
 * live in server/study/cards.ts. */
export { cardsOp } from "../cards.js";
