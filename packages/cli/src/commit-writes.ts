import {
  commitBatch,
  commitMessage,
  historyFolder,
  Layout,
  maxMessageLength,
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

import { siteOutputs, systemOf } from "./build.ts";
import { encodeRevision, nextRevision } from "./history.ts";
import { withLock } from "./lock.ts";
import { encodeLayout, encodeProposals } from "./map-files.ts";
import { loadReviewMap, ReviewRefused } from "./review-shared.ts";
import { writeAll } from "./write-files.ts";

const sameLayout = Schema.toEquivalence(Layout);

/** What a commit did, for the command to print. */
export interface Committed {
  readonly accepted: number;
  readonly batch: Batch;
  readonly changed: number;
  readonly message: string;
  readonly proposals: Proposals;
  readonly rejected: number;
  readonly revision: number;
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

  const tooLong = Option.filter(
    Option.map(given, Str.trim),
    (message) => message.length > maxMessageLength
  );

  if (Option.isSome(tooLong)) {
    return yield* ReviewRefused.make({
      command: "commit",
      reason: `The message is ${tooLong.value.length} characters, over the limit of ${maxMessageLength}. Say it shorter.`,
    });
  }

  yield* withLock(home, "commit");

  const map = yield* loadReviewMap(home, "commit");

  const number = yield* nextRevision(home);
  const currentTime = yield* DateTime.now;
  const at = DateTime.formatIso(currentTime);

  const committing = commitBatch({
    at,
    data: map.data,
    hops: map.data.hops,
    layout: map.layout,
    proposals: map.proposals,
    revision: number,
    saved: map.saved,
  });

  if (Result.isFailure(committing)) {
    return yield* ReviewRefused.make({
      command: "commit",
      reason: committing.failure,
    });
  }

  const { accepted, batch, proposals, rejected } = committing.success;
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
    accepted,
    data: map.data,
    format: 1,
    layout,
    message: text,
    rejected,
    revision: number,
    savedAt: at,
  };

  const state: MapState = {
    data: map.data,
    layout,
    sourceLinks: map.sourceLinks,
    system: yield* systemOf(home),
  };

  const site = yield* siteOutputs(state, home);

  yield* writeAll([
    {
      content: yield* encodeRevision(revision),
      exclusive: true,
      file: path.join(home, historyFolder, revisionFileName(number)),
    },
    ...(changedLayout
      ? [
          {
            content: yield* encodeLayout(layout),
            file: path.join(home, "layout.json"),
          },
        ]
      : []),
    {
      content: yield* encodeProposals(proposals),
      file: path.join(home, "proposals.json"),
    },
    ...site.outputs,
  ]);

  const count = (kind: string) =>
    Arr.filter(verdicts, ({ verdict }) => verdict === kind).length;

  return {
    accepted: count("accepted"),
    batch,
    changed: count("changed"),
    message: text,
    proposals,
    rejected: count("rejected"),
    revision: number,
  } satisfies Committed;
}, Effect.scoped);
