import { createContext, use } from "react";

const none: readonly string[] = [];

/**
 * The structures the engineer has proposed that exist only as proposals so
 * far. Every chapter shows them, because the agent hasn't said which chapter
 * reveals them, and none counts them as newly revealed.
 */
export const ProposedAddsContext = createContext<readonly string[]>(none);

export const useProposedAdds = (): readonly string[] =>
  use(ProposedAddsContext);
