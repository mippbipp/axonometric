import { recommended } from "@effect/tsgo/oxlint-presets";
import nkzw from "@nkzw/oxlint-config/with-sorting";
import { defineConfig } from "oxlint";

const MANUAL_EFFECT_RUNNER_MESSAGE =
  "Write the test with `it.effect(...)` or `layer(...)(...)` from `@effect/vitest`.";

export default defineConfig({
  categories: {
    correctness: "error",
    nursery: "off",
    pedantic: "warn",
    perf: "error",
    restriction: "warn",
    style: "warn",
    suspicious: "warn",
  },
  env: {
    builtin: true,
  },
  extends: [recommended, nkzw],
  globals: {},
  ignorePatterns: [
    "dist/**",
    // agent tooling dirs (installed skills/hooks) are not application source
    ".agent/**",
    ".agents/**",
    ".claude/**",
    ".codex/**",
    ".continue/**",
    ".cursor/**",
    ".gemini/**",
    ".opencode/**",
    ".pi/**",
    ".roo/**",
    ".windsurf/**",
    // fixture maps are written the way an agent writes data.mjs
    "**/test/fixtures/**",
  ],
  jsPlugins: ["eslint-plugin-turbo", "@shadcn/lint"],
  options: {
    denyWarnings: true,
    typeAware: true,
    typeCheck: true, // not full-tree build typechecking
  },
  overrides: [
    {
      // tool config files are plain data; native array methods are fine
      files: ["*.config.ts"],
      rules: {
        "effecttsgo/prefer-effect-array": "off",
      },
    },
    {
      // CLI and script entrypoints: the top-level runMain launches the process,
      // it is not test setup code
      files: ["packages/cli/src/bin.ts", "packages/cli/scripts/*.ts"],
      rules: {
        "effecttsgo/strict-effect-provide": "off",
        "vitest/require-hook": "off",
      },
    },
    {
      // The bundler config embeds data in generated modules as JSON literals at
      // build time; a throw fails the build.
      files: ["packages/cli/tsdown.config.ts"],
      rules: {
        "effecttsgo/global-json": "off",
      },
    },
    {
      // The test lock wraps `turbo` before anything else runs, so it uses
      // only Node's built-ins and stays out of the Effect runtime. Its tests
      // run on node:test for the same reason.
      files: ["scripts/with-test-lock*.ts"],
      rules: {
        "effecttsgo/async-function": "off",
        "effecttsgo/global-date": "off",
        "effecttsgo/global-json": "off",
        "effecttsgo/new-promise": "off",
        "effecttsgo/node-builtin-import": "off",
        "effecttsgo/prefer-effect-array": "off",
        "effecttsgo/prefer-effect-string": "off",
        "effecttsgo/process-env": "off",
        "node/no-process-env": "off",
        "node/no-sync": "off",
        "node/no-top-level-await": "off",
        "promise/avoid-new": "off",
        "unicorn/import-style": "off",
        "unicorn/no-process-exit": "off",
        "vitest/no-import-node-test": "off",
        "vitest/prefer-importing-vitest-globals": "off",
        "vitest/require-hook": "off",
        // CI is set by the runner, not declared to turbo.
        "turbo/no-undeclared-env-vars": ["error", { allowList: ["^CI$"] }],
      },
    },
    {
      // A strobe bench is a plain Node script that strobe loads in its own
      // Bun process, outside the Effect runtime, like the test lock.
      files: ["perf/*.bench.ts"],
      rules: {
        "effecttsgo/async-function": "off",
        "effecttsgo/global-date": "off",
        "effecttsgo/global-json": "off",
        "effecttsgo/node-builtin-import": "off",
        "node/no-sync": "off",
        "unicorn/import-style": "off",
        "vitest/require-hook": "off",
      },
    },
    {
      // An ambient module declaration has no imports or exports.
      files: ["**/*.d.ts"],
      rules: {
        "import/unambiguous": "off",
      },
    },
    {
      files: ["packages/editor/**/*.ts", "packages/editor/**/*.tsx"],
      rules: {
        // The editor is a React app, so native array, record and string
        // methods are fine there.
        "effecttsgo/prefer-effect-array": "off",
        "effecttsgo/prefer-effect-record": "off",
        "effecttsgo/prefer-effect-string": "off",
        // Event targets are narrowed to DOM nodes with instanceof; the DOM has
        // no other type guard for them.
        "@nkzw/no-instanceof": "off",
      },
    },
    {
      // The clipboard call hands its outcome to a callback, and either outcome
      // is reported, so there is no rejection left to catch.
      files: ["packages/editor/src/ready-for-review.tsx"],
      rules: {
        "promise/always-return": "off",
        "promise/catch-or-return": "off",
        "promise/no-callback-in-promise": "off",
        "promise/prefer-catch": "off",
      },
    },
    {
      // Vite applies CSS through side-effect imports
      files: ["packages/editor/src/main.tsx"],
      rules: {
        "import/no-unassigned-import": "off",
      },
    },
    {
      // A worker's entry listens for messages at the top level, as main.tsx
      // renders there. It is not test setup code.
      files: ["packages/editor/src/*.worker.ts"],
      rules: {
        "vitest/require-hook": "off",
      },
    },
    {
      // Effect.run* and ManagedRuntime.make skip the test runtime's scope,
      // TestClock and layer cleanup; tests use it.effect or layer() from
      // @effect/vitest instead
      files: ["**/*.{test,spec}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
      rules: {
        "eslint/no-restricted-properties": [
          "error",
          ...[
            "runCallback",
            "runCallbackWith",
            "runFork",
            "runForkWith",
            "runPromise",
            "runPromiseExit",
            "runPromiseExitWith",
            "runPromiseWith",
            "runSync",
            "runSyncExit",
            "runSyncExitWith",
            "runSyncWith",
          ].map((property) => ({
            message: MANUAL_EFFECT_RUNNER_MESSAGE,
            object: "Effect",
            property,
          })),
          {
            message: MANUAL_EFFECT_RUNNER_MESSAGE,
            object: "ManagedRuntime",
            property: "make",
          },
        ],
      },
    },
    {
      files: ["**/*.test.ts", "**/test/**/*.ts"],
      rules: {
        // @effect/vitest layer() owns setup and teardown internally
        "vitest/no-importing-vitest-globals": "off",
        // @effect/vitest layer() owns setup and teardown internally
        "vitest/require-hook": "off",
        // Effect-integrated assert replaces expect.hasAssertions.
        "effecttsgo/strict-effect-provide": "off",
        "vitest/prefer-expect-assertions": "off",
        // Fixtures are written and compared as plain JSON; a throw fails the test.
        "effecttsgo/global-json": "off",
        // shared test helpers are plain data functions, so a data-last overload
        // has nothing to dualize
        "effecttsgo/missing-pipeable-signature": "off",
      },
    },
    {
      // The contracts tests take one timeout from vitest.config.ts, so no
      // test sets its own.
      files: ["packages/contracts/test/**/*.ts"],
      rules: {
        "vitest/require-test-timeout": "off",
      },
    },
    {
      files: ["**/*.tsx"],
      rules: {
        "eslint/func-style": "off",
        "react/jsx-props-no-spreading": "off",
        "typescript/no-misused-promises": [
          "error",
          {
            checksVoidReturn: false, // allow async functions in handlers like `onClick`
          },
        ],
      },
    },
    {
      files: ["packages/ui/src/components/*.tsx"],
      rules: {
        "react/only-export-components": "off",
        // components own their appearance and may need structural values
        // such as ring-[3px]; cva() call sites aren't statically resolvable
        "shadcn/no-arbitrary-values": "off",
        "shadcn/no-restyle": "off",
        "shadcn/require-static-classes": "off",
        // Vendored shadcn kit, no Effect code: the Effect boolean rule
        // misreads upstream primitives (render props, DOM handles).
        "effecttsgo/strict-boolean-expressions": "off",
      },
    },
  ],
  plugins: [
    "unicorn",
    "typescript",
    "oxc",
    "eslint",
    "vitest",
    "jsx-a11y",
    "react",
    "node",
    "import",
  ],
  rules: {
    "vitest/prefer-lowercase-title": [
      "warn",
      { allowedPrefixes: ["Iso view", "Plan view"] },
    ],
    // The workspace packages are private and bundled into one CLI, so no
    // export is a public library API that could leak an unstable Effect type.
    "effecttsgo/api-stability-leak": "off",
    // --- not applicable in codebase ---
    "eslint/no-undef": "off",
    "import/default": "off",
    "import/named": "off",
    "import/namespace": "off",
    "oxc/no-async-await": "off",
    "oxc/no-optional-chaining": "off",
    "oxc/no-rest-spread-properties": "off",
    "react/react-in-jsx-scope": "off",
    "unicorn/throw-new-error": "off", // Effect errors are values (Schema.TaggedError), never thrown

    // --- js plugin preferences ---

    "turbo/no-undeclared-env-vars": [
      "error",
      // Vite's built-in import.meta.env flags are compile-time constants, not env vars
      { allowList: ["^(DEV|PROD|SSR|MODE|BASE_URL)$"] },
    ],

    // --- shadcn design-system rules (https://github.com/shadcn-ui/lint) ---
    // no-raw-colors and no-inline-styles stay enabled inside the component
    // dir too; the other three are off there (see override below)

    "shadcn/no-arbitrary-values": ["error", { allow: ["layout"] }],
    "shadcn/no-inline-styles": "error",
    "shadcn/no-raw-colors": "error",
    "shadcn/no-restyle": ["error", { allow: ["layout"] }],
    // cn-* are shadcn's namespaced customization hooks and toaster is
    // sonner's documented hook; neither is Tailwind CSS, both are upstream
    // boilerplate kept so registry updates apply cleanly
    "shadcn/no-unknown-classes": ["error", { allow: ["cn-*", "toaster"] }],
    "shadcn/require-static-classes": "error",

    // --- builtin plugin preferences ---

    // effecttsgo/async-function already bans async functions, so the
    // remaining Promise interop (the clipboard, Playwright, bundler hooks)
    // has to chain .then()
    "promise/prefer-await-to-then": "off",

    // oxfmt will sort imports
    // https://github.com/oxc-project/oxc/issues/14253
    // https://github.com/oxc-project/oxc/issues/13610
    "eslint/capitalized-comments": "off",
    "eslint/class-methods-use-this": "off",
    "eslint/func-names": "off",
    "eslint/func-style": "off",
    "eslint/id-length": "off",
    "eslint/init-declarations": "off",
    "eslint/max-classes-per-file": "off",
    "eslint/max-lines": "off",
    "eslint/max-lines-per-function": "off",
    "eslint/max-statements": "off",
    "eslint/new-cap": "off",
    "eslint/no-await-in-loop": "off",
    "eslint/no-bitwise": "off",
    "eslint/no-duplicate-imports": [
      "error",
      {
        allowSeparateTypeImports: true,
      },
    ],
    "eslint/no-empty-function": "off",
    "eslint/no-inline-comments": "off",
    "eslint/no-magic-numbers": "off",
    "eslint/no-nested-ternary": "off",
    "eslint/no-plusplus": "off",
    "eslint/no-promise-executor-return": "off",
    "eslint/no-ternary": "off",
    "eslint/no-undefined": "off",
    "eslint/no-use-before-define": "off",
    "eslint/no-void": "off",
    "eslint/no-warning-comments": ["warn", { terms: ["fixme", "xxx"] }],
    "eslint/sort-imports": "off",
    "eslint/sort-keys": "off",
    // one declaration per statement; comma-joined declarations hurt readability
    "eslint/one-var": ["error", "never"],
    // A schema and its type share a name (`const Hop = Schema.Struct(...)`
    // and `type Hop = typeof Hop.Type`). TypeScript keeps values and types
    // apart, and tsc reports real redeclarations itself.
    "eslint/no-redeclare": "off",
    "eslint/no-underscore-dangle": "error",

    "import/consistent-type-specifier-style": "off",
    "import/exports-last": "off",
    "import/group-exports": "off",
    "import/max-dependencies": "off",
    "import/no-default-export": "off",
    "import/no-named-export": "off",
    "import/no-namespace": "off",
    "import/no-nodejs-modules": "off",
    "import/no-relative-parent-imports": "off",
    "import/prefer-default-export": "off",

    "jest/require-hook": "off",

    "react/jsx-filename-extension": ["error", { extensions: [".tsx"] }],
    "react/jsx-max-depth": "off",
    "react/no-children-prop": "off",
    "react/no-multi-comp": "off",
    // className/style passthrough is the shadcn composition model used by every
    // component in packages/ui; forbidding it would remove the kit's styling API
    "react/forbid-component-props": "off",
    // no i18n infrastructure in the repo; inline copy is fine until then
    "react/jsx-no-literals": "off",

    "typescript/explicit-function-return-type": "off",
    "typescript/explicit-module-boundary-types": "off",
    "typescript/no-confusing-void-expression": "off",
    "typescript/no-unsafe-type-assertion": "off",
    "typescript/prefer-readonly-parameter-types": "off",
    "typescript/promise-function-async": "off",
    "typescript/strict-boolean-expressions": "off",

    "unicorn/no-array-callback-reference": "off",
    "unicorn/no-array-for-each": "off",
    "unicorn/no-array-method-this-argument": "off",
    "unicorn/no-array-reduce": "off",
    "unicorn/no-nested-ternary": "off",
    "unicorn/no-null": "off",
    "unicorn/prefer-add-event-listener": "off",
    "unicorn/prefer-ternary": "off",
    "unicorn/switch-case-braces": "off",
  },
  settings: {
    "jsx-a11y": {
      attributes: {},
      components: {},
      polymorphicPropName: "as",
    },
    react: {
      formComponents: [],
      linkComponents: [],
    },
    vitest: {
      typecheck: false,
    },
  },
});
