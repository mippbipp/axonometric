# axonometric

Interactive architecture maps you build with an AI agent. The agent writes a map of a system from its code and docs. You walk through it chapter by chapter, present it to your team as one diagram, and edit it in the browser. Your edits go back to the agent as proposals, which it accepts or argues against.

Status: in development, with no release yet. The plan is [#1](https://github.com/mippbipp/axonometric/issues/1).

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

Set `AXONOMETRIC_VERSION` (for example `0.1.0`) to install a version other than the latest, or `AXONOMETRIC_INSTALL_DIR` to install somewhere else. Binaries exist for Linux x64 and arm64 (glibc only), macOS x64 and arm64, and Windows x64.

The macOS binaries have an ad-hoc signature and aren't notarized. If you download a macOS archive in a browser, macOS quarantines the binary and refuses to open it. Clear that with `xattr -d com.apple.quarantine <path to axonometric>`. The install script downloads with curl, which doesn't set the quarantine. The Windows binary isn't signed, so SmartScreen may warn the first time you run it.

With Nix, run it straight from the flake with `nix run github:mippbipp/axonometric -- --help`, or add `github:mippbipp/axonometric` as a flake input and install `packages.<system>.default`.

## License

MIT
