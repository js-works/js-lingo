import { defineConfig } from "vite";
import { resolve } from "node:path";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      include: ["src"],
      bundleTypes: true, // one bundled .d.ts per entry
    }),
  ],
  build: {
    minify: false, // libraries ship readable code; consumers minify
    sourcemap: true,
    target: "es2022", // Object.hasOwn + #private fields must survive untranspiled
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        "web-components": resolve(__dirname, "src/web-components/index.ts"),
      },
      formats: ["es"], // ESM only — see note on "cjs" below
    },
    rollupOptions: {
      // Keep the core out of the web-components bundle: it must reference the shared
      // core, not inline a second copy. Requires web-components/index.ts to import
      // the core as "js-lingo" (self-reference), not relatively.
      external: [/^js-lingo(\/.*)?$/, /^node:/],
      output: {
        entryFileNames: "[name].js", // -> base.js, web-components.js (no collision)
      },
    },
  },
});
