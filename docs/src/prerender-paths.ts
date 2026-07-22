import { MODULE_ORDER } from './components/api/api-nav';
import { TOOL_SECTIONS } from './components/tools/tools-data';

/** Routes that exist independently of the docs content data. */
export const STATIC_PATHS: string[] = [
  '/',
  '/demo',
  '/docs',
  '/tools',
  '/migration',
  '/migration/reference',
  '/changelog',
  '/404',
];

/**
 * Every URL the build must emit as a real HTML file, derived from the same data
 * the sidebar renders from. A hand-written list would silently stop covering
 * modules and tools as they are added, and an uncovered path is a 404 on GitHub
 * Pages. `tools-data.ts` carries a duplicate id, hence the Set.
 */
export const PRERENDER_PATHS: string[] = [
  ...STATIC_PATHS,
  ...[...new Set([...MODULE_ORDER, ...TOOL_SECTIONS.map((tool) => tool.id)])].map(
    (id) => `/docs/${id}`,
  ),
];
