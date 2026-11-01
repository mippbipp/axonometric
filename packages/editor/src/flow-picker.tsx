import { cn } from "@axonometric/ui/lib/utils";
import { Array as Arr } from "effect";

import { flowChoiceKey } from "./chapters.ts";
import type { FlowChoice } from "./chapters.ts";
import { controlClass } from "./control-class.ts";
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

  const chosen = flowChoiceKey(flowChoice);

  const options: readonly {
    readonly label: string;
    readonly choice: FlowChoice;
  }[] = [
    ...(stop.plays.length === 0
      ? []
      : [{ label: "This chapter", choice: { kind: "chapter" } as const }]),
    ...Arr.map(flows, (flow) => ({
      label: flow.name,
      choice: { kind: "flow", id: flow.id } as const,
    })),
    { label: "All flows", choice: { kind: "all" } },
  ];

  return (
    <fieldset
      data-flow-picker
      className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}
    >
      <legend className="sr-only">Flow to play</legend>
      <span className="mr-1 text-xs tracking-widest uppercase opacity-70">
        Flow
      </span>
      {Arr.map(options, ({ label, choice }) => {
        const key = flowChoiceKey(choice);

        return (
          <button
            key={key}
            type="button"
            data-flow={choice.kind === "flow" ? choice.id : choice.kind}
            aria-pressed={key === chosen}
            className={cn(
              controlClass,
              "tracking-wider uppercase",
              key === chosen && "bg-ink text-paper"
            )}
            onClick={() => {
              chooseFlow(choice);
            }}
          >
            {label}
          </button>
        );
      })}
    </fieldset>
  );
}
