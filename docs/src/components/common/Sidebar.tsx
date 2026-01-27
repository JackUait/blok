import { useState, useMemo, useRef, useEffect, useCallback } from 'react';

export interface SidebarLink {
  id: string;
  label: string;
}

export interface SidebarSection {
  title: string;
  links: SidebarLink[];
}

export type SidebarVariant = 'api' | 'recipes';

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
      className={`${variant}-sidebar`}
      data-blok-testid={`${variant}-sidebar`}
    >
      <div
        ref={searchRef}
        className={`${variant}-sidebar-search`}
        data-blok-testid={`${variant}-sidebar-search`}
      >
        <div className={`${variant}-sidebar-search-field`}>
          <svg
            className={`${variant}-sidebar-search-icon`}
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
            className={`${variant}-sidebar-search-input`}
            placeholder="Filter..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label={filterLabel}
            data-blok-testid={`${variant}-sidebar-search-input`}
          />
          {searchQuery ? (
            <button
              type="button"
              className={`${variant}-sidebar-search-clear`}
              onClick={handleClear}
              aria-label="Clear search"
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
            <kbd
              className={`${variant}-sidebar-search-shortcut`}
              title="Press / to focus search"
              data-blok-testid={`${variant}-sidebar-search-shortcut`}
            >
              /
            </kbd>
          )}
        </div>
      </div>
      <nav
        ref={navRef}
        className={`${variant}-sidebar-nav`}
        data-blok-testid={`${variant}-sidebar-nav`}
      >
        {filteredSections.length === 0 ? (
          <div
            className={`${variant}-sidebar-empty`}
            data-blok-testid={`${variant}-sidebar-empty`}
          >
            <p>No results</p>
          </div>
        ) : (
          filteredSections.map((section) => (
            <div
              key={section.title}
              className={`${variant}-sidebar-section`}
              data-blok-testid={`${variant}-sidebar-section`}
            >
              <h4 className={`${variant}-sidebar-title`}>{section.title}</h4>
              {section.links.map((link) => (
                <a
                  key={link.id}
                  href={`#${link.id}`}
                  className={`${variant}-sidebar-link ${activeSection === link.id ? 'active' : ''}`}
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
