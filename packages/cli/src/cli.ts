import { Command } from "effect/cli";

import packageJson from "../package.json" with { type: "json" };
import { buildCommand } from "./build.ts";
import { checkCommand } from "./check.ts";
import { initCommand } from "./init.ts";
import { layoutCommand } from "./layout.ts";

export const cli = Command.make("axonometric").pipe(
  Command.withDescription(packageJson.description),
  Command.withSubcommands([
    initCommand,
    buildCommand,
    checkCommand,
    layoutCommand,
  ])
);

export const run = Command.runWith(cli, { version: packageJson.version });
