// The markdown reads the documentation tests share.
//
// Two tests in this package assert the agreement between a document and
// the source it makes claims about: `deploymentDocs.test.ts` (every
// setting the code reads is documented, under the package that reads it)
// and `userDocs.test.ts` (the guides and the ubiquitous language do not
// drift). Both need the same three things — open a document and fail
// loudly if it is missing, isolate one section of it, and recognise a
// PRSync setting token — and the first of them had all three private.
//
// It lives here rather than in either test for the same reason
// `sourceFiles.ts` does: it is a cross-layer test helper, which is
// exactly what `src/test/fixtures/` holds, and the same reason `fakes.ts`
// and `fixtures.ts` sit outside the layer conventions.
//
// The link resolver at the bottom joins them for the same reason: the four
// user-facing documents cross-reference each other instead of repeating
// each other, and a link that resolves to nothing is a worse answer than
// the duplication it replaced.
//
// The unanimity scanner joins them last, and it is the one reader here that
// is not looking at markdown alone. Three DERIVED SURFACES summarise the
// user guide — the README, the Marketplace listing's `description` and the
// Teams manifest's `description.full` — and two of the three are strings
// inside build manifests. So a surface is a path plus an optional JSON
// field, and the check is against the field's VALUE rather than the file's
// raw text: reformatting a manifest cannot break it, and a sibling field it
// was not pointed at cannot trip it.

import { posix } from "node:path";
import { outsideFences } from "../../lib";
import type { Repo } from "../../repo";

/**
 * The shapes every PRSync deployment setting takes. Names are discovered
 * from source rather than listed anywhere on purpose: a hardcoded list is
 * one more thing to forget to update, and would make a test pass by
 * agreeing with itself.
 *
 * Note the `g` flag: use this with `String.prototype.match`, which resets
 * `lastIndex` for you. `.test()` and `.exec()` on a shared global regex
 * resume from wherever the previous caller left off, and two test files
 * now consume this one.
 */
export const SETTING_PATTERN =
  /\b(?:MICROSOFT_APP_[A-Z0-9_]+|AZURE_[A-Z0-9_]*CONNECTION_STRING|PRSYNC_[A-Z0-9_]+|VITE_[A-Z0-9_]+)\b/g;

/**
 * The anchor GitHub generates for a heading, which is what an `#anchor`
 * link has to match.
 *
 * The rules, and the reason a naive lowercase-and-hyphen pass is not good
 * enough: GitHub lowercases, DELETES everything that is not a letter, a
 * digit, a space, an underscore or a hyphen, and only then turns spaces
 * into hyphens. Deleting rather than hyphenating is what makes
 * ``## Why `/api/messages` is anonymous`` slug as `why-apimessages-is-…`,
 * and a link written against the hyphenated guess resolves against
 * nothing while looking correct.
 *
 * The consequence that looks like a bug and is not: an em-dash is deleted
 * and the two spaces around it survive, so every heading in this repo's
 * house style slugs with a DOUBLE hyphen. Tidying runs of hyphens away is
 * wrong for every stage heading in `docs/setup-guide.md` at once.
 */
export function githubSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Why a link resolves to nothing. */
export type UnresolvedReason = "no such file" | "no such heading";

/** One link that goes nowhere, named the way a linter would name it. */
export interface UnresolvedLink {
  /** The document it is written in, repo-relative. */
  document: string;
  /** The 1-based line it is written on. */
  line: number;
  /** The destination exactly as written, so the failure is greppable. */
  target: string;
  reason: UnresolvedReason;
}

/** What to check: the documents, and the filesystem to resolve against. */
export interface LinkCheck {
  /**
   * The documents to read, repo-relative. Data rather than parameters, so
   * adding a fourth document changes no signature anywhere.
   */
  documents: readonly string[];
  repo: Repo;
}

/** `[text](destination)`, capturing the destination and dropping a title. */
const MARKDOWN_LINK = /\[[^\]]*\]\(\s*([^)\s]+)[^)]*\)/g;

/**
 * A destination that is not a path inside this repository: an absolute
 * URL, a `mailto:`, a protocol-relative host, or a site-root path. The
 * resolver takes no position on the web, and no document in this repo
 * writes a leading slash.
 */
function isOutsideRepo(destination: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(destination);
}

/** Every heading anchor `markdown` actually offers. */
function headingSlugs(markdown: string): Set<string> {
  const lines = markdown.split("\n");
  const outside = outsideFences(lines);
  const slugs = new Set<string>();

  lines.forEach((line, index) => {
    if (!outside[index]) return;
    // Deliberately unanchored at the end: these documents are CRLF, and a
    // `$` after `(.*)` matches nothing on a line ending in `\r`. What the
    // capture picks up instead is trimmed by `githubSlug`.
    const heading = line.match(/^#{1,6}\s+(.*)/);
    if (heading) slugs.add(githubSlug(heading[1] ?? ""));
  });

  return slugs;
}

/**
 * Every relative link and `#anchor` in `documents` that resolves to
 * nothing — a missing file, or an anchor matching no heading in the
 * document it points at.
 *
 * Each destination is resolved relative to the document it is written in,
 * because `README.md` and `docs/setup-guide.md` must spell the same target
 * differently. Resolving everything from the repo root instead passes both
 * spellings, which is the bug that makes a link checker worthless.
 */
export function unresolvedLinks({
  documents,
  repo,
}: LinkCheck): UnresolvedLink[] {
  const hits: UnresolvedLink[] = [];
  const anchors = new Map<string, Set<string>>();

  /** `path`'s anchors, read once however many links point at it. */
  const anchorsOf = (path: string, known?: string): Set<string> => {
    const cached = anchors.get(path);
    if (cached) return cached;

    const found = headingSlugs(known ?? repo.read(path));
    anchors.set(path, found);
    return found;
  };

  for (const document of documents) {
    // The documents in the set are READ, never existence-checked: the
    // caller pins those paths, and a missing one is `readDoc`'s failure to
    // report rather than a link to nowhere.
    const text = repo.read(document);
    const lines = text.split("\n");
    const outside = outsideFences(lines);
    const directory = posix.dirname(document);

    lines.forEach((line, index) => {
      if (!outside[index]) return;

      for (const match of line.matchAll(MARKDOWN_LINK)) {
        const target = match[1] ?? "";
        if (isOutsideRepo(target)) continue;

        const [file, anchor] = splitAnchor(target);
        const path = file === "" ? document : posix.join(directory, file);

        if (file !== "" && !repo.exists(path)) {
          hits.push({
            document,
            line: index + 1,
            target,
            reason: "no such file",
          });
          continue;
        }

        if (anchor === undefined) continue;

        const own = path === document ? text : undefined;
        if (!anchorsOf(path, own).has(anchor)) {
          hits.push({
            document,
            line: index + 1,
            target,
            reason: "no such heading",
          });
        }
      }
    });
  }

  return hits;
}

/**
 * A destination split into its file part and its anchor. An empty file
 * part is a bare `#anchor`, which resolves against the linking document's
 * own headings.
 */
function splitAnchor(destination: string): [string, string | undefined] {
  const hash = destination.indexOf("#");
  if (hash === -1) return [destination, undefined];

  return [
    destination.slice(0, hash),
    destination.slice(hash + 1).toLowerCase(),
  ];
}

/**
 * One user-facing surface the alias scan reads.
 *
 * Two of the three derived surfaces are strings inside build manifests
 * rather than documents, which is why a surface is a path AND an optional
 * field rather than just a path: reading a manifest as raw text both trips
 * on the sibling fields the scan must ignore and moves its line numbers on
 * a reformat that changed nothing.
 */
export interface Surface {
  /** Repo-relative path. */
  path: string;
  /**
   * A dotted path to a string field, for a JSON surface — `description.full`.
   * Absent means the surface is the whole document.
   */
  field?: string;
}

/** One sentence describing a close rule PRSync does not have. */
export interface UnanimityHit {
  /** The surface it is written on: `path`, or `path#field` for a JSON one. */
  surface: string;
  /** The 1-based line within the surface's text. */
  line: number;
  /** The alias that matched, named as `docs/ubiquitous-language.md` lists it. */
  alias: string;
  /** The line as written, trimmed, so the failure reads like a linter. */
  text: string;
}

/** What to scan: the surfaces, and the filesystem to read them from. */
export interface SurfaceScan {
  /**
   * The surfaces to read. Data rather than parameters for the same reason
   * `LinkCheck.documents` is: a fourth derived surface changes no signature.
   */
  surfaces: readonly Surface[];
  repo: Repo;
}

/**
 * The text a surface offers the scan: a document whole, or one JSON field's
 * string value.
 *
 * Every way of having nothing to scan answers `""` rather than throwing — a
 * renamed field, a file that is not JSON, a field holding an object instead
 * of a sentence, a path that is not there. The caller's floor then reports
 * "this surface yielded no text" under the surface's own name, which is a
 * better failure than a parse trace from in here.
 */
export function surfaceText({ path, field }: Surface, repo: Repo): string {
  const raw = repo.read(path);
  if (field === undefined) return raw;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return "";
  }

  for (const key of field.split(".")) {
    if (typeof value !== "object" || value === null) return "";
    value = (value as Record<string, unknown>)[key];
  }

  return typeof value === "string" ? value : "";
}

/** A phrase that describes a close rule PRSync does not have. */
interface Alias {
  /** What a failure names — the phrase as the ubiquitous language lists it. */
  label: string;
  pattern: RegExp;
}

/**
 * The unanimity vocabulary, from the ubiquitous language's "Unanimity
 * language is drift, not phrasing" entry.
 *
 * A round closes on **Quorum**. Every phrase here describes closing on
 * unanimity instead, and each is the natural, friendly way to write the
 * sentence — which is exactly why the list is pinned rather than trusted to
 * one regex.
 *
 * Note the absent `g` flag: `.test()` on a shared global regex resumes from
 * wherever the previous line left off, so half the lines would go unscanned.
 */
const UNANIMITY_ALIASES: readonly Alias[] = [
  { label: "everyone", pattern: /everyone/i },
  { label: "consensus", pattern: /consensus/i },
  { label: "unanimous", pattern: /unanimous|unanimity/i },
  { label: "all reviewers", pattern: /all\s+reviewe(?:rs?|d)/i },
  { label: "signed off", pattern: /signed[\s-]off/i },
  { label: "approved", pattern: /approved/i },
  { label: "the last reviewer", pattern: /last\s+reviewer/i },
];

/**
 * `line` with every double-quoted span removed.
 *
 * The quotation marks ARE the allowance, and it is load-bearing rather than
 * decorative: the user guide is required to quote the panel's copy
 * unchanged, and the pill reads "All reviewed" whether or not everyone on
 * the reviewer list looked. The README quotes the AIUP strategy PRSync
 * exists to serve — "wait for all reviewers, then act" describes how the
 * team works, not when a round closes.
 *
 * Written as prose, both are checked, which is what keeps the scan blunt
 * about the sentence that would actually be wrong.
 */
function withoutQuotations(line: string): string {
  return line.replace(/"[^"]*"/g, " ");
}

/**
 * Every sentence on `surfaces` that describes closing in unanimity
 * language.
 *
 * Deliberately BLUNT: it matches words, not meaning, so it will
 * occasionally ask for a sentence to be rephrased that was not actually
 * wrong. That is the accepted cost of catching the one paraphrase that is —
 * and that paraphrase has shipped in this repo more than once.
 */
export function unanimityAliases({
  surfaces,
  repo,
}: SurfaceScan): UnanimityHit[] {
  const hits: UnanimityHit[] = [];

  for (const surface of surfaces) {
    const label = surface.field
      ? `${surface.path}#${surface.field}`
      : surface.path;

    surfaceText(surface, repo)
      .split("\n")
      .forEach((raw, index) => {
        const prose = withoutQuotations(raw);

        for (const { label: alias, pattern } of UNANIMITY_ALIASES) {
          if (pattern.test(prose)) {
            hits.push({
              surface: label,
              line: index + 1,
              alias,
              text: raw.trim(),
            });
          }
        }
      });
  }

  return hits;
}
