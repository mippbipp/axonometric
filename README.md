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

Set `AXONOMETRIC_VERSION` (for example `0.1.0`) to install a version other than the latest, or `AXONOMETRIC_INSTALL_DIR` to install somewhere else. Binaries exist for Linux x64 and arm64 (glibc only), macOS x64 and arm64, and Windows x64. The macOS binaries have an ad-hoc signature and aren't notarized. If you download a macOS archive in a browser, macOS quarantines the binary and refuses to open it, so clear that with `xattr -d com.apple.quarantine <path to axonometric>`. The install script downloads with curl, which doesn't set the quarantine. The Windows binary isn't signed, so SmartScreen may warn the first time you run it.

With Nix, run it straight from the flake with `nix run github:mippbipp/axonometric -- --help`, or add `github:mippbipp/axonometric` as a flake input and install `packages.<system>.default`. The package wraps the CLI bundle with Node.

## Releases

Pushing a tag such as `v0.1.0` runs `.github/workflows/release.yml`. It builds each binary on its own OS's runner, builds the fixture map with it, tests both install scripts, then creates the GitHub Release as a draft with the binaries, `SHA256SUMS` and the install scripts. At the same time, its `npm` job stages the npm package, and the draft is published only once that succeeds. The tag must match the version in `packages/cli/package.json`. A tag with a suffix, such as `v0.1.0-rc.1`, makes a pre-release, so you can test a release before the real one. For a pre-release, set the version in `packages/cli/package.json` to the pre-release version, such as `0.1.0-rc.1`, in its own commit, and tag that commit. Pull requests that change the binary build run the same checks without releasing anything.

The `npm` job runs in the GitHub environment `npm` and stages the package with `npm stage publish` through npm trusted publishing, so no npm token exists anywhere. A release gets the `latest` tag and a pre-release gets `next`. npm adds provenance on its own. Set up the trusted publisher on npmjs.com, under the package's Settings, Trusted publishing, with GitHub Actions:

- Organization or user: `mippbipp`
- Repository: `axonometric`
- Workflow filename: `release.yml`
- Environment name: `npm`
- Allowed actions: leave `npm publish` and `npm dist-tag` off, so it can only stage

A new trusted publisher expires unless a publish through it succeeds within 2 days, so set it up right before pushing the tag. Once the job has staged the package, approve it with 2FA, either with `npm stage list axonometric` and then `npm stage approve <id>`, or on npmjs.com in the package's Staged Packages tab. Until then the npm version isn't public.

The tarball holds `package.json`, `README.md`, `LICENSE` and `dist/bin.mjs`, which has the editor's page embedded in it. `pnpm --filter axonometric pack:npm <path>.tgz` packs it with `pnpm pack` and checks the file list and the package metadata. CI runs it on every pull request, and the `npm` job stages the tarball it writes. Run `pnpm build` first.

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
