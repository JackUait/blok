import { useEffect, useState, useCallback, useRef } from 'react';
import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { Sidebar } from '../components/common/Sidebar';
import { MobileSectionNav } from '../components/common/MobileSectionNav';
import { ApiSection } from '../components/api/ApiSection';
import { useApiTranslations } from '../hooks/useApiTranslations';
import { useI18n } from '../contexts/I18nContext';
import { NAV_LINKS } from '../utils/constants';
import '../../assets/api.css';

export const ApiPage: React.FC = () => {
  const { locale } = useI18n();
  const { apiSections, sidebarSections, filterLabel } = useApiTranslations();
  
  // Initialize active section from URL hash, defaulting to 'quick-start' (first visible section)
  const [activeSection, setActiveSection] = useState<string>(() => {
    const hash = window.location.hash.slice(1);
    return hash || 'quick-start';
  });
  const scrollTargetRef = useRef<string | null>(null);

  // Handle initial URL hash on page load and hash changes
  const scrollToHash = useCallback(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;

    // Small delay to ensure DOM is fully rendered
    requestAnimationFrame(() => {
      const targetElement = document.getElementById(hash);
      if (targetElement) {
        scrollTargetRef.current = hash;
        setActiveSection(hash);
        targetElement.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    });
  }, []);

  // Handle initial hash on mount
  useEffect(() => {
    scrollToHash();

    // Listen for hash changes (back/forward navigation)
    const handleHashChange = (): void => {
      scrollToHash();
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [scrollToHash]);

  useEffect(() => {
    // Intersection Observer for active section tracking
    const observerOptions = {
      root: null,
      rootMargin: '-100px 0px -100px 0px',
      threshold: 0.1,
    };

    const observer = new IntersectionObserver((entries) => {
      entries.filter((entry) => entry.isIntersecting).forEach((entry) => {
        if (scrollTargetRef.current && entry.target.id === scrollTargetRef.current) {
          scrollTargetRef.current = null;
          return;
        }
        if (scrollTargetRef.current) {
          return;
        }
        setActiveSection(entry.target.id);
      });
    }, observerOptions);

    // Observe all sections
    apiSections.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) {
        observer.observe(element);
      }
    });

    // Handle anchor link clicks - update URL hash and scroll
    const handleAnchorClick = (e: Event) => {
      const target = e.target as HTMLAnchorElement;
      const href = target.getAttribute('href');
      if (!href || !href.startsWith('#')) return;

      const sectionId = href.slice(1);
      const targetElement = document.querySelector(href);
      if (targetElement) {
        e.preventDefault();
        
        // Update URL hash (enables sharing/bookmarking)
        window.history.pushState(null, '', href);
        
        // Track target and update active section immediately
        scrollTargetRef.current = sectionId;
        setActiveSection(sectionId);
        
        targetElement.scrollIntoView({
          behavior: 'auto',
          block: 'start',
        });
      }
    };

    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
      anchor.addEventListener('click', handleAnchorClick);
    });

    return () => {
      observer.disconnect();
      document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
        anchor.removeEventListener('click', handleAnchorClick);
      });
    };
  }, [apiSections]);

  return (
    <>
      <Nav links={NAV_LINKS} />
      <div className="api-docs" data-blok-testid="api-docs">
        <Sidebar
          key={`sidebar-${locale}`}
          sections={sidebarSections}
          activeSection={activeSection}
          variant="api"
          filterLabel={filterLabel}
        />
        <div className="api-content-wrapper">
          <MobileSectionNav
            key={`mobile-nav-${locale}`}
            sections={sidebarSections}
            activeSection={activeSection}
          />
          <main className="api-main" data-blok-testid="api-main">
            {apiSections.map((section) => (
              <ApiSection key={`${locale}-${section.id}`} section={section} />
            ))}
          </main>
        </div>
      </div>
      <Footer />
    </>
  );
};
