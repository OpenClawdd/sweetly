import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * Swaps upstream Spicy modules for Sweetly's adapters at resolve time.
 *
 * Matching on the import specifier is unreliable — upstream writes the same
 * module ten different ways ("../Global/SpotifyPlayer", "./components/Global/
 * SpotifyPlayer.ts", …), with and without the extension. So we let Vite resolve
 * the specifier first and match on the absolute path it lands on.
 *
 * This is what keeps src/ byte-identical to upstream: no upstream file is
 * edited, so `diff -r src spicy-lyrics/src` remains the record of changes that
 * AGPL-3.0 asks us to state.
 */
function substituteUpstreamModules(substitutions: Record<string, string>): Plugin {
  const entries = Object.entries(substitutions);
  return {
    name: "sweetly:substitute-upstream",
    enforce: "pre",
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;
      const id = resolved.id.replace(/\\/g, "/");
      for (const [suffix, replacement] of entries) {
        if (id.endsWith(suffix)) return replacement;
      }
      return null;
    },
  };
}

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
    plugins: [
      substituteUpstreamModules({
        "src/components/Global/SpotifyPlayer.ts": resolve(
          __dirname,
          "src/renderer/adapter/AppleMusicPlayer.ts"
        ),
        "src/components/Global/Platform.ts": resolve(
          __dirname,
          "src/renderer/adapter/platformShim.ts"
        ),
      }),
      react(),
    ],
  },
});
