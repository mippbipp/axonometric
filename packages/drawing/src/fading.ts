import type { Spotlight } from "@axonometric/contracts";

/**
 * Which drawn parts the spotlight fades. Each answer is `undefined` when
 * there is no spotlight, so a part carries no fading attribute then and
 * the map draws as it did before the spotlight existed.
 */
export interface Fading {
  readonly hop: (id: string) => boolean | undefined;
  readonly structure: (id: string) => boolean | undefined;
}

/** What the spotlight fades. The one place the drawing reads it. */
export const fadingOf = (spotlight: Spotlight | null | undefined): Fading =>
  spotlight === null || spotlight === undefined
    ? { hop: () => {}, structure: () => {} }
    : {
        hop: (id) => !spotlight.hops.has(id),
        structure: (id) => !spotlight.structures.has(id),
      };

/** What marks a part as faded, or as drawn at full strength. */
export interface FadeAttributes {
  /** Whether the spotlight fades the part, or `undefined` without one. */
  readonly "data-faded": boolean | undefined;
  /** `strength` when faded, else `undefined`, so no attribute is written. */
  readonly opacity: number | undefined;
}

/**
 * The attributes of a part the spotlight may fade, at `strength` when it
 * does. Every faded part of the drawing takes its attributes from here.
 */
export const fadeAttributes = ({
  faded,
  strength,
}: {
  readonly faded: boolean | undefined;
  readonly strength: number;
}): FadeAttributes => ({
  "data-faded": faded,
  opacity: faded === true ? strength : undefined,
});
