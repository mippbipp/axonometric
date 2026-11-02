import type { ChapterChange } from "@axonometric/contracts";
import { Option, Result } from "effect";
import { useState } from "react";

import { useChapterOps } from "./chapter-ops-context.ts";

/**
 * Sends chapter proposals and keeps the reason the last one was refused, for
 * the control that sent it to show beside itself.
 */
export const useChapterPropose = () => {
  const ops = useChapterOps();
  const [failure, setFailure] = useState<string | undefined>();
  const [sending, setSending] = useState(false);

  return {
    canPropose: ops?.canPropose === true,
    sending,
    failure,
    clear: () => {
      setFailure(undefined);
    },
    send: (change: ChapterChange, done?: () => void) => {
      if (ops === null) {
        return;
      }

      setFailure(undefined);
      setSending(true);
      ops.propose(change, (outcome) => {
        setSending(false);

        const why = Option.getOrUndefined(Result.getFailure(outcome));

        setFailure(why);

        if (why === undefined) {
          done?.();
        }
      });
    },
  };
};
