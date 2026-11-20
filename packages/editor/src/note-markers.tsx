import {
  groundOutline,
  groundProjections,
  hopLabelOf,
  noteMarkerRadius,
  noteMarkerStroke,
  toPoints,
} from "@axonometric/contracts";
import type { NoteMarkerSpot, NoteTarget, Scene } from "@axonometric/contracts";
import { Array as Arr, Match, Option } from "effect";
import type { KeyboardEvent } from "react";

import { placedMarkers, useNoteBearers } from "./note-bearers.ts";
import { useNoteTool } from "./note-tool-context.ts";
import { entriesOfKind, useReview } from "./review-context.ts";
import { useSelection } from "./selection-context.ts";
import { useStructuresById } from "./structures.ts";
import { useWalkthrough } from "./walkthrough-context.ts";

/** What the notes on one target add up to, for its ring. */
interface Tally {
  readonly count: number;
  /** Whether the agent rejected one of them. */
  readonly rejected: boolean;
  readonly target: NoteTarget;
}

const sameTarget = (a: NoteTarget, b: NoteTarget): boolean =>
  Match.value(a).pipe(
    Match.discriminatorsExhaustive("kind")({
      hop: ({ id }) => b.kind === "hop" && b.id === id,
      spot: ({ x, y }) => b.kind === "spot" && b.x === x && b.y === y,
      structure: ({ id }) => b.kind === "structure" && b.id === id,
    })
  );

const colourOf = (rejected: boolean) =>
  rejected ? "stroke-refused" : "stroke-pending";

/** How a ring is named: `Note on "Save server"`, or `2 notes on hop "POST /proposals"`. */
const nameOfRing = ({
  count,
  what,
}: {
  readonly count: number;
  readonly what: string;
}): string => `${count === 1 ? "Note" : `${count} notes`} ${what}`;

/** A ring the engineer can reach with the keyboard and press to open its target. */
function Ring({
  at,
  id,
  name,
  onOpen,
  tally,
}: {
  readonly at: NoteMarkerSpot;
  readonly id: string;
  readonly name: string;
  readonly onOpen: () => void;
  readonly tally: Tally;
}) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  };

  return (
    <g
      aria-label={name}
      className="focus-visible:outline-ink cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-dashed"
      data-note-marker={id}
      data-note-placed="ring"
      data-note-rejected={tally.rejected}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      onKeyDown={onKeyDown}
      pointerEvents="all"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- SVG has no <button> element, so the ring's group takes the button role.
      role="button"
      tabIndex={0}
    >
      <title>{name}</title>
      <circle
        className={`${colourOf(tally.rejected)} fill-none`}
        cx={at.sx}
        cy={at.sy}
        r={noteMarkerRadius}
        strokeWidth={noteMarkerStroke}
      />
      <circle
        cx={at.sx}
        cy={at.sy}
        fill="transparent"
        r={noteMarkerRadius + 2}
        stroke="none"
      />
    </g>
  );
}

/**
 * Marks each structure, hop and empty spot that has a note, without text. A
 * small ring sits in the first place clear of boxes, name tags, chips, zone
 * titles, hop labels and hop lines, with the same visible gap from each
 * (`placeNoteMarkers` says where). A structure with no clear place has its
 * own footprint outlined instead; a hop or spot with none has no marker, and
 * its panel and the Pending tab still list the notes. Rejected notes draw in
 * the refused colour, the rest in the pending colour. The numbers and verdict
 * wording live in the side panel and the Pending tab.
 *
 * Each ring is a button, reachable with Tab and named for what it marks:
 * Enter, Space or a press opens the structure's, hop's or spot's panel.
 *
 * This is an editing layer: a file's drawing never includes it.
 */
export function NoteMarkers({ scene }: { readonly scene: Scene }) {
  const review = useReview();
  const bearers = useNoteBearers();
  const { select, selectHop } = useSelection();
  const tool = useNoteTool();
  const byId = useStructuresById();
  const { state } = useWalkthrough();

  if (review === null || bearers === null) {
    return null;
  }

  const hopName = hopLabelOf(state.data.hops);
  const placed = placedMarkers(scene, bearers);

  const tallies = Arr.reduce(
    entriesOfKind(review.entries, "note"),
    Arr.empty<Tally>(),
    (found, { item, status }) => {
      const rejected =
        status.state === "reviewed" && status.verdict.verdict === "rejected";

      const known = Arr.some(found, ({ target }) =>
        sameTarget(target, item.target)
      );

      return known
        ? Arr.map(found, (before) =>
            sameTarget(before.target, item.target)
              ? {
                  ...before,
                  count: before.count + 1,
                  rejected: before.rejected || rejected,
                }
              : before
          )
        : [...found, { count: 1, rejected, target: item.target }];
    }
  );

  const tallyOf = (target: NoteTarget) =>
    Arr.findFirst(tallies, (found) => sameTarget(found.target, target));

  return (
    <g>
      {Arr.flatMap(scene.structures, ({ placement, structure }) => {
        const target: NoteTarget = { id: structure.id, kind: "structure" };
        const tally = Option.getOrUndefined(tallyOf(target));

        if (tally === undefined) {
          return [];
        }

        const at = placed.structures.get(structure.id);

        if (at !== undefined) {
          return [
            <Ring
              at={at}
              id={structure.id}
              key={`structure:${structure.id}`}
              name={nameOfRing({
                count: tally.count,
                what: `on "${byId.get(structure.id)?.name ?? structure.id}"`,
              })}
              onOpen={() => {
                select(structure.id);
              }}
              tally={tally}
            />,
          ];
        }

        return [
          <polygon
            className={`${colourOf(tally.rejected)} fill-none`}
            data-note-marker={structure.id}
            data-note-placed="outline"
            data-note-rejected={tally.rejected}
            key={`structure:${structure.id}`}
            pointerEvents="none"
            points={toPoints(
              groundOutline(placement, groundProjections[scene.view])
            )}
            strokeDasharray="1 3"
            strokeWidth={1.6}
          />,
        ];
      })}
      {Arr.flatMap([...placed.hops.entries()], ([hop, at]) => {
        const tally = Option.getOrUndefined(tallyOf({ id: hop, kind: "hop" }));

        return tally === undefined
          ? []
          : [
              <Ring
                at={at}
                id={`hop:${hop}`}
                key={`hop:${hop}`}
                name={nameOfRing({
                  count: tally.count,
                  what: `on hop "${hopName(hop)}"`,
                })}
                onOpen={() => {
                  selectHop(hop);
                }}
                tally={tally}
              />,
            ];
      })}
      {Arr.flatMap(placed.spots, ({ marker, spot }) => {
        const tally = Option.getOrUndefined(tallyOf({ kind: "spot", ...spot }));

        return tally === undefined
          ? []
          : [
              <Ring
                at={marker}
                id={`spot:${spot.x},${spot.y}`}
                key={`spot:${spot.x},${spot.y}`}
                name={nameOfRing({
                  count: tally.count,
                  what: `at the spot ${spot.x}, ${spot.y}`,
                })}
                onOpen={() => {
                  tool?.pick(spot);
                }}
                tally={tally}
              />,
            ];
      })}
    </g>
  );
}
