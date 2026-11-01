# Contributing

## Development

Work in the Nix flake's dev shell, with `nix develop -c <command>` or direnv's `.envrc`. It provides Node 24.22.1, pnpm, agent-browser and the Chromium the page tests open. Outside it, pnpm runs scripts with the Node version pinned in `devEngines`, and `pnpm --filter axonometric exec playwright install chromium` fetches the browser.

`nix/package.nix` pins a hash of the pnpm dependencies. After any change to `pnpm-lock.yaml`, run `nix build` and copy the `got: sha256-...` value from the error into `pnpmDeps.hash`. CI's Nix job fails until you do.
