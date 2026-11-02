import { Option, Result, Schema, SchemaIssue } from "effect";
import { dual } from "effect/Function";

/**
 * Line breaks JSON leaves bare or a reader might take for one: LF, CR, NEL,
 * LS and PS. Text that reaches the agent's prompt may hold none of them.
 */
export const lineBreak = /[\n\r\u0085\u2028\u2029]/u;

/**
 * A name the engineer types, such as a structure's name, a hop's label or a
 * flow's name: one line, trimmed, not longer than `max`. Pattern `\S` does not
 * match every line break (NEL, for one, counts as non-space), so the line
 * break filter runs as well.
 */
export const oneLineText = ({
  what,
  max,
}: {
  readonly what: string;
  readonly max: number;
}) => {
  const fix = `expected a ${what} of 1 to ${max} characters on one line, with no space at either end.`;

  return Schema.String.annotate({ message: fix }).check(
    Schema.isPattern(/^\S(?:[^\r\n\u0085\u2028\u2029]*\S)?$/u, {
      message: fix,
    }),
    Schema.makeFilter((text: string) => !lineBreak.test(text), {
      message: fix,
    }),
    Schema.isMaxLength(max, { message: fix })
  );
};

/** The id of something data.mjs or a proposal names: 1 to 200 characters, on one line. */
export const idText = (what: string) => {
  const fix = `expected the id of a ${what}: 1 to 200 characters, with no line breaks.`;

  return Schema.String.annotate({ message: fix }).check(
    Schema.isNonEmpty({ message: fix }),
    Schema.isMaxLength(200, { message: fix }),
    Schema.makeFilter((id: string) => !lineBreak.test(id), { message: fix })
  );
};

const formatter = SchemaIssue.makeFormatterStandardSchemaV1();

/**
 * Why `text` doesn't fit `schema`, in the schema's own words, or nothing when
 * it does. A kind uses it to refuse an edit before it is written.
 */
export const refusalOf: {
  (text: string): (schema: Schema.Decoder<string>) => Option.Option<string>;
  (schema: Schema.Decoder<string>, text: string): Option.Option<string>;
} = dual(
  2,
  (schema: Schema.Decoder<string>, text: string): Option.Option<string> => {
    const decoded = Schema.decodeResult(schema)(text);

    return Result.isSuccess(decoded)
      ? Option.none()
      : Option.some(
          formatter(decoded.failure.issue).issues[0]?.message ??
            "The text doesn't fit."
        );
  }
);
