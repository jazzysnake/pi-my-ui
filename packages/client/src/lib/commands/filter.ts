/**
 * Fuzzy filtering for the palette. A case-insensitive subsequence match: every character of the
 * query must appear in the target, in order, and a match that is consecutive or starts a word ranks
 * above a scattered one, so typing `cmp` puts `/compact` first.
 *
 * Pure and deterministic: same query and target, same score. No clock, randomness or locale.
 */

/** Points per matched character. Any positive constant works; the bonuses do the ranking. */
const SCORE_PER_MATCHED_CHARACTER = 1;
/** Bonus when a matched character immediately follows the previous match. */
const SCORE_CONSECUTIVE_BONUS = 8;
/** Bonus when a matched character starts the target or follows a word boundary. */
const SCORE_WORD_START_BONUS = 6;
/** Word separators in a command name, so the character after one starts a word. */
const WORD_BOUNDARY = /[\s/_.:-]/;
/** No character matched yet; `found === NO_PREVIOUS_MATCH + 1` is then false, so no bonus. */
const NO_PREVIOUS_MATCH = -2;

/** Score `query` as a subsequence of `target`, or `null` when it is not one. */
export function fuzzyScore(query: string, target: string): number | null {
  const needle = query.toLowerCase();
  const haystack = target.toLowerCase();
  if (needle.length === 0) {
    return 0;
  }
  if (needle.length > haystack.length) {
    return null;
  }
  let score = 0;
  let from = 0;
  let previousMatch = NO_PREVIOUS_MATCH;
  for (const character of needle) {
    const found = haystack.indexOf(character, from);
    if (found === -1) {
      return null;
    }
    score += SCORE_PER_MATCHED_CHARACTER;
    if (found === previousMatch + 1) {
      score += SCORE_CONSECUTIVE_BONUS;
    }
    const before = found === 0 ? "" : (haystack.at(found - 1) ?? "");
    if (before === "" || WORD_BOUNDARY.test(before)) {
      score += SCORE_WORD_START_BONUS;
    }
    previousMatch = found;
    from = found + 1;
  }
  return score;
}

/**
 * The items whose `key(item)` matches `query`, best score first and ties in their original order, so
 * the list does not jump between equal matches. A blank query keeps every item in its given order.
 */
export function filterByFuzzyQuery<T>(
  items: readonly T[],
  query: string,
  key: (item: T) => string,
): readonly T[] {
  if (query.trim().length === 0) {
    return items;
  }
  const scored: { item: T; position: number; score: number }[] = [];
  items.forEach((item, position) => {
    const score = fuzzyScore(query, key(item));
    if (score !== null) {
      scored.push({ item, position, score });
    }
  });
  scored.sort((left, right) => right.score - left.score || left.position - right.position);
  return scored.map((entry) => entry.item);
}
