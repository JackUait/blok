import { useState, useRef, useEffect } from 'react';
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
  const dropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Find current section label
  const currentLabel = sections
    .flatMap((s) => s.links)
    .find((link) => link.id === activeSection)?.label ?? 'Select section';
    
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
      className="mobile-section-nav"
      data-blok-testid="mobile-section-nav"
    >
      <button
        className={`mobile-section-nav-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        type="button"
        data-blok-testid="mobile-section-nav-trigger"
      >
        <div className="mobile-section-nav-trigger-content">
          {currentSectionTitle && (
            <span className="mobile-section-nav-category">{currentSectionTitle}</span>
          )}
          <span className="mobile-section-nav-label">{currentLabel}</span>
        </div>
        <svg 
          className="mobile-section-nav-chevron"
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
          className="mobile-section-nav-dropdown"
          role="listbox"
          data-blok-testid="mobile-section-nav-dropdown"
        >
          {sections.map((section) => (
            <div key={section.title} className="mobile-section-nav-group">
              <div className="mobile-section-nav-group-title">{section.title}</div>
              {section.links.map((link) => (
                <button
                  key={link.id}
                  className={`mobile-section-nav-item ${activeSection === link.id ? 'active' : ''}`}
                  onClick={() => handleLinkClick(link.id)}
                  role="option"
                  aria-selected={activeSection === link.id}
                  type="button"
                  data-blok-testid={`mobile-section-nav-item-${link.id}`}
                >
                  <span className="mobile-section-nav-item-dot" />
                  {link.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
