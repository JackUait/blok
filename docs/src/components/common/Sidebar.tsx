import { useRef, useEffect, useCallback } from 'react';
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
      'block rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
      activeSection === id && 'active bg-secondary font-semibold text-foreground',
    );

  return (
    <aside
      ref={sidebarRef}
      className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2"
      data-blok-testid={`${variant}-sidebar`}
    >
      <nav
        ref={navRef}
        className="flex flex-col gap-6"
        data-blok-testid={`${variant}-sidebar-nav`}
      >
        {sections.map((section) => (
          <div
            key={section.title}
            className="flex flex-col gap-1"
            data-blok-testid={`${variant}-sidebar-section`}
          >
            <h4 className="mb-1 px-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {section.title}
            </h4>
            {section.links.map((link) =>
              linkMode === 'route' && buildHref ? (
                <Link
                  key={link.id}
                  to={buildHref(link.id)}
                  className={linkClass(link.id)}
                  data-blok-testid={`${variant}-sidebar-link-${link.id}`}
                >
                  {link.label}
                </Link>
              ) : (
                <a
                  key={link.id}
                  href={`#${link.id}`}
                  className={linkClass(link.id)}
                  data-blok-testid={`${variant}-sidebar-link-${link.id}`}
                >
                  {link.label}
                </a>
              )
            )}
          </div>
        ))}
      </nav>
    </aside>
  );
};
