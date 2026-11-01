import type { Structure } from "@axonometric/contracts";
import { Array as Arr } from "effect";
import { useMemo } from "react";

import { useWalkthrough } from "./walkthrough-context.ts";

/** The map's structures by id. */
export const useStructuresById = (): ReadonlyMap<string, Structure> => {
  const { state } = useWalkthrough();

  return useMemo(
    () => new Map(Arr.map(state.data.structures, (s) => [s.id, s])),
    [state.data.structures]
  );
};

/** Whether a structure has steps, so its inside view can open. */
export const hasSteps = (structure: Structure | undefined) =>
  (structure?.steps?.length ?? 0) > 0;
