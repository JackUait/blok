import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { KeyIcon } from './KeyIcon';
import { useI18n } from '../../contexts/I18nContext';
import { cn } from '@/lib/utils';

export interface SidebarLink {
  id: string;
  label: string;
}

export interface SidebarSection {
  title: string;
  links: SidebarLink[];
}

export type SidebarVariant = 'api' | 'tools';

interface SidebarProps {
  sections: SidebarSection[];
  activeSection: string;
  variant: SidebarVariant;
  filterLabel?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sections,
  activeSection,
  variant,
  filterLabel = 'Filter sections',
}) => {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const previousActiveSectionRef = useRef<string | null>(null);

  // Filter sections and links based on search query
  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) {
      return sections;
    }

    const query = searchQuery.toLowerCase();
    return sections
      .map((section) => ({
        ...section,
        links: section.links.filter(
          (link) =>
            link.label.toLowerCase().includes(query) ||
            link.id.toLowerCase().includes(query)
        ),
      }))
      .filter((section) => section.links.length > 0);
  }, [searchQuery, sections]);

  // Scroll active link into view when activeSection changes (with 2-item buffer)
  const scrollActiveIntoView = useCallback(() => {
    if (!navRef.current || !sidebarRef.current || !activeSection) return;

    // Skip scrolling on first render (when previous section is null)
    if (previousActiveSectionRef.current === null) {
      previousActiveSectionRef.current = activeSection;
      return;
    }

    // Skip scrolling if the active section hasn't actually changed
    if (previousActiveSectionRef.current === activeSection) {
      return;
    }

    previousActiveSectionRef.current = activeSection;

    const sidebar = sidebarRef.current;
    const allLinks = Array.from(
      navRef.current.querySelectorAll(`[data-blok-testid^="${variant}-sidebar-link-"]`)
    );
    const activeIndex = allLinks.findIndex(
      (link) =>
        link.getAttribute('data-blok-testid') === `${variant}-sidebar-link-${activeSection}`
    );

    if (activeIndex === -1) return;

    const activeLink = allLinks[activeIndex] as HTMLElement;
    const bufferSize = 2;

    // Account for the sticky search input height
    const searchHeight = searchRef.current?.offsetHeight ?? 0;

    // Calculate positions relative to the sidebar's scroll container
    const sidebarRect = sidebar.getBoundingClientRect();
    const activeLinkRect = activeLink.getBoundingClientRect();

    // Position of active link relative to the sidebar's visible area (below search)
    const linkTopInSidebar = activeLinkRect.top - sidebarRect.top - searchHeight;
    const linkBottomInSidebar = activeLinkRect.bottom - sidebarRect.top;
    const sidebarVisibleHeight = sidebar.clientHeight;

    // Buffer zone: roughly 2 items worth of space (each link ~32px)
    const bufferPixels = 80;

    // Check if active link is near top edge (accounting for sticky search)
    if (linkTopInSidebar < bufferPixels) {
      // Scroll up to show buffer items above
      const bufferTopIndex = Math.max(0, activeIndex - bufferSize);
      const bufferLink = allLinks[bufferTopIndex] as HTMLElement;
      const bufferLinkRect = bufferLink.getBoundingClientRect();
      const scrollOffset =
        bufferLinkRect.top - sidebarRect.top + sidebar.scrollTop - searchHeight - 20;
      sidebar.scrollTo({ top: Math.max(0, scrollOffset), behavior: 'auto' });
      return;
    }

    // Check if active link is near bottom edge
    if (linkBottomInSidebar > sidebarVisibleHeight - bufferPixels) {
      // Scroll down to show buffer items below
      const bufferBottomIndex = Math.min(allLinks.length - 1, activeIndex + bufferSize);
      const bufferLink = allLinks[bufferBottomIndex] as HTMLElement;
      const bufferLinkRect = bufferLink.getBoundingClientRect();
      const scrollOffset =
        bufferLinkRect.bottom - sidebarRect.top + sidebar.scrollTop - sidebarVisibleHeight + 20;
      sidebar.scrollTo({ top: scrollOffset, behavior: 'auto' });
    }
  }, [activeSection, variant]);

  useEffect(() => {
    scrollActiveIntoView();
  }, [scrollActiveIntoView]);

  // Handle keyboard shortcut to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // "/" to focus search when not in an input
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleClear = () => {
    setSearchQuery('');
    inputRef.current?.focus();
  };

  return (
    <aside
      ref={sidebarRef}
      className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2"
      data-blok-testid={`${variant}-sidebar`}
    >
      <div
        ref={searchRef}
        className="sticky top-0 z-10 -mx-1 mb-3 bg-background/85 px-1 pb-3 pt-1 backdrop-blur-sm"
        data-blok-testid={`${variant}-sidebar-search`}
      >
        <div className="flex items-center gap-2 rounded-xl border border-input bg-card px-3 py-2 shadow-sm transition-colors focus-within:border-foreground/30">
          <svg
            className="size-4 shrink-0 text-muted-foreground"
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M9 17A8 8 0 1 0 9 1a8 8 0 0 0 0 16zM19 19l-4.35-4.35"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            placeholder={t('common.filter')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label={filterLabel}
            data-blok-testid={`${variant}-sidebar-search-input`}
          />
          {searchQuery ? (
            <button
              type="button"
              className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              onClick={handleClear}
              aria-label={t('common.clearSearch')}
              data-blok-testid={`${variant}-sidebar-search-clear`}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M12 4L4 12M4 4l8 8"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          ) : (
            <KeyIcon
              className="shrink-0 text-muted-foreground"
              title={t('common.pressSlashToSearch')}
              data-blok-testid={`${variant}-sidebar-search-shortcut`}
            >
              /
            </KeyIcon>
          )}
        </div>
      </div>
      <nav
        ref={navRef}
        className="flex flex-col gap-6"
        data-blok-testid={`${variant}-sidebar-nav`}
      >
        {filteredSections.length === 0 ? (
          <div
            className="px-3 py-6 text-sm text-muted-foreground"
            data-blok-testid={`${variant}-sidebar-empty`}
          >
            <p>{t('common.noResults')}</p>
          </div>
        ) : (
          filteredSections.map((section) => (
            <div
              key={section.title}
              className="flex flex-col gap-1"
              data-blok-testid={`${variant}-sidebar-section`}
            >
              <h4 className="mb-1 px-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {section.title}
              </h4>
              {section.links.map((link) => (
                <a
                  key={link.id}
                  href={`#${link.id}`}
                  className={cn(
                    'block rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
                    activeSection === link.id &&
                      'active bg-secondary font-semibold text-foreground'
                  )}
                  data-blok-testid={`${variant}-sidebar-link-${link.id}`}
                >
                  {link.label}
                </a>
              ))}
            </div>
          ))
        )}
      </nav>
    </aside>
  );
};
