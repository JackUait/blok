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
 * Checks if an item matches a search query.
 * Matches against: displayed title, English title, and search term aliases.
 * @param item - item to check
 * @param query - search query (case-insensitive)
 * @returns true if the item matches the query
 */
export const matchesSearchQuery = (item: SearchableItem, query: string): boolean => {
  const lowerQuery = query.toLowerCase();
  const title = item.title?.toLowerCase() ?? '';
  const englishTitle = item.englishTitle?.toLowerCase() ?? '';
  const searchTerms = item.searchTerms ?? [];

  return (
    title.includes(lowerQuery) ||
    englishTitle.includes(lowerQuery) ||
    searchTerms.some(term => term.toLowerCase().includes(lowerQuery))
  );
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
