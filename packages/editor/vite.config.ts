import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  // One self-contained HTML file: `axonometric build` inlines the map state
  // into it, and it must open from disk with no other files.
  plugins: [tailwindcss(), react(), viteSingleFile()],
});
