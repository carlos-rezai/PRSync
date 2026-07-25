// A client copy of the API's PR key builder. The panel and the API must
// produce byte-identical keys — the key is the Table Storage partition
// key both sides share. Format: `{guid}:{guid}:{int}`, matching
// packages/api/src/lib/prKey exactly. See docs/ubiquitous-language.md
// ("PR key").

export interface PrKeyParts {
  projectId: string;
  repositoryId: string;
  pullRequestId: number;
}

export function buildPrKey(parts: PrKeyParts): string {
  return `${parts.projectId}:${parts.repositoryId}:${parts.pullRequestId}`;
}
