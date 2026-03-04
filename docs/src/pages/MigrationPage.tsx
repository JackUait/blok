import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { CodemodCard } from '../components/migration/CodemodCard';
import { MigrationSteps } from '../components/migration/MigrationSteps';
import { useI18n } from '../contexts/I18nContext';
import { NAV_LINKS } from '../utils/constants';
import '../../assets/migration.css';

export const MigrationPage: React.FC = () => {
  const { t } = useI18n();

  return (
    <>
      <Nav links={NAV_LINKS} />
      <main className="migration-main">
        {/* Background decorations */}
        <div className="migration-bg">
          <div className="migration-blur migration-blur-1" />
          <div className="migration-blur migration-blur-2" />
          <div className="migration-blur migration-blur-3" />
          <div className="migration-grid-pattern" />
          <div className="migration-radial-gradient" />
        </div>

        <section className="migration-hero">
          <h1 className="migration-hero-title">
            <span className="migration-hero-title-sub">{t('migration.heroFromEditorJS')}</span>
            <span className="migration-hero-title-main">
              {t('migration.heroToBlok')} <span className="migration-hero-gradient">{t('migration.heroBlok')}</span>
            </span>
          </h1>

          <p className="migration-hero-description">
            {t('migration.heroDescription')}
          </p>

          <div className="migration-hero-stats">
            <div className="migration-stat">
              <span className="migration-stat-value">{t('migration.statAverageMigrationValue')}</span>
              <span className="migration-stat-label">{t('migration.statAverageMigrationLabel')}</span>
            </div>
            <div className="migration-stat-divider" />
            <div className="migration-stat">
              <span className="migration-stat-value">{t('migration.statApiCompatibleValue')}</span>
              <span className="migration-stat-label">{t('migration.statApiCompatibleLabel')}</span>
            </div>
            <div className="migration-stat-divider" />
            <div className="migration-stat">
              <span className="migration-stat-value">{t('migration.statBreakingChangesValue')}</span>
              <span className="migration-stat-label">{t('migration.statBreakingChangesLabel')}</span>
            </div>
          </div>
        </section>

        <section className="migration-section migration-section--codemod">
          <div className="migration-section-header">
            <span className="migration-section-badge">
              {t('migration.step1Badge')}
            </span>
            <h2 className="migration-section-title">{t('migration.step1Title')}</h2>
            <p className="migration-section-description">
              {t('migration.step1Description')}
            </p>
          </div>
          <CodemodCard />
        </section>

        <MigrationSteps />

        <section className="migration-cta">
          <div className="migration-cta-card">
            <div className="migration-cta-band" />
            <div className="migration-cta-content">
              <h2 className="migration-cta-title">{t('migration.ctaTitle')}</h2>
              <p className="migration-cta-description">
                {t('migration.ctaDescription')}
              </p>
              <div className="migration-cta-actions">
                <a href="/demo" className="btn btn-primary">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  {t('migration.ctaTryDemo')}
                </a>
                <a href="/docs" className="btn btn-secondary">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                  {t('migration.ctaViewDocs')}
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
};
