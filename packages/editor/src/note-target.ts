import type { NoteTarget } from "@axonometric/contracts";
import { Match } from "effect";

/** A note's target as one string: `structure:server`, `hop:h-save` or `spot:2.5,-3`. */
export const noteTargetKey = (target: NoteTarget): string =>
  Match.value(target).pipe(
    Match.discriminatorsExhaustive("kind")({
      structure: ({ id }) => `structure:${id}`,
      hop: ({ id }) => `hop:${id}`,
      spot: ({ x, y }) => `spot:${x},${y}`,
    })
  );
