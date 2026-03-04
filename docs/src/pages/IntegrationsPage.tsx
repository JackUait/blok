import { useEffect, useState, useCallback, useRef } from 'react';
import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { Sidebar } from '../components/common/Sidebar';
import { MobileSectionNav } from '../components/common/MobileSectionNav';
import { CodeBlock } from '../components/common/CodeBlock';
import { NAV_LINKS } from '../utils/constants';
import {
  REACT_SECTIONS,
  INTEGRATIONS_SIDEBAR,
  type IntegrationSection,
} from '../components/integrations/integrations-data';
import { useI18n } from '../contexts/I18nContext';
import '../../assets/integrations.css';

// ─── Section renderer ──────────────────────────────────────────────────────

const IntegrationSectionView: React.FC<{ section: IntegrationSection }> = ({ section }) => {
  const { t } = useI18n();
  if (section.customType === 'install') {
    return (
      <section id={section.id} className="api-section intg-section" aria-label={section.title}>
        <div className="api-section-header">
          {section.badge && <div className="api-section-badge">{section.badge}</div>}
          <h1 className="api-section-title">
            <a href={`#${section.id}`} className="api-anchor-link" aria-label={`Link to ${section.title}`}>#</a>
            {section.title}
          </h1>
          {section.description && <p className="api-section-description">{section.description}</p>}
        </div>
        {section.example && (
          <div className="api-block intg-install-block">
            <CodeBlock code={section.example} language="bash" />
            <p className="intg-install-note">
              React 18+ is a peer dependency — it is not bundled with Blok.
              If you already have React in your project, no extra install is needed.
            </p>
          </div>
        )}
      </section>
    );
  }

  return (
    <section id={section.id} className="api-section intg-section" aria-label={section.title}>
      <div className="api-section-header">
        {section.badge && <div className="api-section-badge">{section.badge}</div>}
        <h1 className="api-section-title">
          <a href={`#${section.id}`} className="api-anchor-link" aria-label={`Link to ${section.title}`}>#</a>
          {section.title}
        </h1>
        {section.description && <p className="api-section-description">{section.description}</p>}
      </div>

      {section.table && section.table.length > 0 && (
        <div className="api-block">
          <h3 className="api-block-title">Parameters</h3>
          <table className="api-table">
            <thead>
              <tr>
                <th>{t('api.parameter')}</th>
                <th>{t('api.type')}</th>
                <th>{t('api.default')}</th>
                <th>{t('api.description')}</th>
              </tr>
            </thead>
            <tbody>
              {section.table.map((row) => (
                <tr key={row.option} className="api-table-row">
                  <td><code>{row.option}</code></td>
                  <td><code>{row.type}</code></td>
                  <td><code>{row.default}</code></td>
                  <td>{row.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {section.properties && section.properties.length > 0 && (
        <div className="api-block">
          <h3 className="api-block-title">
            {section.id === 'react-blok-content' ? 'Props' : 'Returns'}
          </h3>
          <table className="api-table">
            <thead>
              <tr>
                <th>{t('api.name')}</th>
                <th>{t('api.type')}</th>
                <th>{t('api.description')}</th>
              </tr>
            </thead>
            <tbody>
              {section.properties.map((prop) => (
                <tr key={prop.name} className="api-table-row">
                  <td><code>{prop.name}</code></td>
                  <td><code>{prop.type}</code></td>
                  <td>{prop.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {section.example && (
        <div className="api-block">
          <CodeBlock code={section.example} language="tsx" />
        </div>
      )}
    </section>
  );
};

// ─── Page ──────────────────────────────────────────────────────────────────

export const IntegrationsPage: React.FC = () => {
  const [activeSection, setActiveSection] = useState<string>(() => {
    const hash = window.location.hash.slice(1);
    return hash || 'react-install';
  });
  const scrollTargetRef = useRef<string | null>(null);

  const scrollToHash = useCallback(() => {
    const hash = window.location.hash.slice(1);
    if (!hash) return;

    requestAnimationFrame(() => {
      const el = document.getElementById(hash);
      if (el) {
        scrollTargetRef.current = hash;
        setActiveSection(hash);
        el.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    });
  }, []);

  useEffect(() => {
    scrollToHash();
    window.addEventListener('hashchange', scrollToHash);
    return () => window.removeEventListener('hashchange', scrollToHash);
  }, [scrollToHash]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.filter((e) => e.isIntersecting).forEach((e) => {
          if (scrollTargetRef.current && e.target.id === scrollTargetRef.current) {
            scrollTargetRef.current = null;
            return;
          }
          if (scrollTargetRef.current) return;
          setActiveSection(e.target.id);
        });
      },
      { root: null, rootMargin: '-100px 0px -100px 0px', threshold: 0.1 }
    );

    REACT_SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });

    const handleAnchorClick = (e: Event): void => {
      const target = e.target as HTMLAnchorElement;
      const href = target.getAttribute('href');
      if (!href?.startsWith('#')) return;
      const el = document.querySelector(href);
      if (!el) return;
      e.preventDefault();
      const id = href.slice(1);
      window.history.pushState(null, '', href);
      scrollTargetRef.current = id;
      setActiveSection(id);
      el.scrollIntoView({ behavior: 'auto', block: 'start' });
    };

    document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', handleAnchorClick));

    return () => {
      observer.disconnect();
      document.querySelectorAll('a[href^="#"]').forEach((a) => a.removeEventListener('click', handleAnchorClick));
    };
  }, []);

  return (
    <>
      <Nav links={NAV_LINKS} />
      <div className="api-docs intg-page">
        <Sidebar
          sections={INTEGRATIONS_SIDEBAR}
          activeSection={activeSection}
          variant="api"
          filterLabel="Filter"
        />
        <div className="api-content-wrapper">
          <MobileSectionNav
            sections={INTEGRATIONS_SIDEBAR}
            activeSection={activeSection}
          />
          <main className="api-main intg-main">
            <div className="intg-hero">
              <div className="intg-hero-badge">Integrations</div>
              <h1 className="intg-hero-title">Use Blok with React</h1>
              <p className="intg-hero-description">
                The official React adapter ships as{' '}
                <code>@jackuait/blok/react</code>. It provides a{' '}
                <code>useBlok</code> hook and a <code>BlokContent</code>{' '}
                component that manage the full editor lifecycle — including
                StrictMode, SSR-safe rendering, and clean teardown.
              </p>
            </div>
            {REACT_SECTIONS.map((section) => (
              <IntegrationSectionView key={section.id} section={section} />
            ))}
          </main>
        </div>
      </div>
      <Footer />
    </>
  );
};
