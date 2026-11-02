# axonometric

axonometric draws a system's architecture as an interactive map. You write what the system is in `data.mjs`. The CLI places it, draws it and serves it. The engineer walks through the map chapter by chapter, presents it as one diagram, and edits it in the browser. Their edits come back to you as proposals that you accept or argue against.

These docs ship inside the CLI, so they match the version you are running. Read the topic for the job at hand before you act on it.

## Start here

- Building or updating a map: read `process` first. Read `data` when you write `data.mjs`, `chapters` when you plan the walkthrough, and `design` for shapes, wording and layout. Finish with `visual-check`.
- A prompt that starts "Use the axonometric skill to review batch N ...": read `review`.
- Flags and arguments: `axonometric <command> --help`. These docs say how to use the commands well. They don't repeat every flag. `review`, `check` and `status` take `--json` for output you can parse.

## Commands

- `axonometric init <home>` writes a starter `data.mjs`.
- `axonometric build <home>` checks the map, places new structures, and writes `SYSTEM.md` and the page.
- `axonometric check <home>` reports errors and warnings and writes nothing.
- `axonometric layout <home> <structure>` moves or resizes a structure.
- `axonometric export <home>` writes an SVG, PNG or Excalidraw file.
- `axonometric serve <home>` runs the save server and the live page. `axonometric status <home>` prints its URL.
- `axonometric review <home>`, `axonometric verdict <home> <item>` and `axonometric commit <home>` are the review loop.
- `axonometric docs [topic]` prints these docs.
