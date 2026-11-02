import type { Layout, LayoutChange } from "@axonometric/contracts";
import { Array as Arr, Option, Record as Rec } from "effect";
import { dual } from "effect/Function";

const spot = ({ x, y }: { readonly x: number; readonly y: number }) =>
  `${x}, ${y}`;

/** Each structure a change acts on, named, and what happens to it. */
export const describeChange: {
  (
    accepted: Layout,
    nameOf: (id: string) => string
  ): (change: LayoutChange) => readonly string[];
  (
    change: LayoutChange,
    accepted: Layout,
    nameOf: (id: string) => string
  ): readonly string[];
} = dual(
  3,
  (
    change: LayoutChange,
    accepted: Layout,
    nameOf: (id: string) => string
  ): readonly string[] => {
    if (change.kind === "move") {
      return Arr.map(change.moves, ({ target, position }) => {
        const before = Rec.get(accepted.structures, target.id);

        const from = Option.match(before, {
          onNone: () => "",
          onSome: (placement) => ` from ${spot(placement)}`,
        });

        return `${nameOf(target.id)} moved${from} to ${spot(position)}`;
      });
    }

    const { w, d } = change.footprint;
    const before = Rec.get(accepted.structures, change.target.id);

    const from = Option.match(before, {
      onNone: () => "",
      onSome: (placement) => ` from ${placement.w} × ${placement.d}`,
    });

    return [`${nameOf(change.target.id)} resized${from} to ${w} × ${d}`];
  }
);
