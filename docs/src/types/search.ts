/** What a search result actually is, so the user can tell entries apart at a glance. */
export type SearchResultKind =
  | 'method'
  | 'property'
  | 'option'
  | 'section'
  | 'page';

export interface SearchResult {
  id: string;
  title: string;
  description?: string;
  category: string;
  module: string;
  /** Human-readable kind label key (method, option, …) shown on each result. */
  kind: SearchResultKind;
  /** Parent section a method/option/property lives in, e.g. "Blocks API". */
  section?: string;
  path: string;
  hash?: string;
  rank: number;
}

export interface SearchIndexItem {
  id: string;
  title: string;
  description?: string;
  category: string;
  module: string;
  kind: SearchResultKind;
  section?: string;
  path: string;
  hash?: string;
  keywords: string[];
}
