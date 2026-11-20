import {
  hopLabelOf,
  marked,
  removedHopMark,
  maxFlowNameLength,
  newFlowId,
} from "@axonometric/contracts";
import type { Flow } from "@axonometric/contracts";
import { Array as Arr, Option, Result } from "effect";
import { useId, useState } from "react";

import { useConnections } from "./connections-context.ts";
import { controlClass } from "./control-class.ts";
import { fieldClass } from "./field-class.ts";
import { SortableList } from "./sortable-list.tsx";
import { useWalkthrough } from "./walkthrough-context.ts";

/** The text of an outcome's failure, or `undefined` when it worked. */
const failureOf = <A,>(outcome: Result.Result<A, string>) =>
  Option.getOrUndefined(Result.getFailure(outcome));

/** One flow: its name, and its hops in order. */
function FlowEditor({ flow }: { readonly flow: Flow }) {
  const connections = useConnections();
  const { state } = useWalkthrough();
  const [name, setName] = useState<string | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const id = useId();

  if (connections === null) {
    return null;
  }

  const { canPropose } = connections;
  const { hops } = connections.proposed.state.data;
  const labelOf = hopLabelOf(hops);
  const removed = marked(connections.proposed, removedHopMark);

  const proposedHere = !Arr.some(
    state.data.flows,
    (held) => held.id === flow.id
  );

  const send = (change: Parameters<typeof connections.proposeFlow>[0]) => {
    const refusal = connections.refusalOfFlow(change);

    if (refusal !== undefined) {
      setFailure(refusal);

      return;
    }

    setFailure(undefined);
    connections.proposeFlow(change, (outcome) => {
      setFailure(failureOf(outcome));
    });
  };

  return (
    <li
      className="border-ink/40 flex flex-col gap-2 border p-2"
      data-flow-editor={flow.id}
    >
      <div className="flex items-end gap-1.5">
        <label
          className="flex min-w-0 flex-1 flex-col gap-1 text-xs"
          htmlFor={`${id}-name`}
        >
          <span className="opacity-70">
            Name{proposedHere ? " (proposed)" : ""}
          </span>
          <input
            autoComplete="off"
            className={fieldClass}
            data-flow-name={flow.id}
            disabled={!canPropose}
            id={`${id}-name`}
            maxLength={maxFlowNameLength}
            onChange={(event) => {
              setName(event.target.value);
            }}
            type="text"
            value={name ?? flow.name}
          />
        </label>
        {name !== undefined &&
        name.trim() !== "" &&
        name.trim() !== flow.name ? (
          <button
            className={controlClass}
            data-flow-rename={flow.id}
            disabled={!canPropose}
            onClick={() => {
              send({ action: "rename", flow: flow.id, name: name.trim() });
              setName(undefined);
            }}
            type="button"
          >
            Rename
          </button>
        ) : null}
      </div>
      <SortableList
        dataList={`hops:${flow.id}`}
        disabled={!canPropose}
        label={`Hops of ${flow.name}`}
        onMove={(order) => {
          if (Arr.isReadonlyArrayNonEmpty(order)) {
            send({ action: "hops", flow: flow.id, hops: order });
          }
        }}
        rows={Arr.map(flow.hops, (hop, index) => ({
          id: hop,
          name: labelOf(hop),
          note: removed.has(hop) ? "proposed for deletion" : undefined,
          prefix: `${index + 1}. `,
        }))}
      />
      {failure === undefined ? null : (
        <p className="border-refused border-l-2 pl-2 text-xs" data-flow-failure>
          {failure}
        </p>
      )}
    </li>
  );
}

/** The form that creates a flow from a name and the hops it starts with. */
function NewFlowForm() {
  const connections = useConnections();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<ReadonlyArray<string>>([]);
  const [failure, setFailure] = useState<string | undefined>();
  const id = useId();

  if (connections === null) {
    return null;
  }

  // A hop proposed for deletion can't start a flow; the server refuses it too.
  const removed = marked(connections.proposed, removedHopMark);

  const hops = Arr.filter(
    connections.proposed.state.data.hops,
    ({ id: hop }) => !removed.has(hop)
  );

  // What was ticked, less a hop proposed for deletion since.
  const listed = Arr.filter(picked, (hop) => !removed.has(hop));

  return (
    <form
      aria-label="Create a flow"
      className="flex flex-col gap-2 text-xs"
      data-new-flow
      onSubmit={(event) => {
        event.preventDefault();

        const made = name.trim();

        if (made === "" || !Arr.isReadonlyArrayNonEmpty(listed)) {
          return;
        }

        const change = {
          action: "add" as const,
          flow: { id: newFlowId(made), name: made },
          hops: listed,
        };

        const refusal = connections.refusalOfFlow(change);

        if (refusal !== undefined) {
          setFailure(refusal);

          return;
        }

        connections.proposeFlow(change, (outcome) => {
          const why = failureOf(outcome);

          setFailure(why);

          if (why === undefined) {
            setName("");
            setPicked([]);
          }
        });
      }}
    >
      <label className="flex flex-col gap-1" htmlFor={`${id}-name`}>
        <span className="opacity-70">New flow</span>
        <input
          autoComplete="off"
          className={fieldClass}
          data-new-flow-name
          disabled={!connections.canPropose}
          id={`${id}-name`}
          maxLength={maxFlowNameLength}
          onChange={(event) => {
            setFailure(undefined);
            setName(event.target.value);
          }}
          type="text"
          value={name}
        />
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className="opacity-70">Starts with these hops</legend>
        <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto">
          {Arr.map(hops, ({ id: hop, label }) => (
            <li key={hop}>
              <label className="flex items-center gap-2">
                <input
                  checked={picked.includes(hop)}
                  data-new-flow-hop={hop}
                  disabled={!connections.canPropose}
                  onChange={(event) => {
                    setPicked(
                      event.target.checked
                        ? [...picked, hop]
                        : Arr.filter(picked, (other) => other !== hop)
                    );
                  }}
                  type="checkbox"
                />
                <span className="min-w-0 break-words">{label}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {failure === undefined ? null : (
        <p className="border-refused border-l-2 pl-2" data-new-flow-failure>
          {failure}
        </p>
      )}
      <button
        className={`${controlClass} self-start`}
        data-new-flow-submit
        disabled={
          !connections.canPropose || name.trim() === "" || listed.length === 0
        }
        type="submit"
      >
        Create flow
      </button>
    </form>
  );
}

/**
 * The Flows tab: every flow of the proposed map. Each has a name to rename
 * and its hops in order, to reorder by dragging a grip or with the move
 * buttons. The flows themselves reorder the same way, and a form creates a
 * new one. Every change is a proposal for the agent, and shows at once.
 */
export function FlowsTab() {
  const connections = useConnections();
  const [failure, setFailure] = useState<string | undefined>();

  if (connections === null) {
    return null;
  }

  const { flows } = connections.proposed.state.data;

  return (
    <section className="flex flex-col gap-3" data-flows-tab>
      <p className="text-xs opacity-70">
        A flow is a named, ordered list of hops. Rename a flow, drag its hops
        into a new order, or reorder the flows. Each change is a proposal for
        the agent.
      </p>
      {flows.length > 1 ? (
        <section className="flex flex-col gap-1">
          <h3 className="text-xs tracking-widest uppercase opacity-70">
            Order of the flows
          </h3>
          <SortableList
            dataList="flows"
            disabled={!connections.canPropose}
            label="Order of the flows"
            onMove={(order) => {
              if (!Arr.isReadonlyArrayNonEmpty(order)) {
                return;
              }

              const change = { action: "reorder" as const, flows: order };
              const refusal = connections.refusalOfFlow(change);

              if (refusal !== undefined) {
                setFailure(refusal);

                return;
              }

              setFailure(undefined);
              connections.proposeFlow(change, (outcome) => {
                setFailure(failureOf(outcome));
              });
            }}
            rows={Arr.map(flows, ({ id, name }) => ({ id, name }))}
          />
          {failure === undefined ? null : (
            <p
              className="border-refused border-l-2 pl-2 text-xs"
              data-flows-failure
            >
              {failure}
            </p>
          )}
        </section>
      ) : null}
      <ul className="flex flex-col gap-2">
        {Arr.map(flows, (flow) => (
          <FlowEditor flow={flow} key={flow.id} />
        ))}
      </ul>
      <NewFlowForm />
    </section>
  );
}
