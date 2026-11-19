import "../styles/qtypes.css";

/* The question types' components, one lazy chunk (docs/study/question-types.md):
 * PracticeQuestion loads it only when a question has a picture or several parts. */
export { default as QuestionFigure } from "./QuestionFigure";
export { default as TfAnswer } from "./TfAnswer";
export { default as MatchAnswer } from "./MatchAnswer";
export { default as OrderAnswer } from "./OrderAnswer";
