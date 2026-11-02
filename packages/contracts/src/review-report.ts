import { Schema } from "effect";

import { ChangeId, verdictKinds } from "./proposals.ts";

const Spot = Schema.Struct({ x: Schema.Finite, y: Schema.Finite });

const Size = Schema.Struct({ w: Schema.Finite, d: Schema.Finite });

/**
 * Text an item holds: a note's text and the spot it is pinned to, a text
 * suggestion's field and text, or an answer's question, text and date.
 */
const TextFacts = Schema.Struct({
  text: Schema.String,
  field: Schema.optionalKey(Schema.String),
  question: Schema.optionalKey(Schema.String),
  answeredOn: Schema.optionalKey(Schema.String),
  spot: Schema.optionalKey(Spot),
});

/**
 * What an item changes or leaves: positions, a size, text, or a hop's
 * route, which is "automatic" or a route override's points.
 */
const Route = Schema.Struct({
  route: Schema.Union([Schema.Literal("automatic"), Schema.Array(Spot)]),
});

/**
 * A structure as a proposal adds or changes it: the fields that differ, or
 * all of them for a new structure, and `deleted: true` when it is removed.
 */
const StructureFacts = Schema.Struct({
  structure: Schema.Record(Schema.String, Schema.Json),
});

/**
 * A hop as a proposal draws, deletes or relabels it: the fields that differ,
 * or all of them for a new hop, and `deleted: true` when it is removed.
 */
const HopFacts = Schema.Struct({
  hop: Schema.Record(Schema.String, Schema.Json),
});

/**
 * A flow as a proposal creates or changes it: its name, or its ordered hops,
 * or for a reorder the ids of the flows in their new order.
 */
const FlowFacts = Schema.Struct({
  flow: Schema.Record(Schema.String, Schema.Json),
});

/** A group as a proposal adds or renames it: its id and title. */
const GroupFacts = Schema.Struct({
  group: Schema.Record(Schema.String, Schema.Json),
});

/** A chapter's reveals or plays, before or after a chapter proposal. */
const ChapterFacts = Schema.Struct({
  chapter: Schema.Record(Schema.String, Schema.Json),
});

export const Facts = Schema.NullOr(
  Schema.Union([
    StructureFacts,
    HopFacts,
    FlowFacts,
    GroupFacts,
    ChapterFacts,
    Schema.Record(Schema.String, Spot),
    Size,
    TextFacts,
    Route,
  ])
);

export type Facts = typeof Facts.Type;

/** A verdict as `review` reports it. */
export const VerdictFacts = Schema.Struct({
  verdict: Schema.Literals(verdictKinds),
  reason: Schema.optionalKey(Schema.String),
});

/** One item of the batch, as `review --json` prints it. */
export const ReportedItem = Schema.Struct({
  id: ChangeId,
  kind: Schema.String,
  /** Where the item is listed: a diagram change or a chapter change. */
  section: Schema.Literals(["diagram", "chapter"]),
  /** The structures the item acts on or is pinned to. */
  targets: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String })
  ),
  /** What the map has now, or null for an item that adds something. */
  before: Facts,
  /** What accepting the item makes. */
  after: Facts,
  /** Why accepting the item would break the map, or null when it wouldn't. */
  breaks: Schema.NullOr(Schema.String),
  /**
   * Why the item was written against something data.mjs no longer says,
   * such as a text suggestion whose original has changed, or null.
   */
  outOfDate: Schema.NullOr(Schema.String),
  /** The rejected item this one takes up again, or null. */
  replaces: Schema.NullOr(ChangeId),
  verdict: Schema.NullOr(VerdictFacts),
});

export type ReportedItem = typeof ReportedItem.Type;

/** The oldest batch with no commit, with its items. */
export const ReviewedBatch = Schema.Struct({
  number: Schema.Int,
  frozenAt: Schema.String,
  items: Schema.Array(ReportedItem),
});

/** What `review --json` prints. */
export const ReviewReport = Schema.Struct({
  /** The absolute path of the home folder. */
  home: Schema.String,
  /** The oldest batch with no commit, or null when none is waiting. */
  batch: Schema.NullOr(ReviewedBatch),
});

export type ReviewReport = typeof ReviewReport.Type;
