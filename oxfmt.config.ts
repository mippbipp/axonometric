import { defineConfig } from "oxfmt";

export default defineConfig({
  arrowParens: "always",
  bracketSameLine: false,
  bracketSpacing: true,
  endOfLine: "lf",
  ignorePatterns: [
    "*.md",
    "dist",
    "bun.lock",
    // agent tooling dirs (installed skills/hooks) are not application source
    ".agents/**",
    // fixture maps are written the way an agent writes data.mjs
    "**/test/fixtures/**",
  ],
  jsxSingleQuote: false,
  printWidth: 80,
  quoteProps: "as-needed",
  semi: true,
  singleQuote: false,
  sortImports: {},
  sortTailwindcss: {
    functions: ["clsx", "cn", "cva", "tw"],
    stylesheet: "./packages/ui/src/styles/globals.css",
  },
  tabWidth: 2,
  trailingComma: "es5",
  useTabs: false,
});
