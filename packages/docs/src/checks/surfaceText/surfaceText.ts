import type { Repo } from "../../repo";

/**
 * One user-facing surface a scan reads.
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

/** How a surface names itself in a failure: `path`, or `path#field`. */
export function surfaceLabel({ path, field }: Surface): string {
  return field ? `${path}#${field}` : path;
}

/**
 * The text a surface offers a scan: a document whole, or one JSON field's
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
