import { Option } from "effect";
import { dual } from "effect/Function";

import type { Structure } from "./map-data.ts";

/** The field of a step's name, such as `steps.0.name`. */
export const stepNameField = (index: number) => `steps.${index}.name`;

/** The field of a step's detail, such as `steps.0.detail`. */
export const stepDetailField = (index: number) => `steps.${index}.detail`;

const stepField = /^steps\.(?<index>\d+)\.(?<part>name|detail)$/u;

/**
 * The text a suggestion's `field` names in `structure`, as data.mjs has it
 * now. Nothing when the field names a step the structure doesn't have.
 */
export const textOfField: {
  (field: string): (structure: Structure) => Option.Option<string>;
  (structure: Structure, field: string): Option.Option<string>;
} = dual(2, (structure: Structure, field: string): Option.Option<string> => {
  if (
    field === "oneLiner" ||
    field === "whatItDoes" ||
    field === "howItsBuilt"
  ) {
    return Option.some(structure[field]);
  }

  const found = stepField.exec(field)?.groups;
  const step = Option.fromNullishOr(structure.steps?.[Number(found?.index)]);

  return found?.part === "name"
    ? Option.map(step, ({ name }) => name)
    : Option.map(step, ({ detail }) => detail);
});

/** What a field is called to the engineer: "one-liner" or "step 2 detail". */
export const fieldLabel = (field: string): string => {
  const found = stepField.exec(field)?.groups;

  if (found?.index !== undefined) {
    return `step ${Number(found.index) + 1} ${found.part ?? ""}`;
  }

  switch (field) {
    case "oneLiner": {
      return "one-liner";
    }

    case "whatItDoes": {
      return "what it does";
    }

    case "howItsBuilt": {
      return "how it's built";
    }

    default: {
      return field;
    }
  }
};
