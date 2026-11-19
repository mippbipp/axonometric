import { Array as Arr, Effect, Schema } from "effect";

import { Layout, MapData, placeStructures } from "../src/index.ts";

/** The folder of a fixture map in the CLI's test fixtures. */
const folderOf = (name: string) =>
  new URL(`../../cli/test/fixtures/${name}/map/`, import.meta.url);

const decodeData = Schema.decodeUnknownEffect(
  Schema.Struct({ default: MapData })
);

/** A fixture map's data.mjs, decoded. */
const dataOf = Effect.fnUntraced(function* (name: string) {
  const { href } = new URL("data.mjs", folderOf(name));
  const module: unknown = yield* Effect.promise(() => import(href));
  const { default: data } = yield* decodeData(module);

  return data;
});

/** A fixture map from the CLI's test fixtures, decoded. */
export const fixture = (name: string) =>
  Effect.gen(function* () {
    const data = yield* dataOf(name);

    const layoutModule: unknown = yield* Effect.promise(
      () =>
        import(new URL("layout.json", folderOf(name)).href, {
          with: { type: "json" },
        })
    );

    const layout: Layout = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ default: Layout })
    )(layoutModule).pipe(Effect.map(({ default: value }) => value));

    return { data, layout };
  }).pipe(Effect.orDie);

const emptyLayout: Layout = { format: 1, revision: 0, structures: {} };

/** A fixture map with no saved layout, placed as `build` places it. */
export const placedFixture = (name: string) =>
  dataOf(name).pipe(
    Effect.map((data) => ({
      data,
      layout: placeStructures(data, emptyLayout).layout,
    })),
    Effect.orDie
  );

/** What each chapter shows: its reveals and every earlier chapter's. */
export const chaptersOf = (data: MapData) =>
  Arr.map(data.chapters, (chapter, index) => ({
    id: chapter.id,
    plays: chapter.plays,
    revealed: new Set(
      Arr.flatMap(data.chapters.slice(0, index + 1), ({ reveals }) => reveals)
    ),
  }));

export const everything = (data: MapData) =>
  new Set(Arr.map(data.structures, ({ id }) => id));
