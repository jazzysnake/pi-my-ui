import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [svelte()],
  // Compile components for the browser so the suite mounts the real thing rather than a SSR build.
  resolve: { conditions: ["browser"] },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
  },
});
