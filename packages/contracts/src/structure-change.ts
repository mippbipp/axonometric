import { Schema } from "effect";

import { objectMessages } from "./fields.ts";
import { Placement } from "./layout.ts";
import { Shape, Status } from "./map-data.ts";

const structureIdFix =
  "expected the id of a structure: 1 to 200 characters, with no line breaks.";

/**
 * The id of a structure that data.mjs has, or of one the verdict names with
 * `--as`. data.mjs sets no pattern for ids, so none is enforced here.
 */
export const StructureId = Schema.String.annotate({
  message: structureIdFix,
}).check(
  Schema.isPattern(/^[^\r\n]{1,200}$/u, { message: structureIdFix })
);

export type StructureId = typeof StructureId.Type;

const provisionalFix =
  "expected a provisional id of letters, digits, - and _, at most 64 long.";

/**
 * The provisional id of a structure the engineer proposes. The page makes it,
 * and the agent reads it in prompts, so it may only hold safe characters.
 */
export const ProvisionalId = Schema.String.annotate({
  message: provisionalFix,
}).check(Schema.isPattern(/^[\w-]{1,64}$/u, { message: provisionalFix }));

/** The most characters a structure's name holds. */
export const maxStructureNameLength = 80;

const nameFix = `expected a name of 1 to ${maxStructureNameLength} characters on one line, with no space at either end.`;

/** A structure's name: one line, trimmed, not longer than the limit. */
export const StructureName = Schema.String.annotate({
  message: nameFix,
}).check(
  Schema.isPattern(/^\S(?:[^\r\n]*\S)?$/u, { message: nameFix }),
  Schema.isMaxLength(maxStructureNameLength, { message: nameFix })
);

const groupFix = "expected the id of one of the map's groups.";

const GroupRef = Schema.String.annotate({ message: groupFix }).check(
  Schema.isNonEmpty({ message: groupFix }),
  Schema.isMaxLength(200, { message: groupFix })
);

/** What the engineer sets when proposing a structure. */
export const NewStructure = Schema.Struct({
  id: ProvisionalId,
  name: StructureName,
  shape: Shape,
  group: GroupRef,
  status: Status,
}).annotate(
  objectMessages("A new structure has only id, name, shape, group and status.")
);

export type NewStructure = typeof NewStructure.Type;

const action = <const A extends string>(name: A) => Schema.Literal(name);

/**
 * A proposed change to the structures. `add` carries a provisional id and the
 * footprint the structure is dropped at. The other actions name a structure
 * that data.mjs has, by `structure`.
 */
export const StructureChange = Schema.Union([
  Schema.Struct({
    action: action("add"),
    structure: NewStructure,
    at: Placement,
  }).annotate(objectMessages("An add has only action, structure and at.")),
  Schema.Struct({
    action: action("delete"),
    structure: StructureId,
  }).annotate(objectMessages("A delete has only action and structure.")),
  Schema.Struct({
    action: action("rename"),
    structure: StructureId,
    name: StructureName,
  }).annotate(objectMessages("A rename has only action, structure and name.")),
  Schema.Struct({
    action: action("shape"),
    structure: StructureId,
    shape: Shape,
  }).annotate(
    objectMessages("A shape change has only action, structure and shape.")
  ),
  Schema.Struct({
    action: action("group"),
    structure: StructureId,
    group: GroupRef,
  }).annotate(
    objectMessages("A group change has only action, structure and group.")
  ),
  Schema.Struct({
    action: action("status"),
    structure: StructureId,
    status: Status,
  }).annotate(
    objectMessages("A status change has only action, structure and status.")
  ),
]).annotate({
  message:
    'expected a structure change: { action: "add", structure: { id, name, shape, group, status }, at: { x, y, w, d } }, { action: "delete", structure }, { action: "rename", structure, name }, { action: "shape", structure, shape }, { action: "group", structure, group } or { action: "status", structure, status }.',
});

export type StructureChange = typeof StructureChange.Type;

/** The id of the structure a change acts on: the provisional id for an add. */
export const structureOf = (change: StructureChange): string =>
  change.action === "add" ? change.structure.id : change.structure;

/** Whether two changes act on the same structure in the same way. */
export const sameSubject = (a: StructureChange, b: StructureChange): boolean =>
  a.action === b.action && structureOf(a) === structureOf(b);
