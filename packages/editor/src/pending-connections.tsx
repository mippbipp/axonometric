import { describeFlow, describeHop, hopLabelOf } from "@axonometric/contracts";
import { Array as Arr, Option, Result } from "effect";
import { useState } from "react";

import { useConnections } from "./connections-context.ts";
import { controlClass } from "./control-class.ts";
import { useReview } from "./review-context.ts";
import { useStructuresById } from "./structures.ts";

/** One open proposal, as the list shows it. */
interface Row {
  readonly id: string;
  readonly action: string;
  readonly text: string;
}

/**
 * The open hop and flow proposals in the Pending tab, each with a Discard.
 * A hop that is only proposed shows on the map in the pending look;
 * discarding its proposal takes it off, and a flow that listed it loses it.
 * Frozen and reviewed proposals are listed with the other review items.
 */
export function PendingConnections() {
  const connections = useConnections();
  const review = useReview();
  const byId = useStructuresById();
  const [failure, setFailure] = useState<string | undefined>();

  const open = Arr.filter(
    review?.entries ?? [],
    ({ item, status }) =>
      status.state === "open" && (item.kind === "hop" || item.kind === "flow")
  );

  if (connections === null || open.length === 0) {
    return null;
  }

  const { hops, flows } = connections.proposed.state.data;
  const hopName = hopLabelOf(hops);

  const flowName = (id: string) =>
    Option.match(
      Arr.findFirst(flows, (flow) => flow.id === id),
      { onNone: () => id, onSome: ({ name }) => name }
    );

  const nameOf = (id: string) => byId.get(id)?.name ?? id;

  const rows: readonly Row[] = Arr.flatMap(open, ({ item }): readonly Row[] => {
    if (item.kind === "hop") {
      return [
        {
          id: item.id,
          action: item.change.action,
          text: describeHop(item.change, { structure: nameOf, hop: hopName }),
        },
      ];
    }

    return item.kind === "flow"
      ? [
          {
            id: item.id,
            action: item.change.action,
            text: describeFlow(item.change, { hop: hopName, flow: flowName }),
          },
        ]
      : [];
  });

  return (
    <section data-pending-connections className="flex flex-col gap-2">
      <h3 className="text-xs tracking-widest uppercase opacity-70">
        Hop and flow proposals
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
        {Arr.map(rows, ({ id, action, text }) => (
          <li
            key={id}
            data-pending-connection-proposal={id}
            data-pending-action={action}
            className="border-pending flex items-start gap-2 border-l-2 pl-2 text-sm"
          >
            <span className="min-w-0 flex-1 break-words">{text}</span>
            {connections.canPropose ? (
              <button
                type="button"
                className={controlClass}
                onClick={() => {
                  connections.discard(id, (outcome) => {
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
