import type { NavLink } from '@/types/navigation';

// Unified navigation links used across all pages
// Active state is determined by current path, not by this config
export const NAV_LINKS: NavLink[] = [
  { href: '/docs', label: 'Docs', i18nKey: 'nav.docs' },
  { href: '/demo', label: 'Demo', i18nKey: 'nav.demo' },
  { href: '/migration', label: 'Migration', i18nKey: 'nav.migration' },
  { href: '/changelog', label: 'Changelog', i18nKey: 'nav.changelog' },
];
