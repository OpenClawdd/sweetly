import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    build: { outDir: "build/main" },
  },
  preload: {
    build: {
      outDir: "build/preload",
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "index.js",
        },
      },
    },
  },
  renderer: {
    build: { outDir: "build/renderer" },
    plugins: [react()],
    resolve: {
      alias: [
        // Upstream Spicy files import these by relative path from many depths.
        // Matching the module suffix rather than one absolute path means no
        // upstream file has to be edited, so `diff -r src spicy-lyrics/src`
        // stays the statement of changes AGPL-3.0 asks for.
        {
          find: /^.*\/components\/Global\/SpotifyPlayer\.ts$/,
          replacement: resolve(__dirname, "src/renderer/adapter/AppleMusicPlayer.ts"),
        },
        {
          find: /^.*\/components\/Global\/Platform\.ts$/,
          replacement: resolve(__dirname, "src/renderer/adapter/platformShim.ts"),
        },
      ],
    },
  },
});
