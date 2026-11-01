# Contributing

## Development

Work in the Nix flake's dev shell, with `nix develop -c <command>` or direnv's `.envrc`. It provides Node 24.22.1, pnpm, agent-browser and the Chromium the page tests open. Outside it, pnpm runs scripts with the Node version pinned in `devEngines`, and `pnpm --filter axonometric exec playwright install chromium` fetches the browser.

`nix/package.nix` pins a hash of the pnpm dependencies. After any change to `pnpm-lock.yaml`, run `nix build` and copy the `got: sha256-...` value from the error into `pnpmDeps.hash`. CI's Nix job fails until you do.

## Running tests

While you work, run only the test files you're changing, such as `pnpm --filter axonometric exec vitest run test/check.test.ts` for the CLI or `pnpm --filter @axonometric/contracts exec vitest run test/zones.test.ts` for contracts. The CLI tests run the built CLI bundle and the editor's built page, so run `pnpm build` after changing source before running a CLI test file on its own. `pnpm test` builds first by itself.

Run the full suite with `pnpm test` once, before you push. CI runs on the pull request merged with main, not on your branch alone. Before that final run, and before you open or update a pull request, merge `origin/main` into your branch and resolve any conflicts. If CI fails but your local tests pass, first check whether your branch is behind main.
