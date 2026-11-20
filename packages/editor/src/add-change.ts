import type { Placement, StructureChange } from "@axonometric/contracts";

import type { Draft } from "./place-context.ts";

/**
 * The structure change a draft makes at `spot`, or nothing while the name is
 * blank or there is no spot. `id` is the provisional id to give it, which
 * the form makes once, when it is sent.
 */
export const addChangeOf = ({
  draft,
  id,
  spot,
}: {
  readonly draft: Draft;
  readonly id: (name: string) => string;
  readonly spot: Placement | null;
}): StructureChange | undefined => {
  const name = draft.name.trim();

  return spot === null || name === ""
    ? undefined
    : {
        action: "add",
        at: spot,
        structure: {
          group: draft.group,
          id: id(name),
          name,
          shape: draft.shape,
          status: draft.status,
        },
      };
};

/** The id the form's preview uses: it only has to be unique, and is never saved. */
export const previewId = (): string => "draft-structure";

export { newProvisionalId as sentId } from "@axonometric/contracts";
