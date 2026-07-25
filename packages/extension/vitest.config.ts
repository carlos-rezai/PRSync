import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The panel renders `azure-devops-ui` React components, so its tests run
// in a jsdom environment with @testing-library/react. The `sdk`/`api`/
// `ado` clients are dependency-injected as fakes into `App` — no SDK is
// mocked, and no live ADO host is contacted. See PRD #7 "Testing seam".
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
