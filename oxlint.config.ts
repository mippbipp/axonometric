import { recommended } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [recommended],
  options: {
    typeAware: true,
    typeCheck: true, // not full-tree build typechecking
    denyWarnings: true,
  },
  categories: {
    correctness: "error",
    suspicious: "warn",
    pedantic: "warn",
    perf: "error",
    style: "warn",
    restriction: "warn",
    nursery: "off",
  },
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
  jsPlugins: [
    "eslint-plugin-turbo",
    "@shadcn/lint",
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    {
      name: "anti-slop-effect",
      specifier: "./tools/oxlint/anti-slop/effect/index.ts",
    },
  ],
  rules: {
    // --- anti-slop js plugin preferences ---

    "oxc/no-accumulating-spread": "error",
    "anti-slop/no-array-filter-map": "error",
    "anti-slop/no-reduce-accumulator-copy": "error",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-readable-spacing": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
    "anti-slop-effect/no-manual-effect-error-tag": "error",
    "anti-slop-effect/no-manual-tag-comparison": "error",
    "anti-slop-effect/no-manual-tagged-construction": "error",
    "anti-slop-effect/no-service-constructor-imports": [
      "error",
      { packageAliases: ["@axonometric/"] },
    ],
    "anti-slop-effect/prefer-effect-match": "error",
    // The workspace packages are private and bundled into one CLI, so no
    // export is a public library API that could leak an unstable Effect type.
    "effecttsgo/api-stability-leak": "off",
    // --- not applicable in codebase ---
    "unicorn/throw-new-error": "off", // Effect errors are values (Schema.TaggedError), never thrown
    "import/named": "off",
    "import/default": "off",
    "import/namespace": "off",
    "eslint/no-undef": "off",
    "oxc/no-async-await": "off",
    "oxc/no-optional-chaining": "off",
    "oxc/no-rest-spread-properties": "off",
    "react/react-in-jsx-scope": "off",

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

    // oxfmt will sort imports
    // https://github.com/oxc-project/oxc/issues/14253
    // https://github.com/oxc-project/oxc/issues/13610
    "eslint/sort-imports": "off",
    "eslint/max-lines-per-function": "off",
    "eslint/max-lines": "off",
    "eslint/init-declarations": "off",
    "eslint/new-cap": "off",
    "eslint/sort-keys": "off",
    "eslint/func-names": "off",
    "eslint/func-style": "off",
    "eslint/no-magic-numbers": "off",
    "eslint/no-ternary": "off",
    "eslint/no-nested-ternary": "off",
    "eslint/no-bitwise": "off",
    "eslint/no-void": "off",
    "eslint/class-methods-use-this": "off",
    "eslint/capitalized-comments": "off",
    "eslint/max-statements": "off",
    "eslint/max-classes-per-file": "off",
    "eslint/id-length": "off",
    "eslint/no-undefined": "off",
    "eslint/no-duplicate-imports": [
      "error",
      {
        allowSeparateTypeImports: true,
      },
    ],
    "eslint/no-plusplus": "off",
    "eslint/no-await-in-loop": "off",
    "eslint/no-promise-executor-return": "off",
    "eslint/no-inline-comments": "off",
    "eslint/no-warning-comments": ["warn", { terms: ["fixme", "xxx"] }],
    "eslint/no-use-before-define": "off",
    "eslint/no-empty-function": "off",
    // one declaration per statement; comma-joined declarations hurt readability
    "eslint/one-var": ["error", "never"],
    // A schema and its type share a name (`const Hop = Schema.Struct(...)`
    // and `type Hop = typeof Hop.Type`). TypeScript keeps values and types
    // apart, and tsc reports real redeclarations itself.
    "eslint/no-redeclare": "off",
    "eslint/no-underscore-dangle": "error",

    "import/no-namespace": "off",
    "import/no-named-export": "off",
    "import/prefer-default-export": "off",
    "import/exports-last": "off",
    "import/group-exports": "off",
    "import/max-dependencies": "off",
    "import/no-relative-parent-imports": "off",
    "import/no-nodejs-modules": "off",
    "import/no-default-export": "off",
    "import/consistent-type-specifier-style": "off",

    "jest/require-hook": "off",

    "react/jsx-filename-extension": ["error", { extensions: [".tsx"] }],
    "react/jsx-max-depth": "off",
    "react/no-multi-comp": "off",
    "react/no-children-prop": "off",
    // className/style passthrough is the shadcn composition model used by every
    // component in packages/ui; forbidding it would remove the kit's styling API
    "react/forbid-component-props": "off",
    // no i18n infrastructure in the repo; inline copy is fine until then
    "react/jsx-no-literals": "off",

    "typescript/no-unsafe-type-assertion": "off",
    "typescript/explicit-module-boundary-types": "off",
    "typescript/explicit-function-return-type": "off",
    "typescript/promise-function-async": "off",
    "typescript/strict-boolean-expressions": "off",
    "typescript/no-confusing-void-expression": "off",
    "typescript/prefer-readonly-parameter-types": "off",

    "unicorn/prefer-ternary": "off",
    "unicorn/prefer-add-event-listener": "off",
    "unicorn/no-array-method-this-argument": "off",
    "unicorn/no-array-callback-reference": "off",
    "unicorn/no-null": "off",
    "unicorn/no-nested-ternary": "off",
    "unicorn/no-array-for-each": "off",
    "unicorn/switch-case-braces": "off",
    "unicorn/no-array-reduce": "off",
  },
  overrides: [
    {
      // CLI entrypoint: the top-level runMain launches the process,
      // it is not test setup code
      files: ["packages/cli/src/bin.ts"],
      rules: {
        "vitest/require-hook": "off",
        "effecttsgo/strict-effect-provide": "off",
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
      files: ["**/*.test.ts", "**/test/**/*.ts"],
      rules: {
        // @effect/vitest layer() owns setup and teardown internally
        "vitest/no-importing-vitest-globals": "off",
        // @effect/vitest layer() owns setup and teardown internally
        "vitest/require-hook": "off",
        // Effect-integrated assert replaces expect.hasAssertions.
        "vitest/prefer-expect-assertions": "off",
        "effecttsgo/strict-effect-provide": "off",
        // shared test helpers are plain data functions, so a data-last overload
        // has nothing to dualize
        "effecttsgo/missing-pipeable-signature": "off",
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
  settings: {
    "jsx-a11y": {
      polymorphicPropName: "as",
      components: {},
      attributes: {},
    },
    react: {
      formComponents: [],
      linkComponents: [],
    },
    vitest: {
      typecheck: false,
    },
  },
  env: {
    builtin: true,
  },
  globals: {},
  ignorePatterns: [
    "dist/**",
    // agent tooling dirs (installed skills/hooks) and the vendored plugin
    // itself are not application source
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
    "tools/oxlint/anti-slop/**",
    // fixture maps are written the way an agent writes data.mjs
    "**/test/fixtures/**",
  ],
});
