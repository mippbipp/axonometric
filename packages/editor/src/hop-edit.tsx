import { maxHopLabelLength } from "@axonometric/contracts";
import type { HopChange } from "@axonometric/contracts";
import { Button } from "@axonometric/ui/components/button";
import { Input } from "@axonometric/ui/components/input";
import { Option, Result } from "effect";
import { useState } from "react";

import { useConnections } from "./connections-context.ts";
import { uiControlClass } from "./control-class.ts";
import { DeletionNotice } from "./deletion-notice.tsx";
import { HopFlows } from "./hop-flows.tsx";
import { useHopProposals } from "./hop-proposals.ts";
import { LabelledField } from "./labelled-field.tsx";

/** The box a refusal of `change` belongs to: the label's, or the panel's. */
const refusalSite = (change: HopChange): "label" | "other" =>
  change.action === "relabel" ? "label" : "other";

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
  const [refused, setRefused] = useState<
    { readonly on: "label" | "other"; readonly why: string } | undefined
  >();
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
      setRefused({ on: refusalSite(change), why: refusal });

      return;
    }

    connections.proposeHop(change, (outcome) => {
      setRefused(
        Option.map(Result.getFailure(outcome), (why) => ({
          on: refusalSite(change),
          why,
        })).pipe(Option.getOrUndefined)
      );
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
      <LabelledField
        className="text-xs"
        disabled={!connections.canPropose || deleted}
        failure={refused?.on === "label" ? refused.why : undefined}
        failureProps={{ "data-hop-change-failure": "" }}
        label="Label"
      >
        <Input
          autoComplete="off"
          data-hop-label-field
          maxLength={maxHopLabelLength}
          onValueChange={(next) => {
            setTyped(next);
            setRefused(undefined);
          }}
          value={typed ?? label}
        />
      </LabelledField>
      <HopFlows hop={id} />
      {refused?.on === "other" ? (
        <p
          className="border-refused border-l-2 pl-2 text-xs"
          data-hop-change-failure
        >
          {refused.why}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {changed ? (
          <Button
            className={uiControlClass}
            data-hop-relabel={id}
            disabled={!connections.canPropose}
            onClick={() => {
              send({ action: "relabel", hop: id, label: trimmed }, () => {
                setTyped(undefined);
              });
            }}
          >
            Propose relabel
          </Button>
        ) : null}
        {deleted ? null : (
          <Button
            className={uiControlClass}
            data-hop-delete={id}
            disabled={!connections.canPropose}
            onClick={() => {
              send({ action: "delete", hop: id });
            }}
          >
            Propose deleting
          </Button>
        )}
      </div>
    </section>
  );
}
