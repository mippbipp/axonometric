import type {
  Question,
  ResolvedQuestion,
  Structure,
} from "@axonometric/contracts";
import { Array as Arr } from "effect";

import { useWalkthrough } from "./walkthrough-context.ts";

/** A structure and the questions of one state it has. */
export interface QuestionGroup<Q extends Question> {
  readonly structure: Structure;
  readonly questions: readonly Q[];
}

const groupsOf = <Q extends Question>(
  structures: readonly Structure[],
  keep: (question: Question) => question is Q
): readonly QuestionGroup<Q>[] =>
  Arr.flatMap(structures, (structure) => {
    const questions = Arr.filter(structure.questions ?? [], keep);

    return questions.length === 0 ? [] : [{ structure, questions }];
  });

const isOpen = (question: Question) => question.state === "open";

const isResolved = (question: Question): question is ResolvedQuestion =>
  question.state === "resolved";

/**
 * The questions on structures revealed so far, open and resolved, each
 * grouped by structure in map order.
 */
export const useRevealedQuestions = () => {
  const { state, revealed } = useWalkthrough();

  const shown = Arr.filter(state.data.structures, ({ id }) => revealed.has(id));

  return {
    open: groupsOf(shown, (question): question is Question => isOpen(question)),
    resolved: groupsOf(shown, isResolved),
  };
};
