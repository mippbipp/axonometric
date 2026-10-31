# axonometric

Interactive architecture maps you build with an AI agent. The agent writes a map of a system from its code and docs. You walk through it chapter by chapter, present it to your team as one diagram, and edit it in the browser. Your edits go back to the agent as proposals, which it accepts or argues against.

Status: in design. The plan is [#1](https://github.com/mippbipp/axonometric/issues/1).

The design is inspired by [inkboard/system-atlas](https://github.com/inkboard/system-atlas).

## Development

The Nix flake's dev shell provides Node 24.22.1, pnpm, agent-browser and Playwright's Chromium. Enter it with `nix develop`, or let direnv load it from `.envrc`.

```sh
pnpm install
pnpm ox    # oxlint, oxfmt and the TypeScript typecheck
pnpm test  # builds the CLI bundle, then runs the tests
node packages/cli/src/bin.ts --help  # the CLI from source
```

## License

MIT
