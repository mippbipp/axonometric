import {
  commitBatch,
  commitMessage,
  historyFolder,
  Layout,
  placeStructures,
  revisionFileName,
} from "@axonometric/contracts";
import type {
  Batch,
  MapState,
  Proposals,
  Revision,
} from "@axonometric/contracts";
import {
  Array as Arr,
  DateTime,
  Effect,
  Option,
  Path,
  Record as Rec,
  Result,
  Schema,
  String as Str,
} from "effect";
import { CliError } from "effect/cli";

import { siteOutputs, systemOf } from "./build.ts";
import { encodeRevision, nextRevision } from "./history.ts";
import { withLock } from "./lock.ts";
import { encodeLayout, encodeProposals, loadMap } from "./map-files.ts";
import { writeAll } from "./write-files.ts";

/** A `verdict` or `commit` the batch can't take. Nothing was written. */
export class ReviewRefused extends Schema.TaggedError<
  ReviewRefused,
  { readonly brand: unique symbol }
>()("ReviewRefused", { command: Schema.String, reason: Schema.String }) {
  public override get [CliError.userMessage]() {
    return `${this.reason} ${this.command} wrote nothing.`;
  }
}

const sameLayout = Schema.toEquivalence(Layout);

/** What a commit did, for the command to print. */
export interface Committed {
  readonly batch: Batch;
  readonly revision: number;
  readonly message: string;
  readonly accepted: number;
  readonly changed: number;
  readonly rejected: number;
  readonly proposals: Proposals;
}

/**
 * Commits the oldest batch with no commit, under the lock. In one `writeAll`
 * it writes the new revision file, `layout.json` when the accepted layout
 * changed, `proposals.json` with the batch marked committed, and SYSTEM.md
 * and the read-only page. If any of those fails, none changes. Refuses, and
 * writes nothing, when `data.mjs` or the other map files have an error, no
 * batch is waiting, an item has no verdict, or the accepted layout changes
 * can't all be applied.
 */
export const commitOldestBatch = Effect.fn("commitOldestBatch")(function* (
  home: string,
  given: Option.Option<string>
) {
  const path = yield* Path.Path;

  yield* withLock(home, "commit");

  const map = yield* loadMap({
    home,
    output: path.dirname(home),
    command: "commit",
    arrange: (data, saved) => placeStructures(data, saved).layout,
    strictProposals: true,
  });

  const number = yield* nextRevision(home);
  const at = DateTime.formatIso(yield* DateTime.now);

  const committing = commitBatch({
    proposals: map.proposals,
    layout: map.layout,
    revision: number,
    at,
  });

  if (Result.isFailure(committing)) {
    return yield* ReviewRefused.make({
      command: "commit",
      reason: committing.failure,
    });
  }

  const { batch, accepted, rejected, proposals } = committing.success;
  const verdicts = Rec.values(batch.verdicts);

  const text = Option.match(
    Option.filter(given, (m) => Str.trim(m) !== ""),
    {
      onNone: () => commitMessage(batch),
      onSome: Str.trim,
    }
  );

  // Placing structures that had no position also changes the layout, and a
  // layout that changed must carry a higher file revision.
  const changedLayout = !sameLayout(committing.success.layout, map.saved);

  const layout: Layout = changedLayout
    ? {
        ...committing.success.layout,
        revision: Math.max(
          committing.success.layout.revision,
          map.saved.revision + 1
        ),
      }
    : map.saved;

  const revision: Revision = {
    format: 1,
    revision: number,
    savedAt: at,
    message: text,
    accepted,
    rejected,
    data: map.data,
    layout,
  };

  const state: MapState = {
    system: yield* systemOf(home),
    data: map.data,
    layout,
    sourceLinks: map.sourceLinks,
  };

  const site = yield* siteOutputs(state, home);

  yield* writeAll([
    {
      file: path.join(home, historyFolder, revisionFileName(number)),
      content: yield* encodeRevision(revision),
      exclusive: true,
    },
    ...(changedLayout
      ? [
          {
            file: path.join(home, "layout.json"),
            content: yield* encodeLayout(layout),
          },
        ]
      : []),
    {
      file: path.join(home, "proposals.json"),
      content: yield* encodeProposals(proposals),
    },
    ...site.outputs,
  ]);

  const count = (kind: string) =>
    Arr.filter(verdicts, ({ verdict }) => verdict === kind).length;

  return {
    batch,
    revision: number,
    message: text,
    accepted: count("accepted"),
    changed: count("changed"),
    rejected: count("rejected"),
    proposals,
  } satisfies Committed;
}, Effect.scoped);
