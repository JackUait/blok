import type { SearchIndexItem, SearchResult } from '@/types/search';
import { API_SECTIONS } from '@/components/api/api-data';

const createKeywords = (...parts: (string | undefined)[]): string[] => {
  return parts.flatMap((part) =>
    part ? part.toLowerCase().split(/\s+/) : []
  );
};

type ApiSection = {
  id: string;
  badge?: string | null;
  title: string;
  description?: string;
  methods?: Array<{
    name: string;
    description: string;
    returnType: string;
  }>;
  properties?: Array<{
    name: string;
    type?: string;
    description: string;
  }>;
  table?: Array<{
    option: string;
    description: string;
    type?: string;
  }>;
};

const indexMethods = (index: SearchIndexItem[], section: ApiSection): void => {
  if (!section.methods) {
    return;
  }

  for (const method of section.methods) {
    const methodName = method.name.replace('()', '');
    index.push({
      id: `${section.id}-${methodName}`,
      title: method.name,
      description: method.description,
      category: section.badge ?? 'api',
      path: '/docs',
      hash: section.id,
      keywords: createKeywords(
        methodName,
        section.title,
        method.description,
        method.returnType
      ),
    });
  }
};

const indexProperties = (index: SearchIndexItem[], section: ApiSection): void => {
  if (!section.properties) {
    return;
  }

  for (const prop of section.properties) {
    index.push({
      id: `${section.id}-${prop.name}`,
      title: prop.name,
      description: prop.description,
      category: section.badge ?? 'api',
      path: '/docs',
      hash: section.id,
      keywords: createKeywords(
        prop.name,
        section.title,
        prop.type,
        prop.description
      ),
    });
  }
};

const indexTableOptions = (index: SearchIndexItem[], section: ApiSection): void => {
  if (!section.table) {
    return;
  }

  for (const row of section.table) {
    index.push({
      id: `${section.id}-${row.option}`,
      title: row.option,
      description: row.description,
      category: section.badge ?? 'api',
      path: '/docs',
      hash: section.id,
      keywords: createKeywords(
        row.option,
        section.title,
        row.type,
        row.description
      ),
    });
  }
};

// Build search index from API documentation
export const buildSearchIndex = (): SearchIndexItem[] => {
  const index: SearchIndexItem[] = [];

  // Index API sections
  for (const section of API_SECTIONS) {
    // Add the section itself
    index.push({
      id: section.id,
      title: section.title,
      description: section.description,
      category: section.badge ?? 'api',
      path: '/docs',
      hash: section.id,
      keywords: createKeywords(
        section.title,
        section.id,
        section.description
      ),
    });

    // Index subsections
    indexMethods(index, section);
    indexProperties(index, section);
    indexTableOptions(index, section);
  }

  // Add page-level entries
  index.push(
    {
      id: 'home',
      title: 'Home',
      description: 'Welcome to Blok documentation',
      category: 'page',
      path: '/',
      keywords: ['home', 'welcome', 'blok', 'editor'],
    },
    {
      id: 'docs',
      title: 'Documentation',
      description: 'API documentation and guides',
      category: 'page',
      path: '/docs',
      keywords: ['docs', 'documentation', 'api', 'reference'],
    },
    {
      id: 'demo',
      title: 'Demo',
      description: 'Try the Blok editor',
      category: 'page',
      path: '/demo',
      keywords: ['demo', 'try', 'editor', 'example'],
    },
    {
      id: 'migration',
      title: 'Migration Guide',
      description: 'Migrate from other editors',
      category: 'page',
      path: '/migration',
      keywords: ['migration', 'migrate', 'convert', 'upgrade'],
    }
  );

  return index;
};

// Simple fuzzy match scoring
const fuzzyScore = (query: string, text: string): number => {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();

  // Exact match gets highest score
  if (textLower === queryLower) return 100;

  // Starts with query gets high score
  if (textLower.startsWith(queryLower)) return 80;

  // Contains query gets medium score
  if (textLower.includes(queryLower)) return 60;

  // Check for acronym match (e.g., "blocks api" matches "Blocks API")
  const words = queryLower.split(/\s+/);
  const textWords = textLower.split(/\s+/);
  const acronym = textWords.map((w: string): string => w[0]).join('');

  if (acronym.includes(queryLower)) return 50;

  // Check for individual word matches
  const wordMatchCount = words.filter((word: string): boolean =>
    textWords.some((tw: string): boolean => tw.includes(word))
  ).length;

  if (wordMatchCount > 0) {
    return (wordMatchCount / words.length) * 40;
  }

  return 0;
};

// Search the index
export const search = (query: string, index: SearchIndexItem[]): SearchResult[] => {
  if (!query.trim()) {
    return [];
  }

  const results: SearchResult[] = [];

  for (const item of index) {
    // Calculate score based on title and description
    const titleScore = fuzzyScore(query, item.title);
    const descScore = item.description
      ? fuzzyScore(query, item.description) * 0.5
      : 0;
    const keywordScore = Math.max(
      ...item.keywords.map((kw: string): number => fuzzyScore(query, kw) * 0.3)
    );

    const totalScore = titleScore + descScore + keywordScore;

    if (totalScore > 0) {
      results.push({
        id: item.id,
        title: item.title,
        description: item.description,
        category: item.category,
        path: item.path,
        hash: item.hash,
        rank: totalScore,
      });
    }
  }

  // Sort by rank (descending) and return top results
  return results.sort((a, b) => b.rank - a.rank);
};

// Memoized search index
export const getSearchIndex = (): SearchIndexItem[] => {
  const cachedIndex = globalThis.__blokSearchIndex;
  if (cachedIndex) {
    return cachedIndex;
  }

  const newIndex = buildSearchIndex();
  globalThis.__blokSearchIndex = newIndex;
  return newIndex;
};
