// docs/src/pages/ToolsPage.tsx
import { useEffect, useState, useCallback, useRef } from 'react';
import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { Sidebar } from '../components/common/Sidebar';
import { MobileSectionNav } from '../components/common/MobileSectionNav';
import { ToolSection } from '../components/tools/ToolSection';
import { useToolsTranslations } from '../hooks/useToolsTranslations';
import { NAV_LINKS } from '../utils/constants';
import '../../assets/tools.css';

export const ToolsPage: React.FC = () => {
  const { toolSections, sidebarSections, filterLabel } = useToolsTranslations();

  const [activeSection, setActiveSection] = useState<string>(() => {
    const hash = window.location.hash.slice(1);
    return hash || 'paragraph';
  });
  const scrollTargetRef = useRef<string | null>(null);

  const scrollToHash = useCallback(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    requestAnimationFrame(() => {
      const target = document.getElementById(hash);
      if (target) {
        scrollTargetRef.current = hash;
        setActiveSection(hash);
        target.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    });
  }, []);

  useEffect(() => {
    scrollToHash();
    const handleHashChange = () => scrollToHash();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [scrollToHash]);

  useEffect(() => {
    const observerOptions = {
      root: null,
      rootMargin: '-100px 0px -100px 0px',
      threshold: 0.1,
    };

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          if (scrollTargetRef.current) {
            if (id === scrollTargetRef.current) {
              scrollTargetRef.current = null;
              setActiveSection(id);
            }
          } else {
            setActiveSection(id);
          }
        }
      }
    }, observerOptions);

    const sections = document.querySelectorAll('[data-blok-testid^="tools-section-"]');
    sections.forEach((section) => observer.observe(section));

    return () => observer.disconnect();
  }, [toolSections]);

  return (
    <div className="tools-docs" data-blok-testid="tools-docs">
      <Nav links={NAV_LINKS} />
      <div className="tools-content-wrapper">
        <Sidebar
          sections={sidebarSections}
          activeSection={activeSection}
          variant="tools"
          filterLabel={filterLabel}
        />
        <div className="tools-content-wrapper">
          <MobileSectionNav
            sections={sidebarSections}
            activeSection={activeSection}
          />
          <main className="tools-main" data-blok-testid="tools-main">
            {toolSections.map((section) => (
              <ToolSection key={section.id} section={section} />
            ))}
          </main>
        </div>
      </div>
      <Footer />
    </div>
  );
};
