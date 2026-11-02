import {
  groundOutline,
  groundProjections,
  noteMarkerRadius,
  placeNoteMarkers,
  spotKey,
  toPoints,
} from "@axonometric/contracts";
import type { GridPoint, NoteMarkerSpot, Scene } from "@axonometric/contracts";
import { Array as Arr } from "effect";

import { noteTargetKey } from "./note-target.ts";
import { useNoteTool } from "./note-tool-context.ts";
import { entriesOfKind, useReview } from "./review-context.ts";
import { useSelection } from "./selection-context.ts";

/** Whether a marker is drawn in the refused colour, and the key it is found by. */
interface Bearer {
  readonly key: string;
  readonly rejected: boolean;
}

/**
 * Marks each structure, hop and empty spot that has a note, without text. A
 * small ring sits in the first spot clear of boxes, name tags, chips, zone
 * titles, hop labels and hop lines (`placeNoteMarkers` says where). A
 * structure with no clear spot has its own footprint outlined instead; a hop
 * or spot with none has no marker, and its panel and the Pending tab still
 * list the notes. Rejected notes draw in the refused colour, the rest in the
 * pending colour. The numbers and verdict wording live in the side panel and
 * the Pending tab.
 *
 * A ring is a button: pressing a hop's ring opens the hop's panel and
 * pressing a spot's opens the spot's.
 *
 * This is an editing layer: a file's drawing never includes it.
 */
export function NoteMarkers({ scene }: { readonly scene: Scene }) {
  const review = useReview();
  const { selectHop } = useSelection();
  const tool = useNoteTool();

  if (review === null) {
    return null;
  }

  const live = entriesOfKind(review.entries, "note");

  const bearers = Arr.reduce(
    live,
    new Map<string, Bearer>(),
    (found, entry) => {
      const key = noteTargetKey(entry.item.target);

      const rejected =
        entry.status.state === "reviewed" &&
        entry.status.verdict.verdict === "rejected";

      found.set(key, {
        key,
        rejected: (found.get(key)?.rejected ?? false) || rejected,
      });

      return found;
    }
  );

  const targets = Arr.map(live, ({ item }) => item.target);

  const spotTargets: readonly GridPoint[] = Arr.map(
    Arr.dedupe(
      Arr.flatMap(targets, (target) =>
        target.kind === "spot" ? [spotKey(target)] : []
      )
    ),
    (key) => {
      const [x = "0", y = "0"] = key.split(",");

      return { x: Number(x), y: Number(y) };
    }
  );

  const placed = placeNoteMarkers(scene, {
    structures: new Set(
      Arr.flatMap(targets, (target) =>
        target.kind === "structure" ? [target.id] : []
      )
    ),
    hops: new Set(
      Arr.flatMap(targets, (target) =>
        target.kind === "hop" ? [target.id] : []
      )
    ),
    spots: spotTargets,
    ground: groundProjections[scene.view],
  });

  const colourOf = (key: string) =>
    bearers.get(key)?.rejected === true ? "stroke-refused" : "stroke-pending";

  const ring = ({
    id,
    key,
    at,
    onPress,
  }: {
    readonly id: string;
    readonly key: string;
    readonly at: NoteMarkerSpot;
    readonly onPress: () => void;
  }) => (
    <g
      key={key}
      data-note-marker={id}
      data-note-placed="ring"
      data-note-rejected={bearers.get(key)?.rejected === true}
      pointerEvents="all"
      className="cursor-pointer"
      onClick={(event) => {
        event.stopPropagation();
        onPress();
      }}
    >
      <circle
        cx={at.sx}
        cy={at.sy}
        r={noteMarkerRadius}
        className={`${colourOf(key)} fill-none`}
        strokeWidth={2}
      />
      <circle
        cx={at.sx}
        cy={at.sy}
        r={noteMarkerRadius + 2}
        fill="transparent"
      />
    </g>
  );

  return (
    <g>
      <g pointerEvents="none">
        {Arr.flatMap(scene.structures, ({ structure, placement }) => {
          const key = `structure:${structure.id}`;

          if (!bearers.has(key)) {
            return [];
          }

          const spot = placed.structures.get(structure.id);

          return [
            spot === undefined ? (
              <polygon
                key={key}
                data-note-marker={structure.id}
                data-note-placed="outline"
                data-note-rejected={bearers.get(key)?.rejected === true}
                points={toPoints(
                  groundOutline(placement, groundProjections[scene.view])
                )}
                className={`${colourOf(key)} fill-none`}
                strokeWidth={1.6}
                strokeDasharray="1 3"
              />
            ) : (
              <circle
                key={key}
                data-note-marker={structure.id}
                data-note-placed="ring"
                data-note-rejected={bearers.get(key)?.rejected === true}
                cx={spot.sx}
                cy={spot.sy}
                r={noteMarkerRadius}
                className={`${colourOf(key)} fill-none`}
                strokeWidth={2}
              />
            ),
          ];
        })}
      </g>
      {Arr.flatMap([...placed.hops.entries()], ([hop, at]) => [
        ring({
          id: `hop:${hop}`,
          key: `hop:${hop}`,
          at,
          onPress: () => {
            selectHop(hop);
          },
        }),
      ])}
      {Arr.flatMap(spotTargets, (spot) => {
        const at = placed.spots.get(spotKey(spot));

        return at === undefined
          ? []
          : [
              ring({
                id: `spot:${spot.x},${spot.y}`,
                key: `spot:${spot.x},${spot.y}`,
                at,
                onPress: () => {
                  tool?.pick(spot);
                },
              }),
            ];
      })}
    </g>
  );
}
