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
  group: (structure: Structure, group: string): StructureChange => ({
    action: "group",
    group,
    structure: structure.id,
  }),
  rename: (structure: Structure, name: string): StructureChange => ({
    action: "rename",
    name,
    structure: structure.id,
  }),
  shape: (structure: Structure, shape: Shape): StructureChange => ({
    action: "shape",
    shape,
    structure: structure.id,
  }),
  status: (structure: Structure, status: Status): StructureChange => ({
    action: "status",
    status,
    structure: structure.id,
  }),
} as const;

/** The shapes to pick from, with the words the form shows. */
export const shapeChoices: ReadonlyArray<{ label: string; value: Shape }> =
  Arr.map(shapes, (value) => ({ label: value, value }));

/** The statuses to pick from, with the fixed label of each. */
export const statusChoices: ReadonlyArray<{ label: string; value: Status }> =
  Arr.map(statuses, (value) => ({ label: statusLabels[value], value }));
