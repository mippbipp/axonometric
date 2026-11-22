/* oxlint-disable perfectionist/sort-objects -- schema field order sets encoded JSON key order, so it stays as written */
import {
  defaultSpotTurns,
  GridPoint,
  Layout,
  MapData,
  Placement,
  proposalProblemsTurns,
  Shape,
  Status,
} from "@axonometric/contracts";
import type { DefaultSpot, Turns } from "@axonometric/contracts";
import { Clock, Effect, Fiber, Schema } from "effect";

import { addChangeOf, previewId } from "./add-change.ts";
import { CheckedProblem } from "./drag-check.ts";
import { newStructureFootprint } from "./new-structure.ts";
import { structureItem } from "./proposal-items.ts";

/**
 * The map the add form's draft goes on. `layout` is the map as proposed,
 * where the spot search looks. `shown` is that map with the frozen layout
 * changes applied, as the page draws it, which the warnings compare with.
 * The page sends it once per map, so the checker keeps the same objects and
 * remembers the chapters it has drawn.
 */
export const DraftMap = Schema.Struct({
  kind: Schema.Literal("draft map"),
  data: MapData,
  layout: Layout,
  shown: Layout,
});

/**
 * The add form as it stands. `ask` names it, so the page can drop answers to
 * a draft it has moved past. `picked` is the spot the engineer picked or
 * typed; with none, the checker finds one.
 */
export const DraftAsk = Schema.Struct({
  kind: Schema.Literal("draft ask"),
  ask: Schema.Int,
  draft: Schema.Struct({
    group: Schema.String,
    name: Schema.String,
    shape: Shape,
    status: Status,
  }),
  picked: Schema.NullOr(GridPoint),
});

/**
 * The add form closed: stop the ask being checked. The map stays held, so
 * the next opening of the form doesn't send it again.
 */
export const DraftStop = Schema.Struct({
  kind: Schema.Literal("draft stop"),
});

export const DraftRequest = Schema.Union([DraftMap, DraftAsk, DraftStop]);

export type DraftMap = typeof DraftMap.Type;

export type DraftAsk = typeof DraftAsk.Type;

export type DraftStop = typeof DraftStop.Type;

export type DraftRequest = typeof DraftRequest.Type;

/**
 * What the checker found for an ask: the spot it chose, when the engineer
 * picked none, and then what `check` would report with the structure at
 * `spot`, when the name isn't blank.
 */
export const DraftAnswer = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("spot"),
    ask: Schema.Int,
    spot: Placement,
    added: Schema.Int,
  }),
  Schema.Struct({
    kind: Schema.Literal("problems"),
    ask: Schema.Int,
    spot: Placement,
    problems: Schema.Array(CheckedProblem),
  }),
]);

export type DraftAnswer = typeof DraftAnswer.Type;

/** How long the checker works before it gives the thread back. */
const sliceMillis = 10;

/**
 * Runs `turns` to the end, giving the thread back once a slice of work has
 * passed. Most turns of a spot search reuse a chapter already drawn and take
 * no time, so a yield per turn would spend the search waiting on timers,
 * which a browser holds to at least 4 ms each once they nest.
 */
const runTurns = Effect.fnUntraced(function* <A>(turns: Turns<A>) {
  let since = yield* Clock.currentTimeMillis;

  for (;;) {
    const turn = turns.next();

    if (turn.done === true) {
      return turn.value;
    }

    const now = yield* Clock.currentTimeMillis;

    if (now - since >= sliceMillis) {
      yield* Effect.yieldNow;
      since = yield* Clock.currentTimeMillis;
    }
  }
});

/** What the spot search depends on in a draft: not its status. */
export const searchKeyOf = (draft: DraftAsk["draft"]) =>
  // oxlint-disable-next-line effecttsgo/global-json -- a cache key, never decoded
  JSON.stringify([draft.group, draft.shape, draft.name.trim()]);

/** The last spot found on the map held, and the search it answers. */
type LastSearch =
  | { readonly found: DefaultSpot; readonly key: string }
  | undefined;

/**
 * Finds the spot `defaultSpotFor` would for the draft, and tells the page. A
 * draft that differs only in its status reuses the last search.
 */
const findSpot = Effect.fnUntraced(function* ({
  answer,
  ask: { ask, draft },
  held,
  map,
}: {
  readonly answer: (found: DraftAnswer) => void;
  readonly ask: DraftAsk;
  readonly held: Held;
  readonly map: DraftMap;
}) {
  const key = searchKeyOf(draft);
  const name = draft.name.trim();

  const { added, spot } =
    held.search?.key === key
      ? held.search.found
      : yield* runTurns(
          defaultSpotTurns({
            data: map.data,
            group: draft.group,
            layout: map.layout,
            name: name === "" ? "New structure" : name,
            shape: draft.shape,
          })
        );

  held.search = { found: { added, spot }, key };
  answer({ kind: "spot", ask, spot, added });

  return spot;
});

const checkDraft = Effect.fnUntraced(function* ({
  answer,
  ask,
  held,
  map,
}: {
  readonly answer: (found: DraftAnswer) => void;
  readonly ask: DraftAsk;
  readonly held: Held;
  readonly map: DraftMap;
}) {
  // Keys typed while a chapter was drawing are queued behind it. Yielding
  // first lets them stop this ask before it draws anything.
  yield* Effect.yieldNow;

  const spot =
    ask.picked === null
      ? yield* findSpot({ answer, ask, held, map })
      : { ...ask.picked, ...newStructureFootprint };

  const change = addChangeOf({ draft: ask.draft, id: previewId, spot });

  if (change === undefined) {
    return;
  }

  const problems = yield* runTurns(
    proposalProblemsTurns({
      before: { data: map.data, layout: map.shown },
      items: [structureItem(change)],
    })
  );

  answer({ kind: "problems", ask: ask.ask, spot, problems });
});

/**
 * Draws the map as proposed and as shown, which every spot the search tries
 * and every warnings check compares with. Each chapter drawn is remembered,
 * and a chapter that doesn't reveal the new structure draws as it does
 * without it, so the first search after the map arrives draws only the
 * chapters that do.
 */
const warmUp = Effect.fnUntraced(function* ({ data, layout, shown }: DraftMap) {
  for (const drawn of [layout, shown]) {
    yield* runTurns(
      proposalProblemsTurns({ before: { data, layout: drawn }, items: [] })
    );
  }
});

/** What a checker holds between messages: the map, and the ask it checks. */
interface Held {
  checking: Fiber.Fiber<void> | undefined;
  map: DraftMap | undefined;
  search: LastSearch;
}

/**
 * Checks the add form's drafts, one at once: a new map or ask stops the ask
 * being checked, and so does `stop`, when the form closes. `answer` hears the
 * spot each ask finds and its warnings. The worker runs one, and so does the
 * page where there are no workers. `warm` draws the map held until an ask
 * stops it. The worker calls it after each map; the page doesn't, as
 * drawing would hold its main thread.
 */
export const draftChecker = (answer: (found: DraftAnswer) => void) => {
  const held: Held = { checking: undefined, map: undefined, search: undefined };

  const stop = () => {
    if (held.checking !== undefined) {
      Effect.runFork(Fiber.interrupt(held.checking));
      held.checking = undefined;
    }
  };

  return {
    ask: (ask: DraftAsk) => {
      stop();

      if (held.map !== undefined) {
        held.checking = Effect.runFork(
          checkDraft({ answer, ask, held, map: held.map })
        );
      }
    },
    close: stop,
    stop,
    map: (map: DraftMap) => {
      stop();
      held.map = map;
      held.search = undefined;
    },
    warm: () => {
      stop();

      if (held.map !== undefined) {
        held.checking = Effect.runFork(warmUp(held.map));
      }
    },
  };
};
