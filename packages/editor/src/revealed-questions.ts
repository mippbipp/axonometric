import type {
  Question,
  ResolvedQuestion,
  Structure,
} from "@axonometric/contracts";
import { Array as Arr } from "effect";

import { useWalkthrough } from "./walkthrough-context.ts";

/** A structure and the questions of one state it has. */
export interface QuestionGroup<Q extends Question> {
  readonly questions: ReadonlyArray<Q>;
  readonly structure: Structure;
}

const groupsOf = <Q extends Question>(
  structures: ReadonlyArray<Structure>,
  keep: (question: Question) => question is Q
): ReadonlyArray<QuestionGroup<Q>> =>
  Arr.flatMap(structures, (structure) => {
    const questions = Arr.filter(structure.questions ?? [], keep);

    return questions.length === 0 ? [] : [{ questions, structure }];
  });

const isOpen = (question: Question) => question.state === "open";

const isResolved = (question: Question): question is ResolvedQuestion =>
  question.state === "resolved";

/**
 * The questions on structures revealed so far, open and resolved, each
 * grouped by structure in map order.
 */
export const useRevealedQuestions = () => {
  const { revealed, state } = useWalkthrough();

  const shown = Arr.filter(state.data.structures, ({ id }) => revealed.has(id));

  return {
    open: groupsOf(shown, (question): question is Question => isOpen(question)),
    resolved: groupsOf(shown, isResolved),
  };
};
