import type { Checkable, GridPoint, MapState } from "@axonometric/contracts";
import { Result, Schema } from "effect";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { addChangeOf, previewId } from "./add-change.ts";
import CheckWorker from "./check.worker.ts?worker&inline";
import { DraftAnswer, draftChecker, searchKeyOf } from "./draft-check.ts";
import type { DraftAsk, DraftMap } from "./draft-check.ts";
import {
  DraftOutlineContext,
  DraftSpotContext,
  spotShown,
} from "./draft-spot.ts";
import type {
  ChosenSpot,
  DraftOutline,
  DraftSpot,
  DraftSpotState,
} from "./draft-spot.ts";
import { useChangePreview } from "./drag-preview-context.ts";
import { newStructureFootprint } from "./new-structure.ts";
import { usePlacing } from "./place-context.ts";
import type { Draft } from "./place-context.ts";
import { useProposed } from "./proposed-context.ts";

const decodeAnswer = Schema.decodeUnknownResult(DraftAnswer);

interface DraftChecker {
  readonly ask: (ask: DraftAsk) => void;
  readonly close: () => void;
  readonly map: (map: DraftMap) => void;
}

/**
 * Runs the add form's checks in a worker, off the page's main thread. Where
 * the browser has no workers they run on the page instead, a slice at a
 * time.
 */
const startChecker = (answer: (found: DraftAnswer) => void): DraftChecker => {
  if (!("Worker" in globalThis)) {
    return draftChecker(answer);
  }

  const worker = new CheckWorker({ name: "add form check" });

  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    const decoded = decodeAnswer(event.data);

    if (Result.isSuccess(decoded)) {
      answer(decoded.success);
    }
  });

  const send = (message: DraftAsk | DraftMap) => {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a Worker, not a window
    worker.postMessage(message);
  };

  return {
    ask: send,
    close: () => {
      worker.terminate();
    },
    map: send,
  };
};

/**
 * The add form as one ask: the draft, the spot picked, and the map it's on,
 * as proposed and as shown.
 */
interface Asked {
  readonly draft: Draft;
  readonly map: MapState;
  readonly picked: GridPoint | null;
  readonly shown: Checkable;
}

/** Whether the spot found for `found` is the one `asked` would find. */
const sameSearch = (found: Asked, asked: Asked) =>
  found.map === asked.map &&
  searchKeyOf(found.draft) === searchKeyOf(asked.draft);

/**
 * Holds where the add form's structure would go and keeps the warnings panel
 * current for it, so the form, the map's outline and the map's fit share one
 * search.
 *
 * Finding a spot and checking it route and draw every chapter, which takes
 * seconds on a big map, so both run in a worker and the form keeps up with
 * typing. Each change to the form asks again and stops the ask before. Until
 * the latest ask's spot is found, the map shows the last spot found; until
 * its warnings are in, the panel shows the last ones.
 */
export function DraftSpotProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const placing = usePlacing();
  const proposing = useProposed();
  const panel = useChangePreview();
  const checker = useRef<DraftChecker | undefined>(undefined);
  // The latest ask, numbered, so an answer to an older one or to a form
  // since closed is dropped.
  const asks = useRef<{ asked: Asked | undefined; number: number }>({
    asked: undefined,
    number: 0,
  });
  const [found, setFound] = useState<
    (ChosenSpot & { readonly for: Asked }) | undefined
  >();
  const [checked, setChecked] = useState<Asked | undefined>();
  // Only a page that can propose finds spots, so only it starts the worker.
  // The read-only file and a page with Edit off load nothing.
  const live = proposing !== null;
  const map = proposing?.proposed.state;
  const shown = proposing?.shown;
  const open = placing?.open === true;
  const draft = placing?.draft;
  const picked = placing?.spot ?? null;

  // A new map stops the ask the checker holds, so it is a new ask too.
  const asked = useMemo(
    (): Asked | undefined =>
      !open || draft === undefined || map === undefined || shown === undefined
        ? undefined
        : { draft, map, picked, shown },
    [open, draft, map, picked, shown]
  );

  const onAnswer = useEffectEvent((answer: DraftAnswer) => {
    const { asked: latest, number } = asks.current;

    if (latest === undefined || number !== answer.ask) {
      return;
    }

    if (answer.kind === "spot") {
      setFound({ added: answer.added, for: latest, spot: answer.spot });

      return;
    }

    const change = addChangeOf({
      draft: latest.draft,
      id: previewId,
      spot: answer.spot,
    });

    setChecked(latest);

    if (change !== undefined) {
      panel?.show({
        problems: answer.problems,
        refusal: proposing?.refusalOf(change),
      });
    }
  });

  useEffect(() => {
    const started = live
      ? startChecker((answer) => {
          onAnswer(answer);
        })
      : undefined;

    checker.current = started;

    return () => {
      checker.current = undefined;
      started?.close();
    };
  }, [live]);

  // The checker gets the map whenever it changes, such as after a proposal
  // is saved. A checker that starts when Edit turns on hears it too.
  useEffect(() => {
    if (live && map !== undefined && shown !== undefined) {
      checker.current?.map({
        data: map.data,
        kind: "draft map",
        layout: map.layout,
        shown: shown.layout,
      });
    }
  }, [live, map, shown]);

  useEffect(() => {
    if (asked === undefined) {
      return;
    }

    const number = asks.current.number + 1;

    asks.current = { asked, number };

    // A blank name proposes nothing, so it has no warnings to wait for.
    if (asked.draft.name.trim() === "") {
      panel?.clear();
    }

    checker.current?.ask({
      ask: number,
      draft: asked.draft,
      kind: "draft ask",
      picked: asked.picked,
    });
  }, [asked, panel]);

  // The panel and the last spot belong to this opening of the form.
  useEffect(
    () => () => {
      if (open) {
        asks.current = { asked: undefined, number: asks.current.number };
        panel?.clear();
        setFound(undefined);
        setChecked(undefined);
      }
    },
    [open, panel]
  );

  const pickedSpot = useMemo(
    () =>
      picked === null ? undefined : { ...picked, ...newStructureFootprint },
    [picked]
  );

  const value = useMemo((): DraftSpotState | null => {
    if (asked === undefined || !live) {
      return null;
    }

    const spot: DraftSpot =
      pickedSpot === undefined
        ? found !== undefined && sameSearch(found.for, asked)
          ? { added: found.added, kind: "chosen", spot: found.spot }
          : {
              kind: "finding",
              last:
                found === undefined
                  ? undefined
                  : { added: found.added, spot: found.spot },
            }
        : { kind: "picked", spot: pickedSpot };

    const warned = asked.draft.name.trim() === "" || checked === asked;

    return { checking: spot.kind === "finding" || !warned, spot };
  }, [asked, live, pickedSpot, found, checked]);

  const shownSpot = value === null ? undefined : spotShown(value.spot);
  const outlined = value !== null;

  const outline = useMemo(
    (): DraftOutline | null =>
      outlined ? { picked: pickedSpot !== undefined, spot: shownSpot } : null,
    [outlined, pickedSpot, shownSpot]
  );

  return (
    <DraftSpotContext value={value}>
      <DraftOutlineContext value={outline}>{children}</DraftOutlineContext>
    </DraftSpotContext>
  );
}
