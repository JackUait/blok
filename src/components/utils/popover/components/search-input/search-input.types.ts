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
