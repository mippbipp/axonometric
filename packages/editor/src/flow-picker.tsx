import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";

import { useWalkthrough } from "./walkthrough-context.ts";

/**
 * The last chapter's flow picker: one button per flow, and one for every
 * flow at once. It shows nothing in other chapters or when the map has no
 * flows.
 */
export function FlowPicker({ className }: { readonly className?: string }) {
  const { state, isLast, flowChoice, chooseFlow, stop } = useWalkthrough();
  const { flows } = state.data;

  if (!isLast || flows.length === 0) {
    return null;
  }

  const options = [
    ...(stop.plays.length === 0
      ? []
      : [
          {
            key: "chapter",
            label: "This chapter",
            on: flowChoice.kind === "chapter",
            handleChoose: () => {
              chooseFlow({ kind: "chapter" });
            },
          },
        ]),
    ...Arr.map(flows, (flow) => ({
      key: flow.id,
      label: flow.name,
      on: flowChoice.kind === "flow" && flowChoice.id === flow.id,
      handleChoose: () => {
        chooseFlow({ kind: "flow", id: flow.id });
      },
    })),
    {
      key: "all",
      label: "All flows",
      on: flowChoice.kind === "all",
      handleChoose: () => {
        chooseFlow({ kind: "all" });
      },
    },
  ];

  return (
    <fieldset
      data-flow-picker
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      <legend className="sr-only">Flow to play</legend>
      <span className="mr-1 text-xs tracking-widest uppercase opacity-70">
        Play
      </span>
      {Arr.map(options, (option) => (
        <button
          key={option.key}
          type="button"
          data-flow={option.key}
          aria-pressed={option.on}
          className={cn(
            "border-ink focus-visible:outline-ink cursor-pointer border px-2 py-0.5 text-xs tracking-wider uppercase focus-visible:outline-2 focus-visible:outline-offset-1",
            option.on ? "bg-ink text-paper" : "bg-paper text-ink"
          )}
          onClick={option.handleChoose}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  );
}
