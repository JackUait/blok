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

export type SearchCategory = 'guide' | 'core' | 'api' | 'data' | 'page' | 'recipe';

export const SEARCH_CATEGORIES: Record<SearchCategory, string> = {
  guide: 'Guide',
  core: 'Core',
  api: 'API',
  data: 'Data',
  page: 'Page',
  recipe: 'Recipe',
} as const;
