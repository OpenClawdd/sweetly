import { defineConfig } from "electron-vite";

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
  },
});
