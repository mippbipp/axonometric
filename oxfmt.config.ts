import { defineConfig } from "oxfmt";

export default defineConfig({
  ignorePatterns: [
    "*.md",
    "dist",
    "pnpm-lock.yaml",
    // vendored oxlint plugin: don't reformat third-party-owned source
    "tools/oxlint/anti-slop/**",
    // fixture maps are written the way an agent writes data.mjs
    "**/test/fixtures/**",
  ],
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: false,
  quoteProps: "as-needed",
  jsxSingleQuote: false,
  trailingComma: "es5",
  bracketSpacing: true,
  bracketSameLine: false,
  arrowParens: "always",
  endOfLine: "lf",
  sortImports: {},
  sortTailwindcss: {
    functions: ["clsx", "cn", "cva", "tw"],
    stylesheet: "./packages/ui/src/styles/globals.css",
  },
});
