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

/**
 * The `opacity` of a faded part: `strength` when faded, else `undefined`,
 * so a part at full strength carries no attribute.
 */
export const fadedOpacityOf = ({
  faded,
  strength,
}: {
  readonly faded: boolean | undefined;
  readonly strength: number;
}): number | undefined => (faded === true ? strength : undefined);
