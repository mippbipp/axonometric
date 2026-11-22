import { usePageKey } from "./page-key.ts";
import { useSelection } from "./selection-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/**
 * Moves between chapters with → and ←, or ] and [. In the inside view → does
 * nothing and ← comes out instead; ] and [ keep working. The map's items take
 * the arrows while they have focus, so → and ← change chapter only with focus
 * outside the map. Keys typed into a field, or pressed with Alt, Ctrl or
 * Meta, are left alone.
 */
export const useChapterKeys = () => {
  const { back, next } = useWalkthrough();
  const { comeOut, inside } = useSelection();

  usePageKey("]", next);
  usePageKey("[", back);
  usePageKey("arrowright", next, { when: () => inside === null });
  usePageKey("arrowleft", inside === null ? back : comeOut);
};
