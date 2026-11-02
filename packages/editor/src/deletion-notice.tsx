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
  open,
  discard,
  canWrite,
}: {
  /** The id of the open proposal that deletes it, or nothing once it is frozen. */
  readonly open: ChangeId | undefined;
  readonly discard: (id: ChangeId, done: ReviewDone<ChangeId>) => void;
  readonly canWrite: boolean;
}) {
  const [failure, setFailure] = useState<string | undefined>();

  return (
    <div
      data-deleting
      className="border-refused flex flex-col gap-1.5 border-l-2 pl-2 text-xs"
    >
      <p>
        Proposed for deletion. It stays on the map, crossed out, until the agent
        has reviewed it.
      </p>
      {open === undefined ? (
        <p data-deletion-waiting className="opacity-80">
          Waiting on the agent: the deletion is in a batch, so nothing here can
          change until the agent commits.
        </p>
      ) : (
        <button
          type="button"
          data-withdraw-deletion
          className={`${controlClass} self-start`}
          disabled={!canWrite}
          onClick={() => {
            discard(open, (outcome) => {
              setFailure(Option.getOrUndefined(Result.getFailure(outcome)));
            });
          }}
        >
          Withdraw deletion
        </button>
      )}
      {failure === undefined ? null : (
        <p data-withdraw-failure className="border-refused border-l-2 pl-2">
          {failure}
        </p>
      )}
    </div>
  );
}
