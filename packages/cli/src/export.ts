import {
  chapterSpotlightOf,
  chapterStopsOf,
  defaultFlowChoice,
  excalidrawOf,
  excalidrawText,
  exportName,
  placeStructures,
  pngScale,
  views,
  whiteBackground,
} from "@axonometric/contracts";
import type {
  ChapterStop,
  FlowChoice,
  MapState,
  View,
} from "@axonometric/contracts";
import { svgFileOf } from "@axonometric/drawing";
import {
  Array as Arr,
  Console,
  Effect,
  FileSystem,
  Option,
  Path,
  Schema,
} from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";

import { printNotes } from "./build.ts";
import { withLock } from "./lock.ts";
import { loadMap } from "./map-files.ts";
import { rasterise } from "./rasterise.ts";
import type { RasteriseFailed } from "./rasterise.ts";
import { writeAll } from "./write-files.ts";

export const formats = ["svg", "png", "excalidraw"] as const;

export type Format = (typeof formats)[number];

export const backgrounds = ["paper", "white"] as const;

export type Background = (typeof backgrounds)[number];

/** An `export` request the map can't take. `export` wrote nothing. */
export class ExportRejected extends Schema.TaggedError<
  ExportRejected,
  { readonly brand: unique symbol }
>()("ExportRejected", { reason: Schema.String }) {
  public override get [CliError.userMessage]() {
    return `${this.reason} export wrote nothing.`;
  }
}

/**
 * Finds the chapter `input` names: its id, or its number from 1. An id wins
 * over a number, so a chapter whose id is "2" is found by "2". Returns the
 * chapter's index.
 */
const chapterIndexOf = (
  stops: readonly ChapterStop[],
  input: string
): Option.Option<number> => {
  const byId = Arr.findFirstIndex(stops, (stop) => stop.id === input);

  if (Option.isSome(byId)) {
    return byId;
  }

  const number = /^\d+$/u.test(input) ? Number(input) : 0;

  return number >= 1 && number <= stops.length
    ? Option.some(number - 1)
    : Option.none();
};

/** Why no chapter is called `input`, and which are. */
const unknownChapter = (stops: readonly ChapterStop[], input: string) => {
  const listed = Arr.join(
    Arr.map(stops, (stop, at) => `${at + 1} (${stop.id})`),
    ", "
  );

  return `Unknown chapter "${input}". Use a number from 1 to ${stops.length}, or an id. The chapters are: ${listed}.`;
};

/**
 * The flow choice `--flow` names. Without it, what the page starts the
 * chapter on. A flow is chosen in the last chapter only, as on the page's
 * flow picker, and only among the map's flows.
 */
const flowChoiceOf = ({
  state,
  stop,
  chapters,
  index,
  input,
}: {
  readonly state: MapState;
  readonly chapters: number;
  /** The chapter's index, from 0. */
  readonly index: number;
  readonly stop: ChapterStop | undefined;
  readonly input: Option.Option<string>;
}): Effect.Effect<FlowChoice, ExportRejected> => {
  if (stop === undefined) {
    return Effect.succeed({ kind: "chapter" });
  }

  const isLast = index === chapters - 1;

  if (Option.isNone(input)) {
    return Effect.succeed(
      defaultFlowChoice({ data: state.data, stop, isLast })
    );
  }

  const { flows } = state.data;
  const named = input.value;

  if (!isLast) {
    return Effect.fail(
      ExportRejected.make({
        reason: `--flow picks a flow to play in the last chapter, and chapter "${stop.id}" isn't the last. Leave --flow out, or use --chapter ${chapters}.`,
      })
    );
  }

  if (named === "all") {
    return Effect.succeed({ kind: "all" });
  }

  if (Arr.some(flows, (flow) => flow.id === named)) {
    return Effect.succeed({ kind: "flow", id: named });
  }

  const ids = Arr.join(
    Arr.map(flows, (flow) => flow.id),
    ", "
  );

  return Effect.fail(
    ExportRejected.make({
      reason: `Unknown flow "${named}". Use all${ids === "" ? "" : ` or one of the map's flows: ${ids}`}.`,
    })
  );
};

/** What `export` draws, from the options. */
export interface ExportRequest {
  readonly home: string;
  readonly format: Format;
  readonly view: View;
  /** A chapter's id or number. The last chapter when left out. */
  readonly chapter: Option.Option<string>;
  /**
   * The flow to play in the last chapter: a flow's id, or `all`. The
   * chapter's own hops when left out.
   */
  readonly flow: Option.Option<string>;
  readonly background: Background;
  readonly output: Option.Option<string>;
}

const extensions = {
  svg: "svg",
  png: "png",
  excalidraw: "excalidraw",
} as const satisfies Record<Format, string>;

/**
 * Where an export goes when `--output` isn't given: next to SYSTEM.md, under
 * the name the page's Export menu saves it by. An Excalidraw file holds the
 * whole map, so it is named for the system alone.
 */
export const defaultExportFile = ({
  output,
  state,
  format,
  view,
  chapter,
}: {
  readonly output: string;
  readonly state: MapState;
  readonly format: Format;
  readonly view: View;
  readonly chapter: number;
}) =>
  Path.Path.use((path) =>
    Effect.succeed(
      path.join(
        output,
        `${format === "excalidraw" ? state.system : exportName({ system: state.system, view, chapter })}.${extensions[format]}`
      )
    )
  );

/** What an SVG or PNG of the map draws. */
interface Drawing {
  readonly state: MapState;
  readonly view: View;
  readonly background: Background;
  /** The chapter's index, from 0. */
  readonly chapter: number;
  /** What the chapter or flow plays, as the page's flow picker would. */
  readonly choice: FlowChoice;
}

/**
 * A format's file: text, or the bytes of a PNG. The SVG comes from the same
 * `svgFileOf` as the page's Export menu, drawn in the light palette, and a
 * PNG is that SVG rasterised.
 */
const contentOf = Effect.fnUntraced(function* (
  format: Format,
  drawing: Drawing
): Effect.fn.Return<
  string | Uint8Array,
  RasteriseFailed,
  FileSystem.FileSystem | Path.Path
> {
  if (format === "excalidraw") {
    return excalidrawText(
      excalidrawOf({
        data: drawing.state.data,
        layout: drawing.state.layout,
        background:
          drawing.background === "white" ? whiteBackground : undefined,
      })
    );
  }

  const { state, chapter, choice } = drawing;
  const stop = chapterStopsOf(state)[chapter];

  // Nothing is hovered or pinned in a file, so the spotlight is what the
  // chapter or the picked flow plays: the page's, with no hover and no pin.
  const spotlight =
    stop === undefined
      ? null
      : chapterSpotlightOf({
          data: state.data,
          stop,
          choice,
          hovered: null,
          pinned: null,
        });

  const { text } = svgFileOf({
    state,
    view: drawing.view,
    chapter,
    background: drawing.background,
    theme: "light",
    spotlight,
  });

  return format === "svg" ? text : yield* rasterise(text, pngScale);
});

const exportMap = Effect.fn("export")(function* (request: ExportRequest) {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const { home, format, view, background } = request;
  const output = path.dirname(home);

  yield* withLock(home, "export");

  // Structures with no saved position are placed as `build` would, but
  // nothing is saved: export writes only the file it was asked for.
  const { data, layout, warnings, sourcesSkipped, sourceLinks } =
    yield* loadMap({
      home,
      output,
      command: "export",
      arrange: (mapData, saved) => placeStructures(mapData, saved).layout,
    });

  const system = path.basename(output);
  const state: MapState = { system, data, layout, sourceLinks };
  const stops = chapterStopsOf(state);

  const index = yield* Option.match(request.chapter, {
    onNone: () => Effect.succeed(stops.length - 1),
    onSome: (input) =>
      Effect.fromOption(chapterIndexOf(stops, input)).pipe(
        Effect.mapError(() =>
          ExportRejected.make({ reason: unknownChapter(stops, input) })
        )
      ),
  });

  const stop = stops[index];

  const choice = yield* flowChoiceOf({
    state,
    stop,
    chapters: stops.length,
    index,
    input: request.flow,
  });

  yield* printNotes({ warnings, sourcesSkipped });

  const target = Option.isSome(request.output)
    ? request.output.value
    : yield* defaultExportFile({
        output,
        state,
        format,
        view,
        chapter: index + 1,
      });

  const content = yield* contentOf(format, {
    state,
    view,
    background,
    chapter: index,
    choice,
  });

  yield* fs.makeDirectory(path.dirname(target), { recursive: true });

  yield* writeAll([{ file: target, content }]);

  return yield* Console.log(`Wrote ${target}.`);
}, Effect.scoped);

const choice = <const Values extends readonly string[]>(
  name: string,
  values: Values
) => Flag.Literals(name, values);

export const exportCommand = Command.make(
  "export",
  {
    home: Argument.Directory("home", { mustExist: true }).pipe(
      Argument.withDescription(
        "The map's home folder, holding data.mjs and layout.json"
      )
    ),
    format: choice("format", formats).pipe(
      Flag.withDefault("svg"),
      Flag.withDescription(
        "The file to write: an SVG or PNG of one view and chapter, like the page's Export menu, or an Excalidraw file of the whole map at Plan view's positions"
      )
    ),
    view: choice("view", views).pipe(
      Flag.withDefault("iso"),
      Flag.withDescription("The view to draw. Excalidraw files ignore it.")
    ),
    chapter: Flag.String("chapter").pipe(
      Flag.optional,
      Flag.withDescription(
        "The chapter to draw, by its number from 1 or its id. Without it, the last chapter, which shows the whole map. Excalidraw files ignore it."
      )
    ),
    flow: Flag.String("flow").pipe(
      Flag.optional,
      Flag.withDescription(
        "In the last chapter, the flow to play: a flow's id, or all. The spotlight holds that flow's hops and fades the rest; all fades nothing. Without it, the chapter's own hops."
      )
    ),
    background: choice("background", backgrounds).pipe(
      Flag.withDefault("paper"),
      Flag.withDescription("The background colour")
    ),
    output: Flag.String("output").pipe(
      Flag.optional,
      Flag.withAlias("o"),
      Flag.withDescription(
        "The file to write. Without it, the page's file name, next to SYSTEM.md. Missing folders are created."
      )
    ),
  },
  (request) => exportMap(request)
).pipe(
  Command.withDescription(
    "Write the map as an SVG, a PNG or an Excalidraw file, like the page's Export menu. Validates the map first, and writes nothing if it has an error."
  ),
  Command.withExamples([
    {
      command: "axonometric export docs/pipeline/map --format excalidraw",
      description: "Write pipeline.excalidraw next to SYSTEM.md",
    },
    {
      command: "axonometric export docs/pipeline/map --flow f-repair",
      description:
        "Draw the last chapter with one flow's hops in the spotlight",
    },
    {
      command:
        "axonometric export docs/pipeline/map --format png --view plan --chapter 3 --background white",
      description: "Draw chapter 3 in Plan view on white as a PNG",
    },
  ])
);
