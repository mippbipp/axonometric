import { Array as Arr, Effect, Schema } from "effect";

import { Layout, MapData } from "../src/index.ts";

/** A fixture map from the CLI's test fixtures, decoded. */
export const fixture = (name: string) =>
  Effect.gen(function* () {
    const folder = new URL(
      `../../cli/test/fixtures/${name}/map/`,
      import.meta.url
    );

    const module: unknown = yield* Effect.promise(
      () => import(new URL("data.mjs", folder).href)
    );

    const layoutModule: unknown = yield* Effect.promise(
      () =>
        import(new URL("layout.json", folder).href, { with: { type: "json" } })
    );

    const data = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ default: MapData })
    )(module);

    const layout: Layout = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ default: Layout })
    )(layoutModule).pipe(Effect.map(({ default: value }) => value));

    return { data: data.default, layout };
  }).pipe(Effect.orDie);

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
