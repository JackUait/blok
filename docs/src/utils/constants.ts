import type { NavLink } from '@/types/navigation';

// Unified navigation links used across all pages
// Active state is determined by current path, not by this config
export const NAV_LINKS: NavLink[] = [
  { href: '/docs', label: 'Docs' },
  { href: '/recipes', label: 'Recipes' },
  { href: '/demo', label: 'Try it out' },
  { href: '/migration', label: 'Migration' },
  { href: '/changelog', label: 'Changelog' },
  { href: 'https://github.com/JackUait/blok', label: 'GitHub', external: true },
];
