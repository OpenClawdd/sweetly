import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The adapter and TTML converter both touch DOM APIs (DOMParser, canvas,
    // document), so the unit tests need a document even though nothing renders.
    environment: "happy-dom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // artworkColors' load guard waits 3s before falling back, and one test
    // exercises exactly that path.
    testTimeout: 8000,
  },
});
