import { defineConfig } from "vite";
import { resolve } from "path";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
      include: ["src"],
    }),
  ],
  build: {
    minify: "esbuild",
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "js-lingo",
      formats: ["es", "cjs"],
      fileName: (format) => `index.${format}`,
    },
  },
});
