/** Text normalization + token overlap for the fuzzy, name-based match signals (D11). */

/** Lowercase, strip diacritics, and reduce to alphanumeric tokens separated by single spaces. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tokenize(input: string): string[] {
  const normalized = normalizeText(input);
  return normalized === '' ? [] : normalized.split(' ');
}

/**
 * The fraction of `queryTokens` present in `textTokens` — "how much of the wanted name appears
 * in the candidate?". An empty query is trivially contained.
 */
export function containmentScore(
  queryTokens: readonly string[],
  textTokens: readonly string[],
): number {
  if (queryTokens.length === 0) return 1;
  const present = new Set(textTokens);
  const matched = queryTokens.filter((token) => present.has(token)).length;
  return matched / queryTokens.length;
}
