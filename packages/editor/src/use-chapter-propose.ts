import type { ChapterChange } from "@axonometric/contracts";

import { chapterItem } from "./proposal-items.ts";
import { useChapterOps } from "./proposal-ops-context.ts";
import { useShowProblems } from "./use-propose-item.ts";
import { useSending } from "./use-sending.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/**
 * Sends chapter proposals and keeps the reason the last one was refused, for
 * the control that sent it to show beside itself. What the change adds to
 * `check`'s report, judged on the chapter being viewed, shows in the warnings
 * panel beside the map as the change is sent, and stays up.
 */
export const useChapterPropose = () => {
  const ops = useChapterOps();
  const { stop } = useWalkthrough();
  const sending = useSending();
  const problems = useShowProblems();

  return {
    canPropose: ops?.canPropose === true,
    sending: sending.sending,
    failure: sending.failure,
    clear: sending.clear,
    send: (change: ChapterChange, done?: () => void) => {
      if (ops === null) {
        return;
      }

      problems.show([chapterItem(change)], {
        of: "chapter",
        chapter: stop.id,
      });
      sending.run(
        (finish) => {
          ops.propose(change, finish);
        },
        () => {
          done?.();
        }
      );
    },
  };
};
