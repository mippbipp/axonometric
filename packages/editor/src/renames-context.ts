import { noRenames } from "@axonometric/contracts";
import type { Renames } from "@axonometric/contracts";
import { createContext, use } from "react";

/**
 * The ids the agent gave structures, hops and flows the engineer proposed,
 * by entity and provisional id. The page follows them: a selection of `new-1`
 * is a selection of the id it became, whichever kind of thing it is.
 */
export const RenamesContext = createContext<Renames>(noRenames);

export const useRenames = (): Renames => use(RenamesContext);
