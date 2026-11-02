import type { CompareMarks } from "@axonometric/contracts";
import { createContext, use } from "react";

import { looks } from "./compare-looks.ts";

/**
 * What a compare highlights, for the page while a past revision is open in
 * compare mode. Everywhere else it is `null`, and nothing is highlighted.
 */
export const CompareContext = createContext<CompareMarks | null>(null);

/** The compare's marks, or `null` when the page isn't comparing. */
export const useCompare = (): CompareMarks | null => use(CompareContext);

/**
 * Words for a screen reader for the marks on one structure, such as
 * "moved, text changed", or `undefined` when it has none.
 */
export const spokenMarks = ({
  marks,
  id,
}: {
  readonly marks: CompareMarks | null;
  readonly id: string;
}): string | undefined => {
  const found = marks?.structures.get(id);

  return found === undefined
    ? undefined
    : found.map((mark) => looks[mark].spoken).join(", ");
};
