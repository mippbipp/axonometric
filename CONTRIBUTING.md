# Contributing

## Development

Work in the Nix flake's dev shell, with `nix develop -c <command>` or direnv's `.envrc`. It provides Bun, Node 24, agent-browser and the Chromium the page tests open. Bun installs dependencies and runs scripts, and Node runs the tests and the bundle, so npm users' runtime stays covered. Outside the shell, install Bun 1.4.4 and Node 24.22.1 (`.node-version`), and run `bunx playwright install chromium` in `packages/cli` to fetch the browser. Install with `bun install`.

`nix/package.nix` fetches the dependencies with `bun install --frozen-lockfile` in a fixed-output derivation, `bunDeps`, and pins one hash of the result. After any change to `bun.lock`, run `nix build`, then copy the `got: sha256-...` value from the hash mismatch error into `bunDeps`' `outputHash`. CI's Nix job fails until you do.

## Running tests

While you work, run only the test files you're changing, such as `bun run --cwd packages/cli vitest run test/check.test.ts` for the CLI or `bun run --cwd packages/contracts vitest run test/zones.test.ts` for contracts. The CLI tests run the built CLI bundle and the editor's built page, so run `bun run build` after changing source before running a CLI test file on its own. `bun run test` builds first by itself.

Run the full suite with `bun run test` once, before you push. CI runs on the pull request merged with main, not on your branch alone. Before that final run, and before you open or update a pull request, merge `origin/main` into your branch and resolve any conflicts. If CI fails but your local tests pass, first check whether your branch is behind main.

## The agent guide

The text `axonometric docs` prints lives in `packages/cli/docs/*.md`, one file per topic, plus `overview.md`. `tsdown` embeds the files in the bundle, so edit the Markdown and run `bun run build`. A new topic needs its file and an entry in `topics` in `packages/cli/src/docs.ts`, which also adds it to the topic list that `axonometric docs` prints.

`test/docs.test.ts` runs every command in the docs' `sh` blocks against the fixtures, so a command in a guide has to work as written. Use `<home>`, `<structure>` and `<item>` as placeholders. Write a command in a block only if it can run there. Prose can show a command with other placeholders in backticks, as long as its subcommand exists.

The skill is `skills/axonometric/SKILL.md`. It stays a stub that sends the agent to `axonometric docs`, so put instructions in the docs, not in the skill. `npx skills add mippbipp/axonometric` finds it under `skills/` and installs that folder alone, so put nothing else in it.

## Pinning GitHub Actions

Every `uses:` in `.github/workflows/` names an exact version, such as `actions/checkout@v7.0.1`. `.github/workflows/actions.lock` locks each one to a commit, so a moved tag can't change what CI or a release runs. The `gh actions-lock` extension generates it.

```sh
gh extension install github/gh-actions-lock --pin v0.4.1
gh actions-lock
```

Run `gh actions-lock` after you add or change a `uses:` line, and commit the updated lockfile. The pre-commit hook runs `gh actions-lock --verify-local` when a workflow file is staged. The `lockfile` CI job runs `gh actions-lock --verify`.
