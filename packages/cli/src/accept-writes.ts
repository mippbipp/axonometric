import {
  acceptanceMessage,
  acceptRefusal,
  hopLabelOf,
  layoutUnderProposals,
  acceptLayoutChanges,
  LayoutChangeRefused,
  MapFilesUnreadable,
  placeStructures,
} from "@axonometric/contracts";
import type {
  Accepted,
  AcceptWrite,
  HistoryList,
  LayoutChange,
  MapState,
  Proposals,
  Revision,
} from "@axonometric/contracts";
import {
  Array as Arr,
  DateTime,
  Effect,
  Option,
  Result,
  String as Str,
} from "effect";

import { siteOutputs } from "./build.ts";
import { encodeRevision, loadHistory, nextRevision } from "./history.ts";
import type { HomePaths } from "./home-paths.ts";
import { encodeLayout, encodeProposals, loadMap } from "./map-files.ts";
import { loadForWrite } from "./pending-writes.ts";
import { writeAll } from "./write-files.ts";

/** What accepting changes leaves the server holding. */
export interface AcceptedState {
  /** The pending changes this accept applied. */
  readonly accepted: ReadonlyArray<LayoutChange>;
  /**
   * Every revision that reads, newest first, read from `history/` once the
   * new revision is saved and still under the lock. Taking it from disk
   * keeps a revision the CLI saved a moment before from being lost.
   */
  readonly history: HistoryList;
  readonly proposals: Proposals;
  readonly state: MapState;
}

/**
 * Accepts the pending layout changes named in `write`, under the lock. In one
 * `writeAll` it writes the new revision file `history/<n>.json`, `layout.json`
 * with the changes applied, `proposals.json` without them, and SYSTEM.md and
 * the read-only page for the new layout. If any of those fails, none of them
 * changes. The write is refused, and nothing written, when
 * `write.baseFileRevision` isn't the file's revision, when a change id isn't a
 * pending layout change, or when applying the set would overlap footprints.
 * Pending changes that the accepted ones override are dropped from
 * `proposals.json`, and the message says so.
 * `written` runs under the lock, once the files are saved, to tell the open
 * pages.
 */
export const acceptPendingLayout = Effect.fn("acceptPendingLayout")(function* (
  paths: HomePaths,
  write: AcceptWrite,
  written: (held: AcceptedState) => Effect.Effect<void>
) {
  // Everything is read under the lock, so nothing moves before the write.
  // A map with an error can't be snapshotted, so it isn't accepted into.
  const map = yield* loadForWrite(
    paths,
    write.baseFileRevision,
    loadMap({
      arrange: (data, saved) => placeStructures(data, saved).layout,
      command: "accept",
      paths,
      strictProposals: true,
    }).pipe(
      Effect.catchTag("MapInvalid", ({ problems }) =>
        MapFilesUnreadable.make({ problems })
      )
    )
  );

  const current = map.proposals;

  // Frozen changes wait for the agent. An accept on a structure they also
  // change waits too, and the rest is checked on top of them.
  const waiting = acceptRefusal({
    proposals: current,
    // Structures the engineer has proposed take ground too.
    hops: map.data.hops,
    ids: write.changeIds,
    layout: layoutUnderProposals({
      data: map.data,
      layout: map.layout,
      proposals: current,
    }),
  });

  if (Option.isSome(waiting)) {
    return yield* LayoutChangeRefused.make({
      proposals: current,
      reason: waiting.value,
    });
  }

  const result = acceptLayoutChanges({
    hops: map.data.hops,
    ids: write.changeIds,
    layout: map.layout,
    pending: current.layout,
  });

  if (Result.isFailure(result)) {
    return yield* LayoutChangeRefused.make({
      proposals: current,
      reason: result.failure,
    });
  }

  const { accepted, dropped, layout, remaining } = result.success;

  const structureNames = new Map(
    Arr.map(map.data.structures, ({ id, name }) => [id, name])
  );

  const given = Str.trim(write.message ?? "");

  const message =
    given === ""
      ? acceptanceMessage(accepted, (id) => structureNames.get(id) ?? id, {
          dropped,
          hopNameOf: hopLabelOf(map.data.hops),
        })
      : given;

  const number = yield* nextRevision(paths);
  const revisionFile = paths.revisionFile(number);

  const now = yield* DateTime.now;
  const savedAt = DateTime.formatIso(now);

  const revision: Revision = {
    accepted: Arr.map(accepted, (change) => ({
      change,
      id: change.id,
      kind: "layout",
    })),
    data: map.data,
    format: 1,
    layout,
    message,
    rejected: [],
    revision: number,
    savedAt,
  };

  const proposals: Proposals = {
    ...current,
    layout: remaining,
    revision: current.revision + 1,
  };

  const state: MapState = {
    data: map.data,
    layout,
    sourceLinks: map.sourceLinks,
    system: paths.system,
  };

  const site = yield* siteOutputs(state, paths);

  // Revision files are never rewritten, so the revision's file is exclusive:
  // writeAll fails before it renames anything if the file exists.
  yield* writeAll([
    {
      content: yield* encodeRevision(revision),
      exclusive: true,
      file: revisionFile,
    },
    {
      content: yield* encodeLayout(layout),
      file: paths.layoutFile,
    },
    {
      content: yield* encodeProposals(proposals),
      file: paths.proposalsFile,
    },
    ...site,
  ]);

  // Still under the lock, so quick writes tell the pages in order.
  yield* written({
    accepted,
    history: yield* loadHistory(paths, []),
    proposals,
    state,
  });

  return {
    layout,
    message,
    proposals,
    revision: number,
  } satisfies Accepted;
}, Effect.scoped);
