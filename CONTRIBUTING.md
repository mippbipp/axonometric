# Contributing

## Development

Work in the Nix flake's dev shell, with `nix develop -c <command>` or direnv's `.envrc`. It provides Bun, Node 24, agent-browser and the Chromium the page tests open. Bun installs dependencies and runs scripts, and Node runs the tests and the bundle, so npm users' runtime stays covered. Outside the shell, install Bun 1.4.4 and Node 24.22.1 (`.node-version`), and run `bunx playwright install chromium` in `packages/cli` to fetch the browser. Install with `bun install`.

Stop `serve` with the process id that `axonometric status <home>` prints, for example `kill <pid>`. Never use `pkill -f axonometric`. It matches any command line that contains the text, including your own shell, and kills it.

`nix/package.nix` fetches the dependencies with `bun install --frozen-lockfile` in a fixed-output derivation, `bunDeps`, and pins one hash of the result. After any change to `bun.lock`, run `nix build`, then copy the `got: sha256-...` value from the hash mismatch error into `bunDeps`' `outputHash`. CI's Nix job fails until you do.

## Running tests

While you work, run only the test files you're changing, such as `bun run --cwd packages/cli vitest run test/check.test.ts` for the CLI or `bun run --cwd packages/contracts vitest run test/zones.test.ts` for contracts. The CLI tests run the built CLI bundle and the editor's built page, so run `bun run build` after changing source before running a CLI test file on its own. `bun run test` builds first by itself.

Don't repeat CI locally. CI on a draft pull request runs the full suite on all three operating systems, so open the draft and read its result. A full local run takes 14 to 19 minutes on a 2-core machine. It is worth it when CI can't answer, such as a CI failure that doesn't reproduce from the single test file. Run it with `bun run test`.

CI runs on the pull request merged with main, not on your branch alone. Merge `origin/main` into your branch and resolve any conflicts before you open or update a pull request. If the merge touches nothing your change touches, don't rerun the full suite. CI tests the merge. If CI fails but your local tests pass, first check whether your branch is behind main.

### Choosing local tests

Don't pick test files by name. Grep `packages/cli/test` for the things your change touches: the `data-*` hooks, selectors, request checks and message text. For example, after changing a message or a hook:

```sh
grep -rn "data-structure-panel" packages/cli/test | head
grep -rln "the exact message text" packages/cli/test
```

Past agents chose by file name and missed the export test that checks for no network requests and the rerouting test that compares the panel with `check`. Each showed up only in a full run. Run every file the grep finds.

If you change when a page region is ready, update every test that waits on that region in one pass. Find them by grepping for the region's hook or selector. A test left waiting on the old signal fails intermittently, and that failure comes from your change, not from a flaky test.

### The test lock

`bun run test` runs through `scripts/with-test-lock.ts`, which holds a lock file in the temp folder so two suites on one machine never run at once. A second run waits and prints the process id and command of the run that holds the lock. A lock whose process has exited is taken over. `CI=true` skips the lock. The lock also covers a single test file when you run it through the same script, such as `node scripts/with-test-lock.ts -- bun run --cwd packages/cli vitest run test/check.test.ts`. Do that when other sessions share the machine.

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
