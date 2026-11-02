import { Schema } from "effect";
import { CliError } from "effect/cli";

/** A docs file is missing or unreadable, so there's nothing to print. */
export class DocsNotFound extends Schema.TaggedError<
  DocsNotFound,
  { readonly brand: unique symbol }
>()("DocsNotFound", { file: Schema.String }) {
  public override get [CliError.userMessage]() {
    return `The docs aren't there: ${this.file} can't be read.`;
  }
}
