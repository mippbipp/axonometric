# Agents

## Package manager

This repo uses bun (`packageManager` in `package.json`). When a skill or doc
says `npm`, `npx`, `pnpm` or `yarn`, use `bun` or `bunx` instead.

Lint, format and typecheck with `bun run ox`; fix with `bun run ox:fix`.

## Using ui-sdk

Wherever ui-sdk ships a component or a behavior for something in the editor,
use it, including the SVG targets on the map. This section describes where the
editor is heading. Parts of it may not use ui-sdk yet. The ui-sdk docs are in
`packages/ui/node_modules/@ui-sdk/react/docs/`. The kitchen sink at
https://ui-sdk.dev/sink (source `apps/docs/app/sink/` in `vercel-labs/ui`)
shows how each control is wired.

ui-sdk provides the behavior and shadcn provides the design:

- Components come from `@ui-sdk/react`. Each gets a wrapper in
  `packages/ui/src/components/`, which styles the ui-sdk parts with the shadcn
  (base-lyra) Tailwind classes and theme variables in
  `packages/ui/src/styles/globals.css`.
- Build interactive components on ui-sdk. `shadcn add` generates Base UI
  wrappers, so use it only for markup-only components (card, empty, skeleton).
  When shadcn has the same component, copy its base-lyra classes so the look
  matches, then swap Base UI state attributes for ui-sdk's (`data-highlighted`
  for `:focus`, `data-destructive` for `data-[variant=destructive]`, and so on).
- Canvas interactions are primitives built with `definePrimitive` from
  `@ui-sdk/core` behaviors, following the "build a component ui-sdk doesn't
  ship" path in the ui-sdk skill.
- Keep the editor's own `data-*` attributes (`data-structure`,
  `data-control`) beside ui-sdk's `data-slot` and state attributes. The page
  tests and the drawing code depend on them.
- Undo and redo stay server-backed through the map's edit history. Don't use
  ui-sdk's undo stack.
- Wrapper tests live in `packages/ui/test/`, run in jsdom with ui-sdk's strict
  mode on.

## Building UI

When frontend skills disagree, the one higher in this list wins:

1. `ui-sdk` and `shadcn` decide how components behave and look (see above).
2. `vercel-composition-patterns` for component APIs: compound components, and
   `children` or explicit variants in place of boolean props.
3. `react-doctor` checks the code. Run `bunx react-doctor --verbose --scope changed`
   after React changes and `bunx react-doctor design --verbose` before a PR. The
   pre-commit hook blocks on react-doctor warnings.
4. `agent-browser skills get modern-web-guidance` verifies motion, overlays,
   images and theming in a real browser. Where ui-sdk ships the component, keep
   ui-sdk's implementation and take only the guide's browser checks.

## Using Effect

This repo uses Effect 4. Before writing any Effect code, read
`node_modules/effect/AGENTS.md` **completely**, and follow the
links in the file when required. For APIs the guide doesn't
cover, search the source in `node_modules/effect/src`.

## Using Turborepo

Before changing `turbo.jsonc` or turbo commands, read `docs/README.md` in the
installed `turbo` package (find it with
`bun -p "require.resolve('turbo/package.json')"`), then the pages it points to.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`mippbipp/axonometric`, via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary, each label string equal to its role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Development

Read `CONTRIBUTING.md` before running commands or changing `bun.lock`.
