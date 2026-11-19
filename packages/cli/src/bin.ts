#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Stdio } from "effect";

import { run } from "./cli.ts";

const main = Stdio.Stdio.use((stdio) => Effect.flatMap(stdio.args, run));

NodeRuntime.runMain(main.pipe(Effect.provide(NodeServices.layer)));
