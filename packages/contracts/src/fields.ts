import { Schema } from "effect";

/**
 * A text field that must be present and non-empty. Every way it can fail
 * prints `fix`, so the message says how to correct the file.
 */
export const requiredText = (fix: string) =>
  Schema.String.annotate({ message: `expected a string. ${fix}` })
    .check(
      Schema.isNonEmpty({ message: `expected a non-empty string. ${fix}` })
    )
    .pipe(Schema.annotateKey({ messageMissingKey: `missing. ${fix}` }));

/**
 * Makes a list field required. `fix` is printed when it's missing or isn't
 * an array.
 */
export const requiredList =
  (fix: string) =>
  <S extends Schema.Constraint>(list: Schema.$Array<S>) =>
    list
      .annotate({ message: `expected an array. ${fix}` })
      .pipe(Schema.annotateKey({ messageMissingKey: `missing. ${fix}` }));

/**
 * Messages for an object schema. `fix` says which fields it has, and is
 * printed when the value isn't an object or has a field the format doesn't
 * know.
 */
export const objectMessages = (fix: string) => ({
  message: `expected an object. ${fix}`,
  messageUnexpectedKey: `unknown field. ${fix}`,
});

/** The current format version of every map file. */
export const formatVersion = 1;

/**
 * The fields every map file starts with: the format version it was written
 * in and the revision it was last saved at.
 */
export const fileVersionFields = {
  format: Schema.Literal(formatVersion)
    .annotate({
      message: `expected ${formatVersion}. Set format to ${formatVersion}, the only format this CLI reads.`,
    })
    .pipe(
      Schema.annotateKey({
        messageMissingKey: `missing. Add format: ${formatVersion}.`,
      })
    ),
  revision: Schema.Int.annotate({
    message: "expected a whole number. Start revision at 0.",
  })
    .check(
      Schema.isGreaterThanOrEqualTo(0, {
        message: "expected 0 or more. Start revision at 0.",
      })
    )
    .pipe(
      Schema.annotateKey({
        messageMissingKey: "missing. Add revision: 0.",
      })
    ),
};
