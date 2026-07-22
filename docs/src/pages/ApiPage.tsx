import { Routes, Route, useLocation } from 'react-router-dom';
import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { Sidebar } from '../components/common/Sidebar';
import { FrameworkToggle } from '../components/common/FrameworkToggle';
import { MobileSectionNav } from '../components/common/MobileSectionNav';
import { OnThisPage, OnThisPageDropdown } from '../components/api/OnThisPage';
import { ApiModuleBody } from '../components/api/ApiModuleBody';
import { ApiIndexRedirect } from '../components/api/ApiIndexRedirect';
import { useApiTranslations } from '../hooks/useApiTranslations';
import { useI18n } from '../contexts/I18nContext';
import { splitLocalePath } from '../seo/locales';
import { NAV_LINKS } from '../utils/constants';

/** The API documentation body — sidebar + per-module content — without page chrome. */
export const ApiContent: React.FC = () => {
  const { locale } = useI18n();
  const { apiSections, sidebarSections } = useApiTranslations();
  const location = useLocation();

  // Active module id from the path: /docs/<id> -> <id>. Bare /docs is the hub,
  // which is no module — nothing in the nav is current and there is no TOC.
  // Split the LOCALE-STRIPPED path: on `/ru/docs/caret-api` segment 2 is "docs",
  // which matched no module and left every Russian reference page with a fully
  // collapsed sidebar, no aria-current and no "On this page".
  const activeModule = splitLocalePath(location.pathname).path.split('/')[2] ?? '';
  const activeSection = apiSections.find((s) => s.id === activeModule);

  return (
    <div
      className="mx-auto grid w-full max-w-[110rem] grid-cols-1 gap-10 px-6 lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)_14rem] lg:gap-12 pt-24 pb-24"
      data-blok-testid="api-docs"
    >
      <div className="hidden lg:block">
        <Sidebar
          key={`sidebar-${locale}`}
          sections={sidebarSections}
          activeSection={activeModule}
          variant="api"
          linkMode="route"
          buildHref={(id) => `/docs/${id}`}
          header={<FrameworkToggle />}
        />
      </div>
      <div className="min-w-0">
        <div className="lg:hidden">
          <div className="mb-4">
            <FrameworkToggle />
          </div>
          <MobileSectionNav
            key={`mobile-nav-${locale}`}
            sections={sidebarSections}
            activeSection={activeModule}
            buildHref={(id) => `/docs/${id}`}
          />
        </div>
        {/* Between lg and xl (1024–1279px) there's no room for the persistent
            sidebar TOC, but it shouldn't just disappear — show a compact
            dropdown instead, mirroring MobileSectionNav's fallback below lg. */}
        <div className="hidden lg:block xl:hidden">
          {activeSection && (
            <OnThisPageDropdown key={`toc-dropdown-${activeModule}`} section={activeSection} />
          )}
        </div>
        <div className="mx-auto max-w-3xl" data-blok-testid="api-main">
          <Routes>
            <Route index element={<ApiIndexRedirect />} />
            <Route path=":moduleId" element={<ApiModuleBody />} />
          </Routes>
        </div>
      </div>
      <div className="hidden xl:block">
        {activeSection && <OnThisPage key={activeModule} section={activeSection} />}
      </div>
    </div>
  );
};

export const ApiPage: React.FC = () => (
  <>
    <Nav links={NAV_LINKS} keepExpanded />
    <main id="main-content" tabIndex={-1}>
      <ApiContent />
    </main>
    <Footer />
  </>
);
