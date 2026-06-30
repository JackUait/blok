import { useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
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
  const navRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const previousActiveSectionRef = useRef<string | null>(null);

  // A single coral marker that glides to the active link instead of a static
  // per-item border — measured from layout so it tracks any item across groups.
  const [marker, setMarker] = useState<{ top: number; height: number } | null>(null);

  const measureMarker = useCallback(() => {
    const nav = navRef.current;
    if (!nav || !activeSection) {
      setMarker(null);
      return;
    }
    const active = nav.querySelector<HTMLElement>(
      `[data-blok-testid="${variant}-sidebar-link-${activeSection}"]`,
    );
    if (!active || active.offsetHeight === 0) {
      setMarker(null);
      return;
    }
    setMarker({ top: active.offsetTop, height: active.offsetHeight });
  }, [activeSection, variant]);

  // Position synchronously after layout so the marker never paints out of place.
  useLayoutEffect(() => {
    measureMarker();
  }, [measureMarker, sections]);

  useEffect(() => {
    window.addEventListener('resize', measureMarker);
    return () => window.removeEventListener('resize', measureMarker);
  }, [measureMarker]);

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

    // Calculate positions relative to the sidebar's scroll container
    const sidebarRect = sidebar.getBoundingClientRect();
    const activeLinkRect = activeLink.getBoundingClientRect();

    // Position of active link relative to the sidebar's visible area
    const linkTopInSidebar = activeLinkRect.top - sidebarRect.top;
    const linkBottomInSidebar = activeLinkRect.bottom - sidebarRect.top;
    const sidebarVisibleHeight = sidebar.clientHeight;

    // Buffer zone: roughly 2 items worth of space (each link ~32px)
    const bufferPixels = 80;

    // Check if active link is near top edge
    if (linkTopInSidebar < bufferPixels) {
      // Scroll up to show buffer items above
      const bufferTopIndex = Math.max(0, activeIndex - bufferSize);
      const bufferLink = allLinks[bufferTopIndex] as HTMLElement;
      const bufferLinkRect = bufferLink.getBoundingClientRect();
      const scrollOffset = bufferLinkRect.top - sidebarRect.top + sidebar.scrollTop - 20;
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

  const linkClass = (id: string) =>
    cn(
      'block rounded-md py-1.5 pl-4 pr-3 text-sm text-muted-foreground transition-[color,background-color,transform] duration-200 ease-out',
      'hover:translate-x-0.5 hover:text-foreground focus-visible:translate-x-0.5 focus-visible:text-foreground',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
      activeSection === id
        ? 'active font-semibold text-foreground'
        : 'hover:bg-secondary/60',
    );

  return (
    <aside
      ref={sidebarRef}
      className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2"
      data-blok-testid={`${variant}-sidebar`}
    >
      <nav
        ref={navRef}
        className="relative flex flex-col gap-7"
        aria-label="Documentation sections"
        data-blok-testid={`${variant}-sidebar-nav`}
      >
        {/* Coral locator that glides to the active link, riding the group rails. */}
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute left-0 top-0 w-0.5 rounded-full bg-primary',
            'transition-[transform,height,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
          )}
          style={
            marker
              ? {
                  transform: `translateY(${marker.top + 4}px)`,
                  height: `${Math.max(marker.height - 8, 4)}px`,
                  opacity: 1,
                }
              : { opacity: 0 }
          }
        />

        {sections.map((section) => (
          <div
            key={section.title}
            className="flex flex-col gap-0.5"
            data-blok-testid={`${variant}-sidebar-section`}
          >
            <h4 className="mb-2 pl-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">
              {section.title}
            </h4>
            <div className="flex flex-col gap-0.5 border-l border-border/60">
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
        ))}
      </nav>
    </aside>
  );
};
