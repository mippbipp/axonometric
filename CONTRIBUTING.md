# Contributing

## Development

Work in the Nix flake's dev shell, with `nix develop -c <command>` or direnv's `.envrc`. It provides Node 24.22.1, pnpm, agent-browser and the Chromium the page tests open. Outside it, pnpm runs scripts with the Node version pinned in `devEngines`, and `pnpm --filter axonometric exec playwright install chromium` fetches the browser.

`nix/package.nix` pins a hash of the pnpm dependencies. After any change to `pnpm-lock.yaml`, run `nix build` and copy the `got: sha256-...` value from the error into `pnpmDeps.hash`. CI's Nix job fails until you do.

## Releasing

Push a tag `v<version>` that matches the version in `packages/cli/package.json`. For a pre-release, such as `0.1.0-rc.1`, commit that version on its own and tag the commit. npm gets it under the `next` tag.

The release workflow creates a draft GitHub Release and stages the npm package. The draft goes public once staging succeeds. The npm version stays private until you approve it with 2FA: run `npm stage list axonometric`, then `npm stage approve <id>`, or use the Staged Packages tab on npmjs.com.

### npm trusted publishing

The workflow stages through npm trusted publishing, so no npm token exists anywhere. On npmjs.com, under the package's Settings, Trusted publishing, add a GitHub Actions publisher:

- Organization or user: `mippbipp`
- Repository: `axonometric`
- Workflow filename: `release.yml`
- Environment name: `npm`
- Allowed actions: leave `npm publish` and `npm dist-tag` unchecked, so the workflow can only stage

A new publisher expires unless a publish through it succeeds within 2 days, so add it right before you push the tag. Set the package's publishing access to "Require two-factor authentication and disallow tokens".

### When a release goes wrong

If the `npm` job fails before it stages anything, rerun the failed jobs. The draft release waits.

If a version was staged wrong, reject it with `npm stage reject <id>`, delete the draft release and the tag, fix the problem, then bump the version and tag again. npm never reuses a staged version number.
