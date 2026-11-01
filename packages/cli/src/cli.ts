import { Command } from "effect/cli";

import packageJson from "../package.json" with { type: "json" };
import { buildCommand } from "./build.ts";
import { checkCommand } from "./check.ts";
import { Git } from "./git.ts";
import { initCommand } from "./init.ts";
import { layoutCommand } from "./layout.ts";
import { serveCommand, statusCommand } from "./serve-command.ts";

export const cli = Command.make("axonometric").pipe(
  Command.withDescription(packageJson.description),
  Command.withSubcommands([
    initCommand,
    buildCommand,
    checkCommand,
    layoutCommand,
    serveCommand,
    statusCommand,
  ]),
  Command.provide(Git.layer)
);

export const run = Command.runWith(cli, { version: packageJson.version });
