import { chapterSpotlightOf } from "@axonometric/contracts";
import type {
  ChapterStop,
  MapData,
  Spotlight,
  SpotlightTarget,
} from "@axonometric/contracts";
import { Array as Arr, Option, Result, Schema, SchemaIssue } from "effect";

import type { FlowOption } from "./chapters.ts";

/**
 * What a view tool returns. A refusal is a returned value: Chromium 156 loses
 * the message of a tool that throws and hands the agent a bare UnknownError.
 */
export type Outcome =
  | { readonly notice: string; readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export const refused = (reason: string): Outcome => ({ ok: false, reason });

export const done = (notice: string): Outcome => ({ notice, ok: true });

const chapterNumber = Schema.Int.check(Schema.isGreaterThan(0));

export const GoToChapterInput = Schema.Struct({
  chapter: Schema.Union([chapterNumber, Schema.String]).annotate({
    description:
      "The chapter's number, counting from 1 as the chapter rail shows it, or the chapter's id.",
  }),
});

export const SetViewInput = Schema.Struct({
  view: Schema.Literals(["iso", "plan"]).annotate({
    description: "iso for the isometric view, plan for the plan view.",
  }),
});

export const PinInput = Schema.Struct({
  structure: Schema.NullOr(Schema.String).annotate({
    description:
      "The id of a structure shown in this chapter, or null to unpin.",
  }),
});

export const GoInsideInput = Schema.Struct({
  structure: Schema.String.annotate({
    description:
      "The id of a structure shown in this chapter that has steps to show.",
  }),
});

export const PickFlowInput = Schema.Struct({
  flow: Schema.String.annotate({
    description:
      'The flow picker\'s choice: "chapter", "all" or "flow:<id>". Only the last chapter has the picker.',
  }),
});

export const SpotlightInput = Schema.Struct({
  hops: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
    description: "Ids of hops to light, all drawn in this chapter.",
  }),
  structures: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
    description:
      "Ids of structures to light, all shown in this chapter. Leave both lists empty to clear the spotlight.",
  }),
});

/** A tool's `inputSchema`, from the schema that decodes its input. */
export const inputSchemaOf = (schema: Schema.Constraint): object =>
  Schema.toJsonSchemaDocument(schema).schema;

const formatIssue = SchemaIssue.makeFormatterDefault();

/** The input as a typed value, or the reason it can't be used. */
// oxlint-disable-next-line effecttsgo/missing-pipeable-signature -- called with both arguments in hand, never piped.
export const decodeInput = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown
): Result.Result<S["Type"], string> =>
  Result.mapError(
    Schema.decodeUnknownResult(schema)(input),
    (failure) => `The input is not valid. ${formatIssue(failure.issue)}`
  );

const quoted = (text: string) => `"${text}"`;

const noun = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** The chapter an agent named, by number (from 1) or by id. */
export const chapterIndexOf = ({
  chapter,
  stops,
}: {
  readonly chapter: number | string;
  readonly stops: ReadonlyArray<Pick<ChapterStop, "id">>;
}): Result.Result<number, string> => {
  if (typeof chapter === "number") {
    return chapter <= stops.length
      ? Result.succeed(chapter - 1)
      : Result.fail(
          `There is no chapter ${chapter}. The map has ${noun(stops.length, "chapter")}.`
        );
  }

  const index = Arr.findFirstIndex(stops, ({ id }) => id === chapter);

  return Option.isSome(index)
    ? Result.succeed(index.value)
    : Result.fail(
        `There is no chapter with the id ${quoted(chapter)}. The chapter ids are ${Arr.join(
          Arr.map(stops, ({ id }) => quoted(id)),
          ", "
        )}.`
      );
};

/** The picker option an agent named, or why the picker can't take it. */
export const flowOptionOf = ({
  flow,
  flowCount,
  isLast,
  options,
}: {
  readonly flow: string;
  readonly flowCount: number;
  readonly isLast: boolean;
  readonly options: ReadonlyArray<FlowOption>;
}): Result.Result<FlowOption, string> => {
  if (!isLast || flowCount === 0) {
    return Result.fail(
      flowCount === 0
        ? "The map has no flows, so there is no flow picker."
        : "The flow picker shows only in the last chapter. Go there first."
    );
  }

  const found = Arr.findFirst(options, ({ key }) => key === flow);

  return Option.isSome(found)
    ? Result.succeed(found.value)
    : Result.fail(
        `There is no flow choice ${quoted(flow)}. The choices are ${Arr.join(
          Arr.map(options, ({ key, label }) => `${quoted(key)} (${label})`),
          ", "
        )}.`
      );
};

/**
 * What the agent lights: the union of what hovering each id would light,
 * after checking every id is drawn, so none falls through to the chapter's
 * own play. `null` clears it.
 */
export const agentSpotlightOf = ({
  data,
  hops = [],
  revealed,
  structures = [],
}: {
  readonly data: Pick<MapData, "flows" | "hops">;
  readonly hops?: ReadonlyArray<string>;
  readonly revealed: ReadonlySet<string>;
  readonly structures?: ReadonlyArray<string>;
}): Result.Result<Spotlight | null, string> => {
  const hopById = new Map(Arr.map(data.hops, (hop) => [hop.id, hop]));

  const missingStructure = Arr.findFirst(structures, (id) => !revealed.has(id));

  if (Option.isSome(missingStructure)) {
    return Result.fail(
      `The structure ${quoted(missingStructure.value)} is not shown in this chapter.`
    );
  }

  const missingHop = Arr.findFirst(hops, (id) => {
    const hop = hopById.get(id);

    return (
      hop === undefined || !revealed.has(hop.from) || !revealed.has(hop.to)
    );
  });

  if (Option.isSome(missingHop)) {
    return Result.fail(
      `The hop ${quoted(missingHop.value)} is not drawn in this chapter.`
    );
  }

  const targets: ReadonlyArray<SpotlightTarget> = [
    ...Arr.map(structures, (id) => ({ id, kind: "structure" }) as const),
    ...Arr.map(hops, (id) => ({ id, kind: "hop" }) as const),
  ];

  if (targets.length === 0) {
    return Result.succeed(null);
  }

  const lit = Arr.flatMap(targets, (target) => {
    const one = chapterSpotlightOf({
      choice: { kind: "chapter" },
      data,
      hovered: target,
      pinned: null,
      stop: { plays: [], revealed },
    });

    return one === null ? [] : [one];
  });

  return Result.succeed({
    hops: new Set(Arr.flatMap(lit, (one) => [...one.hops])),
    structures: new Set(Arr.flatMap(lit, (one) => [...one.structures])),
  });
};

/** The notice for a spotlight the agent set, or cleared. */
export const spotlightNoticeOf = ({
  hops = [],
  structures = [],
}: {
  readonly hops?: ReadonlyArray<string>;
  readonly structures?: ReadonlyArray<string>;
}) =>
  structures.length + hops.length === 0
    ? "Agent cleared the spotlight"
    : `Agent spotlit ${[
        ...(structures.length === 0
          ? []
          : [noun(structures.length, "structure")]),
        ...(hops.length === 0 ? [] : [noun(hops.length, "hop")]),
      ].join(" and ")}`;
