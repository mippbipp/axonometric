import { Command } from "effect/cli";

import packageJson from "../package.json" with { type: "json" };

export const cli = Command.make("axonometric").pipe(
  Command.withDescription(packageJson.description)
);

export const run = Command.runWith(cli, { version: packageJson.version });
