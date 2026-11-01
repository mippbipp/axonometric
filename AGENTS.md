# Agents

## Learning more about Effect

This repository uses the Effect Typescript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md`
**completely**, and follow the links in the file when required.

If you need to learn more about particular Effect apis and concepts that the
guide doesn't cover, search through the source code in `node_modules/effect/src`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`mippbipp/axonometric`, via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary, each label string equal to its role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Development

Read `CONTRIBUTING.md` before running commands or changing `pnpm-lock.yaml`.

### Running tests

Queue full test runs behind one lock, so each gets the whole machine:

```sh
flock /tmp/opencode/axonometric-test.lock nix develop -c pnpm test
```

Several agents share this machine, and overlapping runs each start Vitest workers and Chromium, which slows every run into false timeouts. Single test files run without the lock.

Run the full suite once. CI repeats it on Linux, macOS and Windows. When a branch adds or changes browser tests, run just those files a second time to catch flakiness.
