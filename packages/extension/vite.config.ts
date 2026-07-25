import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The panel is served from inside the ADO extension package, addressed by
// a relative path (`dist/index.html`), so assets must be referenced
// relatively — hence `base: "./"`. Vitest config lives separately in
// vitest.config.ts.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
