import { Array as Arr, Effect } from "effect";

import { defaultSpotFor, proposalProblems } from "../src/index.ts";
import type { Layout, MapData, Shape } from "../src/index.ts";
import { fixture, placedFixture } from "./fixture-maps.ts";

/** Every fixture map in the CLI's tests. */
export const spotFixtures = [
  "pipeline",
  "shapes",
  "review",
  "crowded",
  "plan-labels",
  "flake-pipeline",
  "update-pipeline",
] as const;

/** A fixture map as the page loads it. update-pipeline has no layout.json. */
const spotMap = (
  name: string
): Effect.Effect<{ readonly data: MapData; readonly layout: Layout }> =>
  name === "update-pipeline" ? placedFixture(name) : fixture(name);

/** A new structure the add form asks `defaultSpotFor` to place. */
export interface SpotCase {
  readonly group: string;
  readonly name: string;
  readonly shape: Shape;
}

/**
 * A fixture map, and a box with each of two names for each of its groups.
 * The name sets the width of the name tag, so the two names can find
 * different spots. A map with no chapters gets its first group alone: its
 * one drawing shows the new structure, so no drawing carries over between
 * spots, and the search is as slow as it ever was.
 */
export const spotCasesOf = (name: string) =>
  Effect.map(spotMap(name), (map) => ({
    cases: Arr.flatMap(
      Arr.isReadonlyArrayNonEmpty(map.data.chapters)
        ? map.data.groups
        : map.data.groups.slice(0, 1),
      ({ id: group }) =>
        Arr.map(["New structure", "Build cache"], (structure): SpotCase => ({
          group,
          name: structure,
          shape: "box",
        }))
    ),
    map,
  }));

/**
 * Where `defaultSpotFor` puts `asked` on `map`, how many warnings it adds
 * there, and what `check` then reports, as the add form's panel lists it.
 */
export const spotAnswer = (
  { data, layout }: { readonly data: MapData; readonly layout: Layout },
  asked: SpotCase
) => {
  const { added, spot } = defaultSpotFor({ data, layout, ...asked });

  const problems = proposalProblems({
    before: { data, layout },
    items: [
      {
        change: {
          action: "add",
          at: spot,
          structure: { ...asked, id: "draft-structure", status: "planned" },
        },
        id: "preview",
        kind: "structure",
      },
    ],
  });

  return {
    ...asked,
    added,
    spot,
    warnings: Arr.map(problems, ({ added: isNew, problem }) => ({
      added: isNew,
      message: problem.message,
    })),
  };
};
