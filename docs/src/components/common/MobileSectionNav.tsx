import { useState, useRef, useEffect } from 'react';
import { Link } from './Link';
import { useI18n } from '../../contexts/I18nContext';
import { cn } from '@/lib/utils';
import { trackEvent, ANALYTICS_EVENTS } from '@/lib/analytics';
import type { SidebarSection } from '../common/Sidebar';

interface MobileSectionNavProps {
  sections: SidebarSection[];
  activeSection: string;
  /**
   * Maps a section id to the route that serves it. When given, items render as
   * router links; otherwise they are in-page anchors that scroll to the id.
   * Either way they are real `<a href>`, which is the only form a crawler
   * follows — below `lg` this dropdown is the sole docs navigation on screen.
   */
  buildHref?: (id: string) => string;
}

export const MobileSectionNav: React.FC<MobileSectionNavProps> = ({
  sections,
  activeSection,
  buildHref,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useI18n();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Find current section label
  const currentLabel = sections
    .flatMap((s) => s.links)
    .find((link) => link.id === activeSection)?.label ?? t('common.selectSection');
    
  // Find current section title
  const currentSectionTitle = sections.find((s) =>
    s.links.some((link) => link.id === activeSection)
  )?.title;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close dropdown on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  const handleLinkClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
    sectionId: string,
  ): void => {
    setIsOpen(false);
    // Jumping sections only changes the hash, which page-view tracking ignores.
    trackEvent(ANALYTICS_EVENTS.docsSectionJump, {
      section_id: sectionId,
      surface: 'mobile_nav',
    });
    if (buildHref) return;
    // Anchor mode: the browser's own hash jump is instant, so take it over and
    // scroll smoothly instead — the href stays as the crawlable address.
    const element = document.getElementById(sectionId);
    if (element) {
      event.preventDefault();
      window.history.pushState(null, '', `#${sectionId}`);
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative"
      data-blok-testid="mobile-section-nav"
    >
      <button
        className={cn(
          "flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left shadow-sm transition-all hover:shadow-card-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          isOpen && "open border-foreground/20 shadow-card-hover",
        )}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        type="button"
        data-blok-testid="mobile-section-nav-trigger"
      >
        <div className="flex min-w-0 flex-col">
          {currentSectionTitle && (
            <span className="text-xs font-bold uppercase tracking-wide text-primary">
              {currentSectionTitle}
            </span>
          )}
          <span className="truncate text-sm font-semibold text-foreground">
            {currentLabel}
          </span>
        </div>
        <svg
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180",
          )}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 max-h-[60vh] overflow-y-auto rounded-2xl border border-border bg-popover p-2 shadow-card"
          role="listbox"
          data-blok-testid="mobile-section-nav-dropdown"
        >
          {sections.map((section) => (
            <div key={section.title} className="px-1 py-1.5">
              <div className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {section.title}
              </div>
              {section.links.map((link) => {
                const isActive = activeSection === link.id;
                const itemClass = cn(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-secondary",
                  isActive ? "active bg-secondary text-foreground" : "text-muted-foreground",
                );
                const itemContent = (
                  <>
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        isActive ? "bg-primary" : "bg-border",
                      )}
                    />
                    {link.label}
                  </>
                );
                const itemProps = {
                  className: itemClass,
                  onClick: (event: React.MouseEvent<HTMLAnchorElement>) =>
                    handleLinkClick(event, link.id),
                  role: 'option',
                  'aria-selected': isActive,
                  'data-blok-testid': `mobile-section-nav-item-${link.id}`,
                };
                return buildHref ? (
                  <Link key={link.id} to={buildHref(link.id)} {...itemProps}>
                    {itemContent}
                  </Link>
                ) : (
                  <a key={link.id} href={`#${link.id}`} {...itemProps}>
                    {itemContent}
                  </a>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
