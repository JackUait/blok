import { Suspense, lazy, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { Hero } from '../components/home/Hero';
import { CategoryBar, HOME_CATEGORIES, type HomeView } from '../components/home/CategoryBar';
import { Features } from '../components/home/Features';
import { FrameworkCards } from '../components/home/FrameworkCards';
import { WhyBlok } from '../components/home/WhyBlok';
import { MigrationCard } from '../components/home/MigrationCard';
import { TrustedBy } from '../components/home/TrustedBy';
import { DocsCtaCard } from '../components/home/DocsCtaCard';
import { NAV_LINKS } from '../utils/constants';

// The three panel bodies are only reachable behind ?view=, and each drags in a
// page's worth of code (the editor bundle, the migration sections, the whole
// changelog). Keep them out of the landing view's chunk.
const DemoContent = lazy(async () => ({ default: (await import('./DemoPage')).DemoContent }));
const MigrationContent = lazy(async () => ({
  default: (await import('./MigrationPage')).MigrationContent,
}));
const ChangelogContent = lazy(async () => ({
  default: (await import('./ChangelogPage')).ChangelogContent,
}));

/** Views openable from the category bar, excluding the default landing view. */
const PANEL_VIEWS = HOME_CATEGORIES.map((c) => c.view).filter(
  (view): view is Exclude<HomeView, 'getStarted'> => view !== 'getStarted',
);

const isPanelView = (value: string | null): value is Exclude<HomeView, 'getStarted'> =>
  value !== null && (PANEL_VIEWS as string[]).includes(value);

/**
 * Only the lazy panels get a boundary, and never the landing view. React defers
 * any Suspense boundary larger than `progressiveChunkSize` (12.8 KB) into a
 * segment appended at the end of the document — whether or not it ever
 * suspends. Wrapping the whole switch therefore emitted `/` and `/ru` as a hero,
 * this fallback, and a footer, with the entire landing body parked in a
 * `<div hidden>` that only JavaScript un-hides. `?view=` panels are not
 * prerendered, so a boundary around those costs nothing.
 */
const LazyPanel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Suspense fallback={<div className="min-h-[60vh]" data-blok-testid="home-panel-loading" />}>
    {children}
  </Suspense>
);

export const HomePage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // The URL's ?view= param is the single source of truth for the active tab.
  const rawView = searchParams.get('view');
  const activeView: HomeView = isPanelView(rawView) ? rawView : 'getStarted';

  const handleSelect = (view: HomeView): void => {
    const next = new URLSearchParams(searchParams);
    if (view === 'getStarted') {
      next.delete('view');
    } else {
      next.set('view', view);
    }
    setSearchParams(next);
  };

  useEffect(() => {
    // Smooth scroll for anchor links
    const handleAnchorClick = (e: Event) => {
      const target = e.target as HTMLAnchorElement;
      const href = target.getAttribute('href');
      if (!href || !href.startsWith('#')) return;

      const targetElement = document.querySelector(href);
      if (targetElement) {
        e.preventDefault();
        targetElement.scrollIntoView({
          behavior: 'auto',
          block: 'start',
        });
      }
    };

    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
      anchor.addEventListener('click', handleAnchorClick);
    });

    // Theme detection
    const detectTheme = () => {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.toggle('dark-theme', prefersDark);

      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        document.documentElement.classList.toggle('dark-theme', e.matches);
      });
    };

    detectTheme();

    return () => {
      document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
        anchor.removeEventListener('click', handleAnchorClick);
      });
    };
  }, []);

  const renderPanel = (): React.ReactNode => {
    switch (activeView) {
      case 'docs':
        return <DocsCtaCard />;
      case 'playground':
        return (
          <LazyPanel>
            <DemoContent inline />
          </LazyPanel>
        );
      case 'migration':
        return (
          <LazyPanel>
            <MigrationContent inline />
          </LazyPanel>
        );
      case 'changelog':
        return (
          <LazyPanel>
            <ChangelogContent inline />
          </LazyPanel>
        );
      default:
        return (
          <>
            <Features />
            <FrameworkCards />
            <WhyBlok />
            <TrustedBy />
            <MigrationCard />
          </>
        );
    }
  };

  return (
    <>
      <Nav links={NAV_LINKS} />
      <main>
        <Hero />
        <CategoryBar activeView={activeView} onSelect={handleSelect} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeView}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            {renderPanel()}
          </motion.div>
        </AnimatePresence>
      </main>
      <Footer />
    </>
  );
};
