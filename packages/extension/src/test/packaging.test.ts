// @vitest-environment node
//
// These assert file and build contracts, not rendered behaviour — and the
// jsdom the rest of the suite runs in cannot host `vite.config.ts`'s own
// esbuild import.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "../../vss-extension.json";
import viteConfig from "../../vite.config";

// The panel only exists for a user once it is an installable `.vsix`, and
// the two ways that silently fails are both file-level contracts rather
// than runtime behaviour:
//
//   1. the manifest points at something `tfx` does not put in the package
//      (a missing icon, an unpackaged path) — the extension installs and
//      then shows a broken listing;
//   2. the built panel addresses its assets absolutely, so the iframe asks
//      the ADO host for `/assets/...` — a path that belongs to ADO, not to
//      the extension — and renders blank.
//
// These assert the manifest and build contracts directly, so a broken
// package is caught in the suite rather than at install time. That
// `npm run package` itself emits a clean `.vsix` is verified by running it
// (AC 3) — a test would only re-implement `tfx`.
//
// Issue #13 / PRD #7 Phase 6.

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

/** Every path the manifest hands to ADO, which `tfx` must therefore ship. */
function addressedPaths(): string[] {
  return [
    manifest.icons.default,
    ...manifest.contributions.map(
      (contribution) => contribution.properties.uri
    ),
  ];
}

describe("extension packaging", () => {
  it("ships the real ADO Marketplace icon, not the scaffold placeholder", () => {
    // `icon.png` never existed — it was scaffold filler. The Marketplace
    // listing icon is the 128×128 export in `assets/`.
    expect(manifest.icons.default).not.toBe("icon.png");
    expect(manifest.icons.default).toMatch(/icon-ado-128\.png$/);

    // Resolved the way `tfx` resolves it: relative to the manifest.
    expect(
      existsSync(resolve(packageRoot, manifest.icons.default)),
      `${manifest.icons.default} does not resolve to a file next to vss-extension.json`
    ).toBe(true);
  });

  it("packages every path the manifest addresses", () => {
    for (const path of addressedPaths()) {
      const packaged = manifest.files.some(
        (file) => path === file.path || path.startsWith(`${file.path}/`)
      );
      expect(
        packaged,
        `${path} is addressed by the manifest but no files entry ships it`
      ).toBe(true);
    }
  });

  it("contributes the panel as a PR-detail tab", () => {
    // GREEN BEFORE THE IMPLEMENTATION — the contribution has been in place
    // since Phase 1. Kept as the guard that the packaging changes below
    // never disturb where the panel actually appears.
    const tab = manifest.contributions.find(
      (contribution) => contribution.id === "prsync-pr-panel"
    );
    expect(tab?.type).toBe("ms.vss-web.tab");
    expect(tab?.targets).toContain("ms.vss-code-web.pr-detail-page");
  });

  it("builds a relatively-addressed panel from the root index.html", () => {
    // Absolute asset URLs resolve against the ADO host, not the extension's
    // own package, so the panel must be addressed relatively.
    expect(viteConfig.base).toBe("./");

    const html = readFileSync(resolve(packageRoot, "index.html"), "utf8");
    expect(html).toContain('id="root"');
    expect(html).toContain("/src/index.tsx");
  });
});

// The panel runs on an ADO origin and calls the Function App on another, so
// every mutation is a cross-origin request. A Function App that has not
// allowed the ADO org origin fails them all at the browser — the panel
// installs, renders, and then cannot do anything, with nothing in the API's
// own logs to explain it. That makes CORS a deploy PREREQUISITE, not a
// troubleshooting note, and the deploy doc is where a deployer looks before
// discovering it the hard way.

describe("deploy prerequisites", () => {
  it("documents the Function App CORS allowance for the ADO org origin", () => {
    const docPath = resolve(repoRoot, "docs/deployment.md");
    expect(
      existsSync(docPath),
      "docs/deployment.md is missing — the deploy prerequisites are undocumented"
    ).toBe(true);

    const doc = readFileSync(docPath, "utf8");
    expect(doc).toMatch(/CORS/i);
    expect(doc).toMatch(/function app/i);
    // The allowed origin is the ADO org the panel is installed in.
    expect(doc).toMatch(/dev\.azure\.com/i);
  });
});
