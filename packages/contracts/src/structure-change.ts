import { pipe, Schema, String as Str } from "effect";
import { dual } from "effect/Function";

import { objectMessages } from "./fields.ts";
import { maxRouteReach, Placement } from "./layout.ts";
import { Shape, Status } from "./map-data.ts";

/**
 * Line breaks JSON leaves bare or a reader might take for one: LF, CR, NEL,
 * LS and PS. Text that reaches the agent's prompt may hold none of them.
 */
const lineBreak = /[\n\r\u0085\u2028\u2029]/u;

const structureIdFix =
  "expected the id of a structure: 1 to 200 characters, with no line breaks.";

/**
 * The id of a structure that data.mjs has, or of one the verdict names with
 * `--as`. data.mjs sets no pattern for ids, so only line breaks are refused.
 */
export const StructureId = Schema.String.annotate({
  message: structureIdFix,
}).check(
  Schema.isNonEmpty({ message: structureIdFix }),
  Schema.isMaxLength(200, { message: structureIdFix }),
  Schema.makeFilter((id: string) => !lineBreak.test(id), {
    message: structureIdFix,
  })
);

export type StructureId = typeof StructureId.Type;

const asFix =
  "expected an id of letters, digits, - and _, at most 64 long, for the structure in data.mjs.";

/**
 * The id `verdict --as` gives a new structure: the same shape as a
 * provisional id, so it is safe wherever the agent's words reach the page.
 */
export const FinalId = Schema.String.annotate({ message: asFix }).check(
  Schema.isPattern(/^[\w-]{1,64}$/u, { message: asFix })
);

const provisionalFix =
  "expected a provisional id of letters, digits, - and _, at most 64 long.";

/**
 * The provisional id of a structure the engineer proposes. The page makes it,
 * and the agent reads it in prompts, so it may only hold safe characters.
 */
export const ProvisionalId = Schema.String.annotate({
  message: provisionalFix,
}).check(Schema.isPattern(/^[\w-]{1,64}$/u, { message: provisionalFix }));

export type ProvisionalId = typeof ProvisionalId.Type;

/** The most characters a structure's name holds. */
export const maxStructureNameLength = 80;

const nameFix = `expected a name of 1 to ${maxStructureNameLength} characters on one line, with no space at either end.`;

/** A structure's name: one line, trimmed, not longer than the limit. */
export const StructureName = Schema.String.annotate({
  message: nameFix,
}).check(
  Schema.isPattern(/^\S(?:[^\r\n\u0085\u2028\u2029]*\S)?$/u, {
    message: nameFix,
  }),
  Schema.makeFilter((name: string) => !lineBreak.test(name), {
    message: nameFix,
  }),
  Schema.isMaxLength(maxStructureNameLength, { message: nameFix })
);

const groupFix = "expected the id of one of the map's groups, on one line.";

const GroupRef = Schema.String.annotate({ message: groupFix }).check(
  Schema.isNonEmpty({ message: groupFix }),
  Schema.isMaxLength(200, { message: groupFix }),
  Schema.makeFilter((group: string) => !lineBreak.test(group), {
    message: groupFix,
  })
);

/** How far from the origin a proposed structure may sit, as route points do. */
export const maxProposedReach = maxRouteReach;

/** The largest side a proposed footprint may have, in grid units. */
export const maxProposedSide = 10;

const reachFix = `expected a spot within ${maxProposedReach} units of the origin, and sides of at most ${maxProposedSide}.`;

/**
 * Where a new structure is dropped: a placement within reach of the origin
 * and no bigger than a proposed structure may be.
 */
export const ProposedPlacement = Placement.check(
  Schema.makeFilter(
    ({ x, y, w, d }: Placement) =>
      Math.abs(x) <= maxProposedReach &&
      Math.abs(y) <= maxProposedReach &&
      w <= maxProposedSide &&
      d <= maxProposedSide,
    { message: reachFix }
  )
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
    at: ProposedPlacement,
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

/** Whether two changes are the same change. */
export const sameStructureChange = Schema.toEquivalence(StructureChange);

/** The id of the structure a change acts on: the provisional id for an add. */
export const structureOf = (change: StructureChange): string =>
  change.action === "add" ? change.structure.id : change.structure;

/** Whether two changes act on the same structure in the same way. */
export const sameSubject: {
  (b: StructureChange): (a: StructureChange) => boolean;
  (a: StructureChange, b: StructureChange): boolean;
} = dual(
  2,
  (a: StructureChange, b: StructureChange): boolean =>
    a.action === b.action && structureOf(a) === structureOf(b)
);

/**
 * A provisional id for a structure called `name`: its words as a slug, then
 * `suffix`, such as `build-cache-4f2a`. The agent can use it as the
 * structure's id as it stands.
 */
export const provisionalIdOf: {
  (suffix: string): (name: string) => string;
  (name: string, suffix: string): string;
} = dual(2, (name: string, suffix: string): string => {
  const slug = pipe(
    Str.toLowerCase(name),
    Str.replaceAll(/[^a-z0-9]+/gu, "-"),
    Str.replaceAll(/^-+|-+$/gu, ""),
    Str.slice(0, 40),
    Str.replaceAll(/-+$/gu, "")
  );

  return `${slug === "" ? "structure" : slug}-${suffix}`;
});
