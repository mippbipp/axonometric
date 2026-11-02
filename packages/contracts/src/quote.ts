import { Array as Arr, pipe, Result, Schema, String as Str } from "effect";
import { dual } from "effect/Function";

const encodeString = Schema.encodeResult(Schema.fromJsonString(Schema.String));

/**
 * `text` as a JSON string literal on one line. The quotes and escapes keep
 * whatever the engineer typed inside its own literal, so it can't pass for
 * a line of the prompt. The line separators JSON leaves bare are escaped
 * too.
 */
export const quoteText = (text: string): string =>
  pipe(
    Result.getOrElse(encodeString(text), () => '""'),
    Str.replaceAll("\u0085", String.raw`\u0085`),
    Str.replaceAll("\u2028", String.raw`\u2028`),
    Str.replaceAll("\u2029", String.raw`\u2029`)
  );

/** `text` on one line, cut to `limit` characters. */
export const oneLine: {
  (limit: number): (text: string) => string;
  (text: string, limit: number): string;
} = dual(2, (text: string, limit: number): string => {
  const flat = Arr.join(Str.split(/[\s\u0085]+/u)(Str.trim(text)), " ");

  return flat.length <= limit ? flat : `${Str.slice(0, limit - 1)(flat)}…`;
});
