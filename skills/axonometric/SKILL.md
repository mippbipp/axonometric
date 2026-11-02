---
name: axonometric
description: Map, explain, review or present a system's architecture as an interactive isometric map the engineer can walk through, edit and present, built from one data file with the axonometric CLI. Use it when someone wants to "map the system", "make an architecture diagram I can click around", "visualize the codebase/pipeline so we can talk about it", "walk me through how it fits together", "make the architecture explorable", or when an architecture discussion is piling up open questions that need tracking by ID. Also use it to update or present an existing map, and whenever a prompt starts "Use the axonometric skill to review batch N ..." (the engineer's edits to the map, waiting for your verdicts).
---

# axonometric

Before you do anything else, run:

```sh
axonometric docs
```

It prints the overview and lists the topics. Read the topic for your job with `axonometric docs <topic>`, and follow it. The docs ship inside the CLI, so they match the version that is installed. This file stays short on purpose.

If the command isn't found, install the CLI one of these ways, then run `axonometric docs`:

- `npx axonometric docs`, with Node 24.22.1 or newer. To keep it, `npm install -g axonometric`.
- A standalone binary, which needs no Node: `curl -fsSL https://github.com/mippbipp/axonometric/releases/latest/download/install.sh | sh`, or the archive for your OS from https://github.com/mippbipp/axonometric/releases.
- Nix: `nix run github:mippbipp/axonometric -- docs`, or add `github:mippbipp/axonometric` as a flake input.

If none of these works yet, tell the engineer what failed and stop. Don't write a map by hand without the CLI.
