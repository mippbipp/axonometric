import { Array as Arr, Option } from "effect";

import type { MapData } from "./map-data.ts";
import { hopLabelOf } from "./map-data.ts";
import type { Names } from "./review-kinds.ts";

/** The title of the entry `id` in `held`, or the id when there is none. */
const titleIn =
  (held: ReadonlyArray<{ readonly id: string; readonly title: string }>) =>
  (id: string): string =>
    Option.match(
      Arr.findFirst(held, (found) => found.id === id),
      { onNone: () => id, onSome: ({ title }) => title }
    );

/**
 * How the prompt, `review` and the Pending tab name what an item mentions.
 * `shown` is the map as proposed, whose groups include the ones the engineer
 * added, and `accepted` is the map as data.mjs has it, whose group titles a
 * rename changes. Written once, here, so no caller builds its own.
 */
export const namesOf = ({
  accepted,
  shown,
}: {
  readonly accepted: Pick<MapData, "groups" | "chapters">;
  readonly shown: Pick<MapData, "structures" | "hops" | "groups" | "chapters">;
}): Names => {
  const structures = new Map(
    Arr.map(shown.structures, ({ id, name }) => [id, name] as const)
  );

  return {
    acceptedGroup: titleIn(accepted.groups),
    chapter: titleIn(accepted.chapters),
    group: titleIn(shown.groups),
    hop: hopLabelOf(shown.hops),
    structure: (id) => structures.get(id) ?? id,
  };
};
