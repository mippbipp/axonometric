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
      data-flow-editor={flow.id}
      className="border-ink/40 flex flex-col gap-2 border p-2"
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
            id={`${id}-name`}
            data-flow-name={flow.id}
            type="text"
            value={name ?? flow.name}
            maxLength={maxFlowNameLength}
            disabled={!canPropose}
            autoComplete="off"
            className={fieldClass}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </label>
        {name !== undefined &&
        name.trim() !== "" &&
        name.trim() !== flow.name ? (
          <button
            type="button"
            data-flow-rename={flow.id}
            className={controlClass}
            disabled={!canPropose}
            onClick={() => {
              send({ action: "rename", flow: flow.id, name: name.trim() });
              setName(undefined);
            }}
          >
            Rename
          </button>
        ) : null}
      </div>
      <SortableList
        label={`Hops of ${flow.name}`}
        dataList={`hops:${flow.id}`}
        disabled={!canPropose}
        rows={Arr.map(flow.hops, (hop, index) => ({
          id: hop,
          name: labelOf(hop),
          prefix: `${index + 1}. `,
          note: removed.has(hop) ? "proposed for deletion" : undefined,
        }))}
        onMove={(order) => {
          if (Arr.isReadonlyArrayNonEmpty(order)) {
            send({ action: "hops", flow: flow.id, hops: order });
          }
        }}
      />
      {failure === undefined ? null : (
        <p data-flow-failure className="border-refused border-l-2 pl-2 text-xs">
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
  const [picked, setPicked] = useState<readonly string[]>([]);
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
      data-new-flow
      aria-label="Create a flow"
      className="flex flex-col gap-2 text-xs"
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
          id={`${id}-name`}
          data-new-flow-name
          type="text"
          value={name}
          maxLength={maxFlowNameLength}
          disabled={!connections.canPropose}
          autoComplete="off"
          className={fieldClass}
          onChange={(event) => {
            setFailure(undefined);
            setName(event.target.value);
          }}
        />
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className="opacity-70">Starts with these hops</legend>
        <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto">
          {Arr.map(hops, ({ id: hop, label }) => (
            <li key={hop}>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  data-new-flow-hop={hop}
                  checked={picked.includes(hop)}
                  disabled={!connections.canPropose}
                  onChange={(event) => {
                    setPicked(
                      event.target.checked
                        ? [...picked, hop]
                        : Arr.filter(picked, (other) => other !== hop)
                    );
                  }}
                />
                <span className="min-w-0 break-words">{label}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {failure === undefined ? null : (
        <p data-new-flow-failure className="border-refused border-l-2 pl-2">
          {failure}
        </p>
      )}
      <button
        type="submit"
        data-new-flow-submit
        className={`${controlClass} self-start`}
        disabled={
          !connections.canPropose || name.trim() === "" || listed.length === 0
        }
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
    <section data-flows-tab className="flex flex-col gap-3">
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
            label="Order of the flows"
            dataList="flows"
            disabled={!connections.canPropose}
            rows={Arr.map(flows, ({ id, name }) => ({ id, name }))}
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
          />
          {failure === undefined ? null : (
            <p
              data-flows-failure
              className="border-refused border-l-2 pl-2 text-xs"
            >
              {failure}
            </p>
          )}
        </section>
      ) : null}
      <ul className="flex flex-col gap-2">
        {Arr.map(flows, (flow) => (
          <FlowEditor key={flow.id} flow={flow} />
        ))}
      </ul>
      <NewFlowForm />
    </section>
  );
}
