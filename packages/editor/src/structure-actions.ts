import { shapes, statuses, statusLabels } from "@axonometric/contracts";
import type {
  Shape,
  Status,
  Structure,
  StructureChange,
} from "@axonometric/contracts";
import { Array as Arr } from "effect";

/** One thing the engineer can propose to a structure. */
export type StructureAction =
  | "delete"
  | "rename"
  | "shape"
  | "group"
  | "status";

/**
 * The change for each action. A structure that is only proposed stays a
 * proposal: the server edits its proposal, so renaming it, or deleting it,
 * leaves no second proposal behind.
 */
export const changeFor = {
  delete: (structure: Structure): StructureChange => ({
    action: "delete",
    structure: structure.id,
  }),
  rename: (structure: Structure, name: string): StructureChange => ({
    action: "rename",
    structure: structure.id,
    name,
  }),
  shape: (structure: Structure, shape: Shape): StructureChange => ({
    action: "shape",
    structure: structure.id,
    shape,
  }),
  group: (structure: Structure, group: string): StructureChange => ({
    action: "group",
    structure: structure.id,
    group,
  }),
  status: (structure: Structure, status: Status): StructureChange => ({
    action: "status",
    structure: structure.id,
    status,
  }),
} as const;

/** The shapes to pick from, with the words the form shows. */
export const shapeChoices: readonly { value: Shape; label: string }[] = Arr.map(
  shapes,
  (value) => ({ value, label: value })
);

/** The statuses to pick from, with the fixed label of each. */
export const statusChoices: readonly { value: Status; label: string }[] =
  Arr.map(statuses, (value) => ({ value, label: statusLabels[value] }));
