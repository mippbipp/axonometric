import type { StructureChange } from "@axonometric/contracts";
import { Option, Result } from "effect";
import { useState } from "react";

import { useProposed } from "./proposed-context.ts";

/**
 * Sends structure proposals and keeps the reason the last one was refused,
 * for the control that sent it to show.
 */
export const usePropose = () => {
  const proposing = useProposed();
  const [failure, setFailure] = useState<string | undefined>();

  const send = (change: StructureChange, done?: () => void) => {
    if (proposing === null) {
      return;
    }

    const refusal = proposing.refusalOf(change);

    if (refusal !== undefined) {
      setFailure(refusal);

      return;
    }

    setFailure(undefined);
    proposing.propose(change, (outcome) => {
      setFailure(Option.getOrUndefined(Result.getFailure(outcome)));

      if (Result.isSuccess(outcome)) {
        done?.();
      }
    });
  };

  return {
    send,
    failure,
    clear: () => {
      setFailure(undefined);
    },
    canPropose: proposing?.canPropose === true,
  };
};
