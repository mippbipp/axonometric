import { maxHopLabelLength } from "@axonometric/contracts";
import type { HopChange } from "@axonometric/contracts";
import { Option, Result } from "effect";
import { useState } from "react";

import { useConnections } from "./connections-context.ts";
import { controlClass } from "./control-class.ts";
import { DeletionNotice } from "./deletion-notice.tsx";
import { fieldClass } from "./field-class.ts";
import { HopFlows } from "./hop-flows.tsx";
import { useHopProposals } from "./hop-proposals.ts";

/**
 * A hop's panel section for proposing changes: a label to relabel, the flows
 * it is in, and a delete. Each is a proposal the agent reviews, so the page
 * draws the hop in the pending look, or struck, until then. Only a page that
 * can write has it. What the label box shows is the hop as proposed.
 */
export function HopEdit({
  id,
  label,
}: {
  readonly id: string;
  /** The label the hop has on the proposed map. */
  readonly label: string;
}) {
  const connections = useConnections();
  const proposals = useHopProposals(id);
  const [failure, setFailure] = useState<string | undefined>();
  const [typed, setTyped] = useState<string | undefined>();

  if (connections === null) {
    return null;
  }

  const deleted = proposals?.deleted === true;
  const trimmed = (typed ?? label).trim();
  const changed = typed !== undefined && trimmed !== label && trimmed !== "";

  const send = (change: HopChange, after?: () => void) => {
    const refusal = connections.refusalOfHop(change);

    if (refusal !== undefined) {
      setFailure(refusal);

      return;
    }

    connections.proposeHop(change, (outcome) => {
      setFailure(Option.getOrUndefined(Result.getFailure(outcome)));
      after?.();
    });
  };

  return (
    <section className="flex flex-col gap-2" data-hop-edit={id}>
      {deleted ? (
        <DeletionNotice
          canWrite={connections.canPropose}
          discard={connections.discard}
          open={Option.getOrUndefined(
            Option.map(
              proposals?.deletion ?? Option.none(),
              ({ id: item }) => item
            )
          )}
        />
      ) : null}
      <label
        className="flex flex-col gap-1 text-xs"
        htmlFor={`hop-label-${id}`}
      >
        <span className="opacity-70">Label</span>
        <input
          autoComplete="off"
          className={fieldClass}
          data-hop-label-field
          disabled={!connections.canPropose || deleted}
          id={`hop-label-${id}`}
          maxLength={maxHopLabelLength}
          onChange={(event) => {
            setTyped(event.target.value);
            setFailure(undefined);
          }}
          type="text"
          value={typed ?? label}
        />
      </label>
      <HopFlows hop={id} />
      {failure === undefined ? null : (
        <p
          className="border-refused border-l-2 pl-2 text-xs"
          data-hop-change-failure
        >
          {failure}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {changed ? (
          <button
            className={controlClass}
            data-hop-relabel={id}
            disabled={!connections.canPropose}
            onClick={() => {
              send({ action: "relabel", hop: id, label: trimmed }, () => {
                setTyped(undefined);
              });
            }}
            type="button"
          >
            Propose relabel
          </button>
        ) : null}
        {deleted ? null : (
          <button
            className={controlClass}
            data-hop-delete={id}
            disabled={!connections.canPropose}
            onClick={() => {
              send({ action: "delete", hop: id });
            }}
            type="button"
          >
            Propose deleting
          </button>
        )}
      </div>
    </section>
  );
}
