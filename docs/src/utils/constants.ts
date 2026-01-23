import type { NavLink } from '@/types/navigation';

// Unified navigation links used across all pages
// Active state is determined by current path, not by this config
export const NAV_LINKS: NavLink[] = [
  { href: '/docs', label: 'Docs' },
  { href: '/demo', label: 'Demo' },
  { href: '/migration', label: 'Migration' },
  { href: 'https://github.com/JackUait/blok', label: 'GitHub', external: true },
];
