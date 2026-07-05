import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// ESM-only library build. Three entry points that share the core:
//   .                -> src/index.ts               (vanilla, dependency-free)
//   ./web-components -> src/web-components/index.ts (vanilla, dependency-free)
//   ./react          -> src/react/index.ts         (needs React as an optional peer)
//
// The core is NOT externalized, so it is emitted as a shared chunk that all three
// entries import — one core instance, no duplication. React IS externalized so it is
// never bundled into the ./react entry (the host app owns its single React copy).
export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true, // emit a .d.ts entry per lib entry
      include: ["src"],
    }),
  ],
  build: {
    target: "es2022", // Object.hasOwn + #private fields must survive untranspiled
    minify: false, // libraries ship readable code; consumers minify
    sourcemap: true,
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        "msg/index": resolve(__dirname, "src/msg/index.ts"),
        "web-components/index": resolve(__dirname, "src/web-components/index.ts"),
        "react/index": resolve(__dirname, "src/react/index.ts"),
      },
      formats: ["es"],
    },
    rollupOptions: {
      // React (and react-dom / jsx-runtime) stay external — an optional peer, owned by
      // the host app. node: builtins never get bundled either.
      external: [/^react($|\/)/, /^react-dom($|\/)/, /^node:/],
      output: {
        entryFileNames: "[name].js", // -> index.js, web-components/index.js, react/index.js
        // shared code (the core) lands in chunks/ — the single shared core instance
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
});
