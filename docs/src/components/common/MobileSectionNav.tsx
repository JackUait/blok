import { useState, useRef, useEffect } from 'react';
import { useI18n } from '../../contexts/I18nContext';
import { cn } from '@/lib/utils';
import type { SidebarSection } from '../common/Sidebar';

interface MobileSectionNavProps {
  sections: SidebarSection[];
  activeSection: string;
}

export const MobileSectionNav: React.FC<MobileSectionNavProps> = ({
  sections,
  activeSection,
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

  const handleLinkClick = (sectionId: string): void => {
    setIsOpen(false);
    const element = document.getElementById(sectionId);
    if (element) {
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
          "flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left shadow-sm transition-all hover:shadow-card-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
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
                return (
                  <button
                    key={link.id}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-secondary",
                      isActive
                        ? "active bg-secondary text-foreground"
                        : "text-muted-foreground",
                    )}
                    onClick={() => handleLinkClick(link.id)}
                    role="option"
                    aria-selected={isActive}
                    type="button"
                    data-blok-testid={`mobile-section-nav-item-${link.id}`}
                  >
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        isActive ? "bg-primary" : "bg-border",
                      )}
                    />
                    {link.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
