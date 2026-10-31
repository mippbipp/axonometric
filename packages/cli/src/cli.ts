import { Command } from "effect/cli";

import packageJson from "../package.json" with { type: "json" };
import { buildCommand } from "./build.ts";

export const cli = Command.make("axonometric").pipe(
  Command.withDescription(packageJson.description),
  Command.withSubcommands([buildCommand])
);

export const run = Command.runWith(cli, { version: packageJson.version });
