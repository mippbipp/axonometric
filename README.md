# axonometric

Interactive architecture maps you build with an AI agent. The agent writes a map of a system from its code and docs. You walk through it chapter by chapter, present it to your team as one diagram, and edit it in the browser. Your edits go back to the agent as proposals, which it accepts or argues against.

Status: in design. The plan is [#1](https://github.com/mippbipp/axonometric/issues/1).

The design is inspired by [inkboard/system-atlas](https://github.com/inkboard/system-atlas).

## Install

There are three ways to install it. The npm package and the binaries arrive with the first release.

With Node 24.22.1 or newer, install the npm package:

```sh
npm install -g axonometric
```

Without Node, install a standalone binary from [GitHub Releases](https://github.com/mippbipp/axonometric/releases). Each binary has Node built in. The install script picks the binary for your OS and architecture, checks it against the release's `SHA256SUMS`, and puts it in `~/.local/bin`:

```sh
curl -fsSL https://github.com/mippbipp/axonometric/releases/latest/download/install.sh | sh
```

On Windows, in PowerShell, this installs to `%LOCALAPPDATA%\Programs\axonometric`:

```powershell
irm https://github.com/mippbipp/axonometric/releases/latest/download/install.ps1 | iex
```

Set `AXONOMETRIC_VERSION` (for example `0.1.0`) to install a version other than the latest, or `AXONOMETRIC_INSTALL_DIR` to install somewhere else. Binaries exist for Linux x64 and arm64 (glibc only), macOS x64 and arm64, and Windows x64. The macOS binaries have an ad-hoc signature and aren't notarized. The Windows binary isn't signed, so SmartScreen may warn the first time you run it.

With Nix, run it straight from the flake with `nix run github:mippbipp/axonometric -- --help`, or add `github:mippbipp/axonometric` as a flake input and install `packages.<system>.default`. The package wraps the CLI bundle with Node.

## Releases

Pushing a tag such as `v0.1.0` runs `.github/workflows/release.yml`. It builds each binary on its own OS's runner, builds the fixture map with it, tests both install scripts, then creates the GitHub Release with the binaries, `SHA256SUMS` and the install scripts. The tag must match the version in `packages/cli/package.json`. A tag with a suffix, such as `v0.1.0-rc.1`, makes a pre-release, so you can test a release before the real one. Pull requests that change the binary build run the same checks without releasing anything.

To build a binary for your own machine, run `pnpm build`, then `pnpm --filter axonometric build:sea`. It writes the binary and its archive to `packages/cli/release/`.

## Development

The Nix flake's dev shell provides Node 24.22.1, pnpm, agent-browser and Playwright's Chromium. Enter it with `nix develop`, or let direnv load it from `.envrc`.

```sh
pnpm install
pnpm ox    # oxlint, oxfmt and the TypeScript typecheck
pnpm test  # builds the CLI bundle, then runs the tests
node packages/cli/src/bin.ts --help  # the CLI from source
```

The Nix package in `nix/package.nix` pins a hash of the pnpm dependencies, so it changes whenever `pnpm-lock.yaml` does. After a lockfile change, run `nix build` and copy the `got: sha256-...` value from the hash mismatch error into `pnpmDeps.hash`. The Nix job in CI fails with the same error.

## License

MIT
