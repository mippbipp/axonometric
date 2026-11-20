import type { ChangeId } from "@axonometric/contracts";
import { Option, Result } from "effect";
import { useState } from "react";

import { controlClass } from "./control-class.ts";
import type { ReviewDone } from "./served-store.ts";

/**
 * What a panel says about a structure or hop proposed for deletion.
 *
 * - While the proposal is open, it offers "Withdraw deletion", which discards
 *   that proposal.
 * - Once the proposal is in a batch, it says the thing waits on the agent and
 *   offers nothing, since a frozen item can't change until the agent commits.
 */
export function DeletionNotice({
  canWrite,
  discard,
  open,
}: {
  readonly canWrite: boolean;
  readonly discard: (id: ChangeId, done: ReviewDone<ChangeId>) => void;
  /** The id of the open proposal that deletes it, or nothing once it is frozen. */
  readonly open: ChangeId | undefined;
}) {
  const [failure, setFailure] = useState<string | undefined>();

  return (
    <div
      className="border-refused flex flex-col gap-1.5 border-l-2 pl-2 text-xs"
      data-deleting
    >
      <p>
        Proposed for deletion. It stays on the map, crossed out, until the agent
        has reviewed it.
      </p>
      {open === undefined ? (
        <p className="opacity-80" data-deletion-waiting>
          Waiting on the agent: the deletion is in a batch, so nothing here can
          change until the agent commits.
        </p>
      ) : (
        <button
          className={`${controlClass} self-start`}
          data-withdraw-deletion
          disabled={!canWrite}
          onClick={() => {
            discard(open, (outcome) => {
              setFailure(Option.getOrUndefined(Result.getFailure(outcome)));
            });
          }}
          type="button"
        >
          Withdraw deletion
        </button>
      )}
      {failure === undefined ? null : (
        <p className="border-refused border-l-2 pl-2" data-withdraw-failure>
          {failure}
        </p>
      )}
    </div>
  );
}
