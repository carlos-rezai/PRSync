// PR key = `{projectId}:{repositoryId}:{pullRequestId}` — two GUIDs and
// a positive integer. It is the Table Storage partition key, because a
// raw PR number is unique only within a repository, never globally.

export interface PrKeyParts {
  projectId: string;
  repositoryId: string;
  pullRequestId: number;
}

const GUID =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
// `[1-9][0-9]*` accepts only a positive integer with no leading zero,
// sign, or fractional part — so `0`, `-3`, `1.5`, and `abc` all fail.
const PR_KEY_RE = new RegExp(`^(${GUID}):(${GUID}):([1-9][0-9]*)$`);

export function buildPrKey(parts: PrKeyParts): string {
  return `${parts.projectId}:${parts.repositoryId}:${parts.pullRequestId}`;
}

export function parsePrKey(key: string): PrKeyParts {
  const match = PR_KEY_RE.exec(key);
  if (!match) {
    throw new Error(`Malformed PR key: ${key}`);
  }
  return {
    projectId: match[1]!,
    repositoryId: match[2]!,
    pullRequestId: Number(match[3]),
  };
}

export function isValidPrKey(key: string): boolean {
  return PR_KEY_RE.test(key);
}
