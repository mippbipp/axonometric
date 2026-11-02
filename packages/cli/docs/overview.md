# axonometric

axonometric draws a system's architecture as an interactive map. You write what the system is in `data.mjs`. The CLI places it, draws it and serves it. The engineer walks through the map chapter by chapter, presents it as one diagram, and edits it in the browser. Their edits come back to you as proposals that you accept or argue against.

These docs ship inside the CLI, so they match the version you are running. Read the topic for the job at hand before you act on it.

## Start here

- Building or updating a map: read `process` first. Read `data` when you write `data.mjs`, `chapters` when you plan the walkthrough, and `design` for shapes, wording and layout. Finish with `visual-check`.
- A prompt that starts "Use the axonometric skill to review batch N ...": read `review`.

## Commands

`init`, `build`, `check`, `layout`, `export`, `serve`, `status`, `review`, `verdict`, `commit` and `docs`. The topics show how to use each one. `axonometric <command> --help` lists its flags. `review`, `check` and `status` take `--json`.
