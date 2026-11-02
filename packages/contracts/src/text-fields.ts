import { Array as Arr, Option } from "effect";
import { dual } from "effect/Function";

import type { Structure } from "./map-data.ts";

/** The texts of a structure that are not part of a step. */
export const plainFields = ["oneLiner", "whatItDoes", "howItsBuilt"] as const;

/** The part of a step a field names. */
export type StepPart = "name" | "detail";

/**
 * Which text of a structure a suggestion changes: its one-liner, what it
 * does, how it's built, or the name or detail of the step at an index, as the
 * path into the structure, such as `steps.1.detail`. `parseTextField` is the
 * one way to make one from a string.
 */
export type TextField =
  | (typeof plainFields)[number]
  | `steps.${number}.${StepPart}`;

/** What a field names: a plain text, or a step's name or detail by index. */
export type FieldPath =
  | { readonly of: "plain"; readonly field: (typeof plainFields)[number] }
  | { readonly of: "step"; readonly index: number; readonly part: StepPart };

const stepField = /^steps\.(?<index>0|[1-9]\d*)\.(?<part>name|detail)$/u;

/** The field a step's name has, such as `steps.0.name`. */
export const stepNameField = (index: number): TextField =>
  `steps.${index}.name`;

/** The field a step's detail has, such as `steps.0.detail`. */
export const stepDetailField = (index: number): TextField =>
  `steps.${index}.detail`;

/**
 * What `field` names, or nothing when it isn't a field. The schema, the
 * labels and the lookup into data.mjs all go through this.
 */
export const parseTextField = (field: string): Option.Option<FieldPath> => {
  const plain = Arr.findFirst(plainFields, (name) => name === field);

  if (Option.isSome(plain)) {
    return Option.some({ of: "plain", field: plain.value });
  }

  const found = stepField.exec(field)?.groups;
  const part = found?.part;

  return found?.index !== undefined && (part === "name" || part === "detail")
    ? Option.some({ of: "step", index: Number(found.index), part })
    : Option.none();
};

/** Whether `field` is a text field of a structure. */
export const isTextField = (field: string): field is TextField =>
  Option.isSome(parseTextField(field));

/**
 * The text a suggestion's `field` names in `structure`, as data.mjs has it
 * now. Nothing when the field names a step the structure doesn't have.
 */
export const textOfField: {
  (field: TextField): (structure: Structure) => Option.Option<string>;
  (structure: Structure, field: TextField): Option.Option<string>;
} = dual(2, (structure: Structure, field: TextField): Option.Option<string> =>
  Option.flatMap(parseTextField(field), (path) => {
    if (path.of === "plain") {
      return Option.some(structure[path.field]);
    }

    const step = Option.fromNullishOr(structure.steps?.[path.index]);

    return Option.map(step, (found) => found[path.part]);
  })
);

const plainLabels = {
  oneLiner: "one-liner",
  whatItDoes: "what it does",
  howItsBuilt: "how it's built",
} as const;

/** What a field is called to the engineer: "one-liner" or "step 2 detail". */
export const fieldLabel = (field: TextField): string =>
  Option.match(parseTextField(field), {
    onNone: () => field,
    onSome: (path) =>
      path.of === "plain"
        ? plainLabels[path.field]
        : `step ${path.index + 1} ${path.part}`,
  });
