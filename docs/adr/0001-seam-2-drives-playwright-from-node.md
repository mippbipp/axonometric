# Seam 2 drives Playwright from Node

## Context

The spec said seam 2, the editor page in a real browser, would use Vitest browser mode with Playwright. Browser mode runs the test code inside a page that Vitest serves.

Until `serve` exists (#15), seam 2 opens the HTML file that `build` writes. A page served by Vitest can't read a `file://` page: an iframe of it comes back with no document. A custom browser command can open the file, but the command is Playwright code running in Node, so the test body would only forward calls to it.

Once `serve` runs, the map lives on its own origin. A test page on Vitest's origin can't inspect the DOM of a page on another origin either.

## Decision

Seam 2 tests are ordinary Node-side Vitest tests that use the `playwright` library. Each test builds a fixture map through the CLI (or, later, starts `serve`), opens the real page in Chromium and asserts on what's there.

## Consequences

- Tests open exactly the file or URL a user would, and can watch its network requests and page errors.
- No component is rendered in isolation, and no test sits on a different origin from the page.
- The CLI package carries `playwright`, pinned to the version nixpkgs packages so the dev shell's Chromium works. CI installs Chromium with `playwright install --with-deps chromium`.
- We don't use browser mode's locators or its in-page `expect`. Playwright's own locators do the same job.
