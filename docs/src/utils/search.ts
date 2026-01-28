import type { SearchIndexItem, SearchResult } from '@/types/search';
import { API_SECTIONS, SIDEBAR_SECTIONS } from '@/components/api/api-data';

// Map section IDs to their module (sidebar section) titles
const SECTION_TO_MODULE: Record<string, string> = {};

for (const section of SIDEBAR_SECTIONS) {
  for (const link of section.links) {
    SECTION_TO_MODULE[link.id] = section.title;
  }
}

// Common aliases for better search matching
const ALIASES: Record<string, string[]> = {
  config: ['configuration', 'settings', 'options', 'setup'],
  api: ['method', 'function', 'interface'],
  block: ['blocks', 'element', 'content'],
  tool: ['tools', 'plugin', 'extension'],
  event: ['events', 'callback', 'listener', 'handler'],
  save: ['export', 'output', 'data'],
  render: ['display', 'show', 'create'],
  delete: ['remove', 'destroy', 'clear'],
  insert: ['add', 'create', 'new'],
  move: ['reorder', 'drag', 'position'],
};

// Split camelCase and snake_case into words
const splitIdentifier = (text: string): string[] => {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase
    .replace(/[_-]/g, ' ') // snake_case and kebab-case
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
};

const createKeywords = (...parts: (string | undefined)[]): string[] => {
  const keywords: string[] = [];
  
  for (const part of parts) {
    if (!part) continue;
    
    // Add the original words
    const words = part.toLowerCase().split(/\s+/);
    keywords.push(...words);
    
    // Add split identifiers (for camelCase method names)
    for (const word of words) {
      keywords.push(...splitIdentifier(word));
    }
    
    // Add aliases
    for (const word of words) {
      const wordLower = word.toLowerCase();
      for (const [key, aliases] of Object.entries(ALIASES)) {
        if (wordLower.includes(key) || aliases.some(a => wordLower.includes(a))) {
          keywords.push(key, ...aliases);
        }
      }
    }
  }
  
  // Remove duplicates
  return [...new Set(keywords)];
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

  const module = SECTION_TO_MODULE[section.id] ?? section.badge ?? 'API';

  for (const method of section.methods) {
    const methodName = method.name.replace('()', '');
    index.push({
      id: `${section.id}-${methodName}`,
      title: method.name,
      description: method.description,
      category: section.badge ?? 'api',
      module,
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

  const module = SECTION_TO_MODULE[section.id] ?? section.badge ?? 'API';

  for (const prop of section.properties) {
    index.push({
      id: `${section.id}-${prop.name}`,
      title: prop.name,
      description: prop.description,
      category: section.badge ?? 'api',
      module,
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

  const module = SECTION_TO_MODULE[section.id] ?? section.badge ?? 'API';

  for (const row of section.table) {
    index.push({
      id: `${section.id}-${row.option}`,
      title: row.option,
      description: row.description,
      category: section.badge ?? 'api',
      module,
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

// Recipe data extracted from RecipesPage.tsx and recipe components
const RECIPES: Array<{
  id: string;
  title: string;
  description: string;
  keywords: string[];
}> = [
  {
    id: 'recipe-keyboard-shortcuts',
    title: 'Keyboard Shortcuts',
    description: 'All keyboard shortcuts for Blok editor',
    keywords: [
      'shortcut', 'keyboard', 'hotkey', 'slash', 'toolbox',
      'bold', 'italic', 'underline', 'link', 'undo', 'redo',
      'enter', 'backspace', 'tab', 'indent', 'outdent', 'list',
    ],
  },
  {
    id: 'recipe-autosave',
    title: 'Autosave with Debouncing',
    description: 'Automatically save content as users type, with debouncing to prevent excessive server requests.',
    keywords: ['autosave', 'save', 'debounce', 'onchange', 'server', 'request'],
  },
  {
    id: 'recipe-events',
    title: 'Working with Events',
    description: 'Listen to editor events to integrate with your application\'s state management or analytics.',
    keywords: ['event', 'onready', 'onchange', 'listener', 'callback', 'analytics'],
  },
  {
    id: 'recipe-custom-tool',
    title: 'Creating a Custom Tool',
    description: 'Build your own block type to extend Blok\'s functionality. This example creates a simple alert/callout block.',
    keywords: ['custom', 'tool', 'plugin', 'extension', 'block', 'create', 'alert', 'callout'],
  },
  {
    id: 'recipe-styling',
    title: 'Styling with Data Attributes',
    description: 'Customize Blok\'s appearance using CSS and data attributes. No need to fight with specificity.',
    keywords: ['style', 'css', 'styling', 'theme', 'custom', 'appearance', 'data', 'attribute'],
  },
  {
    id: 'recipe-readonly',
    title: 'Read-Only Mode',
    description: 'Display saved content without editing capabilities, or toggle between edit and preview modes.',
    keywords: ['readonly', 'read-only', 'preview', 'toggle', 'edit', 'mode'],
  },
  {
    id: 'recipe-locale',
    title: 'Localization with Preloading',
    description: 'Configure Blok for multiple languages with optional preloading for offline support or instant initialization.',
    keywords: ['locale', 'i18n', 'localization', 'language', 'translation', 'preload', 'offline'],
  },
];

// Build search index from API documentation
export const buildSearchIndex = (): SearchIndexItem[] => {
  const index: SearchIndexItem[] = [];

  // Index API sections
  for (const section of API_SECTIONS) {
    const module = SECTION_TO_MODULE[section.id] ?? section.badge ?? 'API';

    // Add the section itself
    index.push({
      id: section.id,
      title: section.title,
      description: section.description,
      category: section.badge ?? 'api',
      module,
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

  // Add page-level entries (pages don't belong to a specific module)
  index.push(
    {
      id: 'home',
      title: 'Home',
      description: 'Welcome to Blok documentation',
      category: 'page',
      module: 'Page',
      path: '/',
      keywords: ['home', 'welcome', 'blok', 'editor', 'start', 'getting started'],
    },
    {
      id: 'docs',
      title: 'Documentation',
      description: 'API documentation and guides',
      category: 'page',
      module: 'Page',
      path: '/docs',
      keywords: ['docs', 'documentation', 'api', 'reference', 'guide', 'manual'],
    },
    {
      id: 'demo',
      title: 'Demo',
      description: 'Try the Blok editor',
      category: 'page',
      module: 'Page',
      path: '/demo',
      keywords: ['demo', 'try', 'editor', 'example', 'playground', 'test', 'live'],
    },
    {
      id: 'migration',
      title: 'Migration Guide',
      description: 'Migrate from other editors',
      category: 'page',
      module: 'Page',
      path: '/migration',
      keywords: ['migration', 'migrate', 'convert', 'upgrade', 'editorjs', 'switch', 'transition'],
    }
  );

  // Index recipes
  for (const recipe of RECIPES) {
    index.push({
      id: recipe.id,
      title: recipe.title,
      description: recipe.description,
      category: 'recipe',
      module: 'Recipes',
      path: '/recipes',
      keywords: createKeywords(recipe.title, recipe.description, ...recipe.keywords),
    });
  }

  return index;
};

// Calculate Levenshtein distance for typo tolerance
const levenshteinDistance = (a: string, b: string): number => {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Only calculate for short strings (performance)
  if (a.length > 15 || b.length > 15) return Math.abs(a.length - b.length);

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
};

// Score a single word match against text
const wordScore = (queryWord: string, text: string): number => {
  const queryLower = queryWord.toLowerCase();
  const textLower = text.toLowerCase();
  const textWords = textLower.split(/[\s\-_]+/);

  // Exact word match
  if (textWords.includes(queryLower)) return 100;

  // Text starts with query word
  if (textLower.startsWith(queryLower)) return 90;

  // Any word starts with query
  if (textWords.some(w => w.startsWith(queryLower))) return 80;

  // Text contains query as substring
  if (textLower.includes(queryLower)) return 60;

  // Typo tolerance (within 1-2 edit distance for words 4+ chars)
  if (queryLower.length >= 4) {
    for (const word of textWords) {
      const distance = levenshteinDistance(queryLower, word);
      if (distance === 1) return 50;
      if (distance === 2 && queryLower.length >= 6) return 30;
    }
  }

  // Check aliases
  for (const [key, aliases] of Object.entries(ALIASES)) {
    if (queryLower === key || aliases.includes(queryLower)) {
      if (textLower.includes(key) || aliases.some(a => textLower.includes(a))) {
        return 40;
      }
    }
  }

  return 0;
};

// Score multi-word query against text (all words should match)
const multiWordScore = (query: string, text: string): number => {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  
  if (queryWords.length === 0) return 0;
  if (queryWords.length === 1) return wordScore(queryWords[0], text);

  // For multi-word queries, calculate score for each word
  const wordScores = queryWords.map(word => wordScore(word, text));
  
  // All words must have some match
  if (wordScores.some(score => score === 0)) {
    // If not all words match, reduce score significantly
    const matchingWords = wordScores.filter(s => s > 0).length;
    if (matchingWords === 0) return 0;
    return (matchingWords / queryWords.length) * 20;
  }

  // Average score with bonus for having all words match
  const avgScore = wordScores.reduce((a, b) => a + b, 0) / wordScores.length;
  return avgScore * 1.2; // 20% bonus for full match
};

// Search the index
export const search = (query: string, index: SearchIndexItem[]): SearchResult[] => {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  const results: SearchResult[] = [];

  for (const item of index) {
    // Calculate score based on title, description, and keywords
    const titleScore = multiWordScore(trimmedQuery, item.title) * 1.5; // Title weighs more
    const descScore = item.description
      ? multiWordScore(trimmedQuery, item.description) * 0.8
      : 0;

    // Check keywords with direct word matching
    let keywordScore = 0;
    const queryWords = trimmedQuery.toLowerCase().split(/\s+/);
    for (const kw of item.keywords) {
      for (const qw of queryWords) {
        if (kw === qw) {
          keywordScore = Math.max(keywordScore, 70);
        } else if (kw.startsWith(qw)) {
          keywordScore = Math.max(keywordScore, 50);
        } else if (kw.includes(qw)) {
          keywordScore = Math.max(keywordScore, 30);
        }
      }
    }

    const totalScore = titleScore + descScore + keywordScore;

    if (totalScore > 0) {
      results.push({
        id: item.id,
        title: item.title,
        description: item.description,
        category: item.category,
        module: item.module,
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
