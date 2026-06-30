import { useRef, useEffect, useLayoutEffect, useState, useCallback, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

export interface SidebarLink {
  id: string;
  label: string;
}

export interface SidebarSection {
  title: string;
  links: SidebarLink[];
  /** Optional leading icon shown beside the group title. */
  icon?: ReactNode;
}

export type SidebarVariant = 'api' | 'tools';

interface SidebarProps {
  sections: SidebarSection[];
  activeSection: string;
  variant: SidebarVariant;
  linkMode?: 'anchor' | 'route';
  buildHref?: (id: string) => string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sections,
  activeSection,
  variant,
  linkMode = 'anchor',
  buildHref,
}) => {
  const asideRef = useRef<HTMLElement>(null);

  // Fade the scroll container's content toward the page background at whichever
  // edge has more menu off-screen — a small "haze" that signals scrollability.
  const [scrollEdges, setScrollEdges] = useState({ top: false, bottom: false });

  const updateScrollEdges = useCallback(() => {
    const el = asideRef.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setScrollEdges((prev) =>
      prev.top === top && prev.bottom === bottom ? prev : { top, bottom },
    );
  }, []);

  // Collapsible groups. Collapsed by default, except the group that holds the
  // current page so the user's location stays visible.
  const activeTitle = sections.find((s) => s.links.some((l) => l.id === activeSection))?.title;
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(activeTitle ? [activeTitle] : []),
  );

  // Landing on a module (via nav, search, or prev/next) opens its group; groups
  // the user already opened stay open.
  useEffect(() => {
    if (!activeTitle) return;
    setOpenGroups((prev) => (prev.has(activeTitle) ? prev : new Set(prev).add(activeTitle)));
  }, [activeTitle]);

  const toggleGroup = useCallback((title: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }, []);

  // Keep the scroll haze in sync after layout and on group open/close (which
  // shifts content height) and on resize.
  useLayoutEffect(() => {
    updateScrollEdges();
  }, [updateScrollEdges, sections, openGroups]);

  useEffect(() => {
    window.addEventListener('resize', updateScrollEdges);
    return () => window.removeEventListener('resize', updateScrollEdges);
  }, [updateScrollEdges]);

  const fade = '1.75rem';
  const hazeMask = `linear-gradient(to bottom, ${
    scrollEdges.top ? 'transparent' : '#000'
  } 0, #000 ${fade}, #000 calc(100% - ${fade}), ${
    scrollEdges.bottom ? 'transparent' : '#000'
  } 100%)`;

  const linkClass = (id: string) =>
    cn(
      'block rounded-lg py-1.5 pl-4 pr-3 text-sm text-muted-foreground transition-[color,background-color] duration-200 ease-out',
      'hover:text-foreground focus-visible:text-foreground',
      // Inset ring so it isn't clipped by the scroll container's left edge.
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60',
      activeSection === id
        ? 'active font-semibold text-foreground bg-primary/[0.07] dark:bg-primary/15'
        : 'hover:bg-secondary/70',
    );

  return (
    <aside
      ref={asideRef}
      onScroll={updateScrollEdges}
      className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2"
      style={{ maskImage: hazeMask, WebkitMaskImage: hazeMask }}
      data-blok-testid={`${variant}-sidebar`}
    >
      <nav
        className="flex flex-col gap-7"
        aria-label="Documentation sections"
        data-blok-testid={`${variant}-sidebar-nav`}
      >
        {sections.map((section, idx) => {
          const isOpen = openGroups.has(section.title);
          const regionId = `${variant}-sidebar-group-${idx}`;
          return (
            <div
              key={section.title}
              className="flex flex-col gap-0.5"
              data-blok-testid={`${variant}-sidebar-section`}
            >
              <button
                type="button"
                onClick={() => toggleGroup(section.title)}
                aria-expanded={isOpen}
                aria-controls={regionId}
                className="mb-2 flex w-full items-center justify-between gap-2 rounded-md py-1 pl-4 pr-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60 transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
                data-blok-testid={`${variant}-sidebar-section-toggle-${idx}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {section.icon && (
                    <span className="shrink-0 text-muted-foreground" aria-hidden="true">
                      {section.icon}
                    </span>
                  )}
                  <span className="truncate">{section.title}</span>
                </span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                  className={cn(
                    'shrink-0 transition-transform duration-200 ease-out',
                    isOpen ? 'rotate-0' : '-rotate-90',
                  )}
                >
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <div
                id={regionId}
                hidden={!isOpen}
                className="flex flex-col gap-0.5"
              >
                {section.links.map((link) =>
                  linkMode === 'route' && buildHref ? (
                    <Link
                      key={link.id}
                      to={buildHref(link.id)}
                      className={linkClass(link.id)}
                      aria-current={activeSection === link.id ? 'page' : undefined}
                      data-blok-testid={`${variant}-sidebar-link-${link.id}`}
                    >
                      {link.label}
                    </Link>
                  ) : (
                    <a
                      key={link.id}
                      href={`#${link.id}`}
                      className={linkClass(link.id)}
                      aria-current={activeSection === link.id ? 'page' : undefined}
                      data-blok-testid={`${variant}-sidebar-link-${link.id}`}
                    >
                      {link.label}
                    </a>
                  )
                )}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
};
