import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { Sidebar } from '../components/common/Sidebar';
import { MobileSectionNav } from '../components/common/MobileSectionNav';
import { OnThisPage } from '../components/api/OnThisPage';
import { ApiModuleBody } from '../components/api/ApiModuleBody';
import { ApiIndexRedirect } from '../components/api/ApiIndexRedirect';
import { useApiTranslations } from '../hooks/useApiTranslations';
import { useI18n } from '../contexts/I18nContext';
import { NAV_LINKS } from '../utils/constants';

/** The API documentation body — sidebar + per-module content — without page chrome. */
export const ApiContent: React.FC = () => {
  const { locale } = useI18n();
  const { apiSections, sidebarSections } = useApiTranslations();
  const location = useLocation();
  const navigate = useNavigate();

  // Active module id from the path: /docs/<id> -> <id>; /docs -> quick-start
  const activeModule = location.pathname.split('/')[2] || 'quick-start';
  const activeSection = apiSections.find((s) => s.id === activeModule);

  return (
    <div
      className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-10 px-6 lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)_14rem] lg:gap-12 pt-24 pb-24"
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
        />
      </div>
      <div className="min-w-0">
        <div className="lg:hidden">
          <MobileSectionNav
            key={`mobile-nav-${locale}`}
            sections={sidebarSections}
            activeSection={activeModule}
            onNavigate={(id) => navigate(`/docs/${id}`)}
          />
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
    <Nav links={NAV_LINKS} />
    <main>
      <ApiContent />
    </main>
    <Footer />
  </>
);
