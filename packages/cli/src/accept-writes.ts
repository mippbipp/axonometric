import {
  acceptanceMessage,
  acceptLayoutChanges,
  historyFolder,
  LayoutChangeRefused,
  MapFilesUnreadable,
  placeStructures,
  revisionFileName,
} from "@axonometric/contracts";
import type {
  Accepted,
  AcceptWrite,
  MapState,
  Proposals,
  Revision,
} from "@axonometric/contracts";
import {
  Array as Arr,
  DateTime,
  Effect,
  Path,
  Result,
  String as Str,
} from "effect";

import { siteOutputs, systemOf } from "./build.ts";
import { encodeRevision, nextRevision } from "./history.ts";
import { encodeLayout, encodeProposals, loadMap } from "./map-files.ts";
import { loadForWrite } from "./pending-writes.ts";
import { writeAll } from "./write-files.ts";

/** What accepting changes leaves the server holding. */
export interface AcceptedState {
  readonly state: MapState;
  readonly proposals: Proposals;
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
  home: string,
  write: AcceptWrite,
  written: (held: AcceptedState) => Effect.Effect<void>
) {
  const path = yield* Path.Path;

  // Everything is read under the lock, so nothing moves before the write.
  // A map with an error can't be snapshotted, so it isn't accepted into.
  const map = yield* loadForWrite(
    home,
    write.baseFileRevision,
    loadMap({
      home,
      output: path.dirname(home),
      command: "accept",
      arrange: (data, saved) => placeStructures(data, saved).layout,
      strictProposals: true,
    }).pipe(
      Effect.catchTag("MapInvalid", ({ problems }) =>
        MapFilesUnreadable.make({ problems })
      )
    )
  );

  const current = map.proposals;

  const result = acceptLayoutChanges({
    layout: map.layout,
    pending: current.layout,
    ids: write.changeIds,
  });

  if (Result.isFailure(result)) {
    return yield* LayoutChangeRefused.make({
      reason: result.failure,
      proposals: current,
    });
  }

  const { accepted, remaining, dropped, layout } = result.success;

  const structureNames = new Map(
    Arr.map(map.data.structures, ({ id, name }) => [id, name])
  );

  const given = Str.trim(write.message ?? "");

  const message =
    given === ""
      ? acceptanceMessage(
          accepted,
          (id) => structureNames.get(id) ?? id,
          dropped
        )
      : given;

  const number = yield* nextRevision(home);
  const revisionFile = path.join(home, historyFolder, revisionFileName(number));

  const revision: Revision = {
    format: 1,
    revision: number,
    savedAt: DateTime.formatIso(yield* DateTime.now),
    message,
    accepted: Arr.map(accepted, (change) => ({ kind: "layout", change })),
    rejected: [],
    data: map.data,
    layout,
  };

  const proposals: Proposals = {
    ...current,
    revision: current.revision + 1,
    layout: remaining,
  };

  const state: MapState = {
    system: yield* systemOf(home),
    data: map.data,
    layout,
    sourceLinks: map.sourceLinks,
  };

  const site = yield* siteOutputs(state, home);

  // Revision files are never rewritten, so the revision's file is exclusive:
  // writeAll fails before it renames anything if the file exists.
  yield* writeAll([
    {
      file: revisionFile,
      content: yield* encodeRevision(revision),
      exclusive: true,
    },
    {
      file: path.join(home, "layout.json"),
      content: yield* encodeLayout(layout),
    },
    {
      file: path.join(home, "proposals.json"),
      content: yield* encodeProposals(proposals),
    },
    ...site.outputs,
  ]);

  // Still under the lock, so quick writes tell the pages in order.
  yield* written({ state, proposals });

  return {
    revision: number,
    message,
    layout,
    proposals,
  } satisfies Accepted;
}, Effect.scoped);
