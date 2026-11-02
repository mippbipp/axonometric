import type { Placement, StructureChange } from "@axonometric/contracts";

import type { Draft } from "./place-context.ts";

/**
 * The structure change a draft makes at `spot`, or nothing while the name is
 * blank or there is no spot. `id` is the provisional id to give it, which
 * the form makes once, when it is sent.
 */
export const addChangeOf = ({
  draft,
  spot,
  id,
}: {
  readonly draft: Draft;
  readonly spot: Placement | null;
  readonly id: (name: string) => string;
}): StructureChange | undefined => {
  const name = draft.name.trim();

  return spot === null || name === ""
    ? undefined
    : {
        action: "add",
        structure: {
          id: id(name),
          name,
          shape: draft.shape,
          group: draft.group,
          status: draft.status,
        },
        at: spot,
      };
};

/** The id the form's preview uses: it only has to be unique, and is never saved. */
export const previewId = (): string => "draft-structure";

export { newProvisionalId as sentId } from "@axonometric/contracts";
