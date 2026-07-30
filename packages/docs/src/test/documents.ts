import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Surface } from "../checks";

// The registry of what PRSync puts in front of a reader.
//
// These constants used to be scattered across two hundred lines of one
// spec file, in the order the four build phases happened to add them.
// Gathered here they answer a question the repo previously could not
// answer from any single place: WHAT COUNTS AS USER-FACING?
//
// That matters because the answer is not obvious. Two of the five surfaces
// are not documents at all but strings inside build manifests, edited by
// someone thinking about packaging; and five more documents under `docs/`
// are the build's paper trail, which must never be scanned for prose
// because they write the superseded rule down on purpose.
//
// Adding a document is one entry here and no signature change anywhere.
// That is an interface property of `LinkCheck.documents` and
// `SurfaceScan.surfaces` rather than a convention, and each check's own
// test drives it.

/** The repository root, from this file's fixed depth under it. */
export const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

/** An absolute path to a repo-relative one, for the readers that need it. */
export const at = (path: string): string => resolve(repoRoot, path);

export const USER_GUIDE = "docs/user-guide.md";
export const SETUP_GUIDE = "docs/setup-guide.md";
export const DEPLOYMENT = "docs/deployment.md";
export const UBIQUITOUS_LANGUAGE = "docs/ubiquitous-language.md";
export const README = "README.md";

/**
 * The two guides the close-rule scan reads. The user guide is
 * authoritative for what PRSync does and the setup guide describes the
 * close rule in passing — a wrong sentence in either is the same wrong
 * sentence.
 */
export const GUIDES: readonly Surface[] = [
  { path: USER_GUIDE },
  { path: SETUP_GUIDE },
];

/**
 * The Teams app's description, named on its own because it is the
 * sentence a teammate reads at the moment they install PRSync, and
 * because it is the one that shipped wrong.
 */
export const TEAMS_DESCRIPTION: Surface = {
  path: "packages/bot/teams/manifest.json",
  field: "description.full",
};

/** The Marketplace listing's description. */
export const MARKETPLACE_DESCRIPTION: Surface = {
  path: "packages/extension/vss-extension.json",
  field: "description",
};

/**
 * The three derived surfaces: every user-facing description that is not
 * the user guide. Each may summarise it; none may add a claim of its own,
 * and all three are edited in files whose reviewer is thinking about
 * packaging rather than about the close rule.
 */
export const DERIVED_SURFACES: readonly Surface[] = [
  { path: README },
  TEAMS_DESCRIPTION,
  MARKETPLACE_DESCRIPTION,
];

/**
 * The documents whose links are resolved.
 *
 * Repo-relative, because that is what a `Repo` is keyed by — the resolver
 * never sees an absolute path, so a failure names a file the way the
 * reader's editor does.
 */
export const CROSS_REFERENCED: readonly string[] = [
  README,
  SETUP_GUIDE,
  USER_GUIDE,
  // Read as SOURCES, not merely as targets. `docs/deployment.md` gained
  // back-links when the setup guide started routing to it, and the
  // ubiquitous language links out too — and until now neither had ever
  // had a link of its own resolved.
  DEPLOYMENT,
  UBIQUITOUS_LANGUAGE,
];

/**
 * What the close-rule scan must never read.
 *
 * Every one of these names the superseded rule ON PURPOSE — design logs
 * are immutable snapshots of what was believed at the time, and the
 * ubiquitous language's aliases-to-avoid columns and its "Unanimity
 * language is drift" entry exist precisely to write the wrong words down
 * so they are recognisable. A scanner pointed at them fails on day one,
 * for the right words in the right places, and the only available fix
 * would be to delete the record.
 *
 * Note that the gloss check READS `docs/ubiquitous-language.md` and must,
 * and the link check resolves its links: this exclusion is scoped to the
 * alias scan, not to the file.
 */
export const NEVER_SCANNED: readonly string[] = [
  "docs/design-logs/",
  "docs/PRDs/",
  "docs/refactor-plans/",
  "docs/dev-journal.md",
  UBIQUITOUS_LANGUAGE,
];

/**
 * The last stage the setup guide carries. Pinned rather than derived from
 * the document, because a count read out of the document it is checking
 * would agree with itself: deleting the final stage would move the
 * expected count down with it. Eleven stages plus stage 0 is the
 * documented contract — the stage table in `docs/PRDs/04-user-docs-plan.md`
 * and `docs/design-logs/04-user-docs.md`. Adding a twelfth is a decision,
 * and a decision should have to touch this line.
 */
export const LAST_STAGE = 11;

/** The one terminology section the user guide is allowed to carry. */
export const GLOSS_HEADING = /^#+\s+Five words PRSync uses precisely\s*$/i;
