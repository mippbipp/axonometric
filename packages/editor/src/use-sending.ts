import { Option, Result } from "effect";
import { useState } from "react";

import type { ReviewOutcome } from "./served-store.ts";

/**
 * The state every control that sends a proposal shares: whether a write is
 * on its way, and why the last one was refused. `run` clears the failure,
 * marks the write as sending, and gives the sender a `done` that records how
 * the write ended and calls `onSent` when it worked.
 */
export const useSending = () => {
  const [failure, setFailure] = useState<string | undefined>();
  const [sending, setSending] = useState(false);

  return {
    failure,
    sending,
    /** Shows a refusal that came before anything was sent. */
    refuse: setFailure,
    clear: () => {
      setFailure(undefined);
    },
    run: <A>(
      send: (done: (outcome: ReviewOutcome<A>) => void) => void,
      onSent?: (value: A) => void
    ) => {
      setFailure(undefined);
      setSending(true);
      send((outcome) => {
        setSending(false);
        setFailure(Option.getOrUndefined(Result.getFailure(outcome)));

        if (Result.isSuccess(outcome)) {
          onSent?.(outcome.success);
        }
      });
    },
  };
};
