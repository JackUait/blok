// docs/src/pages/ToolsPage.tsx
import { useEffect, useState, useCallback, useRef } from 'react';
import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { Sidebar } from '../components/common/Sidebar';
import { MobileSectionNav } from '../components/common/MobileSectionNav';
import { ToolSection } from '../components/tools/ToolSection';
import { useToolsTranslations } from '../hooks/useToolsTranslations';
import { NAV_LINKS } from '../utils/constants';
import { cn } from '@/lib/utils';

interface ToolsContentProps {
  /** When embedded inline (homepage tab strip), drop fixed-nav clearance. */
  inline?: boolean;
}

/** The block-tools documentation body — sidebar + tool sections. */
export const ToolsContent: React.FC<ToolsContentProps> = ({ inline = false }) => {
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
    <div
      className={cn('bg-background', !inline && 'min-h-screen pt-16')}
      data-blok-testid="tools-docs"
    >
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-10 lg:grid-cols-[16rem_minmax(0,1fr)] lg:py-14">
        <div className="hidden lg:block">
          <Sidebar
            sections={sidebarSections}
            activeSection={activeSection}
            variant="tools"
            filterLabel={filterLabel}
          />
        </div>
        <div className="min-w-0">
          <MobileSectionNav
            sections={sidebarSections}
            activeSection={activeSection}
          />
          <div
            className="flex flex-col gap-16 lg:gap-24"
            data-blok-testid="tools-main"
          >
            {toolSections.map((section) => (
              <ToolSection key={section.id} section={section} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export const ToolsPage: React.FC = () => (
  <>
    <Nav links={NAV_LINKS} />
    <main>
      <ToolsContent />
    </main>
    <Footer />
  </>
);
