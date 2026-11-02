import { actionOf } from "@axonometric/contracts";
import { Array as Arr, Option, Result } from "effect";
import { useState } from "react";

import { controlClass } from "./control-class.ts";
import { useProposed } from "./proposed-context.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/**
 * The open structure proposals in the Pending tab, each with a Discard. An
 * added structure that is only proposed shows under its provisional id in
 * the map; discarding its proposal takes it off. Frozen and reviewed
 * proposals are listed with the other review items.
 */
export function PendingStructures() {
  const proposing = useProposed();
  const { state } = useWalkthrough();
  const [failure, setFailure] = useState<string | undefined>();

  if (proposing === null || proposing.open.length === 0) {
    return null;
  }

  const groups = new Map(
    Arr.map(state.data.groups, ({ id, title }) => [id, title])
  );

  return (
    <section data-pending-structures className="flex flex-col gap-2">
      <h3 className="text-xs tracking-widest uppercase opacity-70">
        Structure proposals
      </h3>
      {failure === undefined ? null : (
        <p
          data-discard-refused
          className="border-refused border-l-2 pl-2 text-xs"
        >
          {failure}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {Arr.map(proposing.open, ({ id, change }) => (
          <li
            key={id}
            data-pending-structure-proposal={id}
            data-pending-action={change.action}
            className="border-pending flex items-start gap-2 border-l-2 pl-2 text-sm"
          >
            <span className="min-w-0 flex-1 break-words">
              {actionOf(change).describe({
                structure: proposing.nameOf,
                group: (group) => groups.get(group) ?? group,
              })}
            </span>
            {proposing.canPropose ? (
              <button
                type="button"
                className={controlClass}
                onClick={() => {
                  proposing.discard(id, (outcome) => {
                    setFailure(
                      Option.getOrUndefined(Result.getFailure(outcome))
                    );
                  });
                }}
              >
                Discard
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
