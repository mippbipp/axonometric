import type { FlowChoice } from "@axonometric/contracts";
import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";

import { flowChoiceKey } from "./chapters.ts";
import { controlClass } from "./control-class.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/**
 * The last chapter's flow picker: one button per flow, and one for every
 * flow at once. It shows nothing in other chapters or when the map has no
 * flows.
 */
export function FlowPicker({ className }: { readonly className?: string }) {
  const { chooseFlow, flowChoice, isLast, state, stop } = useWalkthrough();
  const { flows } = state.data;

  if (!isLast || flows.length === 0) {
    return null;
  }

  const chosen = flowChoiceKey(flowChoice);

  const options: ReadonlyArray<{
    readonly choice: FlowChoice;
    readonly label: string;
  }> = [
    ...(stop.plays.length === 0
      ? []
      : [{ choice: { kind: "chapter" } as const, label: "This chapter" }]),
    ...Arr.map(flows, (flow) => ({
      choice: { id: flow.id, kind: "flow" } as const,
      label: flow.name,
    })),
    { choice: { kind: "all" }, label: "All flows" },
  ];

  return (
    <fieldset
      className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}
      data-flow-picker
    >
      <legend className="sr-only">Flow to play</legend>
      <span className="mr-1 text-xs tracking-widest uppercase opacity-70">
        Flow
      </span>
      {Arr.map(options, ({ choice, label }) => {
        const key = flowChoiceKey(choice);

        return (
          <button
            aria-pressed={key === chosen}
            className={cn(
              controlClass,
              "tracking-wider uppercase",
              key === chosen && "bg-ink text-paper"
            )}
            data-flow={choice.kind === "flow" ? choice.id : choice.kind}
            key={key}
            onClick={() => {
              chooseFlow(choice);
            }}
            type="button"
          >
            {label}
          </button>
        );
      })}
    </fieldset>
  );
}
