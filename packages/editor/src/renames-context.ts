import { createContext, use } from "react";

/**
 * The ids the agent gave structures the engineer proposed, by provisional id.
 * The page follows them: a selection of `new-1` is a selection of the id it
 * became.
 */
export const RenamesContext = createContext<ReadonlyMap<string, string>>(
  new Map()
);

export const useRenames = (): ReadonlyMap<string, string> => use(RenamesContext);
