---
name: axonometric
description: Map, explain, review or present a system's architecture as an interactive isometric map. Use for "map the system", "make the architecture explorable", "walk me through how it fits together", or to update or present an existing map. Also use when a prompt starts "Use the axonometric skill to review batch N ...".
---

# axonometric

Before you do anything else, run:

```sh
axonometric docs
```

It prints the overview and lists the topics. Read the topic for your job with `axonometric docs <topic>`, and follow it. The docs ship inside the CLI, so they match the installed version.

If the command isn't found, install the CLI one of these ways, then run `axonometric docs`:

- `npx axonometric docs`, with a current Node (the README lists the minimum). To keep it, `npm install -g axonometric`.
- A standalone binary, which needs no Node: `curl -fsSL https://github.com/mippbipp/axonometric/releases/latest/download/install.sh | sh`, or the archive for your OS from https://github.com/mippbipp/axonometric/releases.
- Nix: `nix run github:mippbipp/axonometric -- docs`, or add `github:mippbipp/axonometric` as a flake input.

If none of these works, tell the engineer what failed and stop. Don't write a map by hand without the CLI.
