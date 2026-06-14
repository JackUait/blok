export interface SearchResult {
  id: string;
  title: string;
  description?: string;
  category: string;
  module: string;
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
  path: string;
  hash?: string;
  keywords: string[];
}
