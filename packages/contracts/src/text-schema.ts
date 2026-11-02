import { Schema } from "effect";

/**
 * Line breaks JSON leaves bare or a reader might take for one: LF, CR, NEL,
 * LS and PS. Text that reaches the agent's prompt may hold none of them.
 */
export const lineBreak = /[\n\r\u0085\u2028\u2029]/u;

const hasNoLineBreak = (text: string) => !lineBreak.test(text);

/**
 * A text of one line: 1 to `max` characters, trimmed, with no line break of
 * any kind. `\S` lets U+0085 through at either end, so the filter that turns
 * every line break away is part of the helper and not left to each caller.
 * `noun` names it in the message, such as "name" or "title".
 */
export const oneLineText = ({
  noun,
  max,
}: {
  readonly noun: string;
  readonly max: number;
}) => {
  const fix = `expected a ${noun} of 1 to ${max} characters on one line, with no space at either end.`;

  return Schema.String.annotate({ message: fix }).check(
    Schema.isPattern(/^\S(?:[^\r\n\u0085\u2028\u2029]*\S)?$/u, {
      message: fix,
    }),
    Schema.makeFilter(hasNoLineBreak, { message: fix }),
    Schema.isMaxLength(max, { message: fix })
  );
};
