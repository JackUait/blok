/**
 * Item that could be searched
 */
export interface SearchableItem {
  /**
   * Items title (displayed, possibly translated)
   */
  title?: string;

  /**
   * English title for fallback search (always matches English input)
   */
  englishTitle?: string;

  /**
   * Additional search terms/aliases (e.g., ['h1', 'title'])
   */
  searchTerms?: string[];
}

/**
 * Standard Levenshtein distance using single-row optimization.
 * @param a - first string
 * @param b - second string
 * @returns edit distance between a and b
 */
const levenshteinDistance = (a: string, b: string): number => {
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }

  /**
   * Two-row DP approach: prevRow holds distances for the previous character of `a`,
   * currRow is computed for the current character, then they swap.
   */
  const prevRow = Array.from({ length: b.length + 1 }, (_, i) => i);
  const currRow = new Array<number>(b.length + 1);

  for (const [idx, char] of [...a].entries()) {
    currRow[0] = idx + 1;

    for (const [jIdx, bChar] of [...b].entries()) {
      const j = jIdx + 1;
      const cost = char === bChar ? 0 : 1;

      currRow[j] = Math.min(
        prevRow[j] + 1,        // deletion
        currRow[j - 1] + 1,    // insertion
        prevRow[j - 1] + cost   // substitution
      );
    }

    /** Copy currRow into prevRow for the next iteration */
    prevRow.splice(0, prevRow.length, ...currRow);
  }

  return prevRow[b.length];
};

const isWordStart = (target: string, index: number): boolean =>
  index === 0 || target[index - 1] === ' ' || target[index - 1] === '-' || target[index - 1] === '_';

/**
 * Checks if query characters appear in order in target (subsequence match).
 *
 * The match must start at a word start, and each time it moves on to a later
 * word it must land on that word's first letter. Without the first rule "hea"
 * matched "w(h)it(e)sp(a)ce" (Spacer); without the second "board" matched
 * "(b)r(o)wn b(a)ckg(r)oun(d)" (Brown background).
 * @param target - string to search in
 * @param query - characters to find in order
 * @returns true if query is such a subsequence of target
 */
const isSubsequence = (target: string, query: string): boolean => {
  const failed = new Set<string>();
  const matchFrom = (qi: number, prev: number): boolean => {
    if (qi === query.length) {
      return true;
    }
    if (failed.has(`${qi}:${prev}`)) {
      return false;
    }

    const found = [...target.slice(prev + 1)].some((char, offset) => {
      const index = prev + 1 + offset;
      const sameWord = prev >= 0 && !/[ \-_]/.test(target.slice(prev + 1, index));

      return char === query[qi] && (sameWord || isWordStart(target, index)) && matchFrom(qi + 1, index);
    });

    if (!found) {
      failed.add(`${qi}:${prev}`);
    }

    return found;
  };

  return query.length === 0 || matchFrom(0, -1);
};

/**
 * Checks if query characters match at word boundaries in target.
 * Word boundaries are: start of string, after space, hyphen, or underscore.
 * @param target - string to search in
 * @param query - characters to match at word boundaries
 * @returns true if each query char matches a word-boundary character in order
 */
const matchesWordBoundaries = (target: string, query: string): boolean => {
  const matched = [...target].reduce(
    (qi, char, ti) => {
      return qi < query.length && isWordStart(target, ti) && char === query[qi] ? qi + 1 : qi;
    },
    0
  );

  return matched === query.length;
};

/**
 * Scores how well a single string matches a lowercased query.
 * @param target - string to score against (already lowercased)
 * @param lowerQuery - search query (already lowercased)
 * @returns score: 100 (exact) > 90 (prefix) > 75 (substring) > 55 (word-boundary) > 35 (subsequence) > 15 (typo) > 0
 */
const scoreString = (target: string, lowerQuery: string): number => {
  if (target === lowerQuery) {
    return 100;
  }
  if (target.startsWith(lowerQuery)) {
    return 90;
  }
  if (target.includes(lowerQuery)) {
    return 75;
  }
  if (lowerQuery.length >= 2 && matchesWordBoundaries(target, lowerQuery)) {
    return 55;
  }
  if (lowerQuery.length >= 2 && isSubsequence(target, lowerQuery)) {
    return 35;
  }
  /*
   * A typo keeps the first letter and at most one extra or missing letter,
   * unless the query just runs on past the term ("linked" for "link").
   * Otherwise "map" hit "gap" and "inline" hit "line".
   */
  const typoShaped = target[0] === lowerQuery[0]
    && (Math.abs(target.length - lowerQuery.length) <= 1 || lowerQuery.startsWith(target));

  if (lowerQuery.length >= 3 && typoShaped) {
    const maxDist = Math.floor(lowerQuery.length / 3);
    const dist = levenshteinDistance(target, lowerQuery);

    if (dist <= maxDist) {
      return 15;
    }
  }

  return 0;
};

/**
 * Scores how well an item matches a search query.
 * Returns the best score across title, englishTitle, and searchTerms.
 * @param item - item to score
 * @param query - search query (case-insensitive)
 * @returns score from 0 (no match) to 100 (exact match). Empty query returns 100.
 */
export const scoreSearchMatch = (item: SearchableItem, query: string): number => {
  if (query === '') {
    return 100;
  }

  const lowerQuery = query.toLowerCase();
  const candidates: string[] = [];

  if (item.title !== undefined) {
    candidates.push(item.title.toLowerCase());
  }
  if (item.englishTitle !== undefined) {
    candidates.push(item.englishTitle.toLowerCase());
  }
  if (item.searchTerms !== undefined) {
    for (const term of item.searchTerms) {
      candidates.push(term.toLowerCase());
    }
  }

  const best = candidates.reduce((max, candidate) => {
    const score = scoreString(candidate, lowerQuery);

    return score > max ? score : max;
  }, 0);

  return best;
};

/**
 * The best score of the title alone. Breaks a tie in scoreSearchMatch: a
 * title match ranks above an alias match ("/list": List view over
 * Bulleted list, whose alias is "list").
 * @param item - item to score
 * @param query - search query (case-insensitive)
 */
export const scoreTitleMatch = (item: SearchableItem, query: string): number => {
  const lowerQuery = query.toLowerCase();

  return Math.max(0, ...[item.title, item.englishTitle]
    .filter((title): title is string => title !== undefined)
    .map((title) => scoreString(title.toLowerCase(), lowerQuery)));
};

/**
 * Checks if an item matches a search query.
 * Uses fuzzy matching: exact, prefix, substring, subsequence, and typo-tolerant (Levenshtein).
 * Matches against: displayed title, English title, and search term aliases.
 * @param item - item to check
 * @param query - search query (case-insensitive)
 * @returns true if the item matches the query
 */
export const matchesSearchQuery = (item: SearchableItem, query: string): boolean => {
  return scoreSearchMatch(item, query) > 0;
};

/**
 * Event that can be triggered by the Search Input
 */
export enum SearchInputEvent {
  /**
   * When search query is applied
   */
  Search = 'search'
}

/**
 * Events fired by the Search Input
 */
export interface SearchInputEventMap {
  /**
   * Fired when search query is applied
   */
  [SearchInputEvent.Search]: { query: string; items: SearchableItem[]};
}
