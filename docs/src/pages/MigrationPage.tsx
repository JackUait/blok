import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { CodemodCard } from '../components/migration/CodemodCard';
import { MigrationSteps } from '../components/migration/MigrationSteps';
import { NAV_LINKS } from '../utils/constants';
import '../../assets/migration.css';

export const MigrationPage: React.FC = () => {
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
          <div className="migration-hero-badge">
            <span className="migration-hero-badge-dot" />
            Migration Guide
          </div>
          <h1 className="migration-hero-title">
            <span className="migration-hero-title-line">From EditorJS</span>
            <span className="migration-hero-title-line">
              to <span className="migration-hero-gradient">Blok</span>
            </span>
          </h1>
          <p className="migration-hero-description">
            Blok is designed as a drop-in replacement for EditorJS.
            Follow this guide to migrate your project in minutes, not hours.
          </p>
          <div className="migration-hero-stats">
            <div className="migration-stat">
              <span className="migration-stat-value">~2min</span>
              <span className="migration-stat-label">Average Migration</span>
            </div>
            <div className="migration-stat-divider" />
            <div className="migration-stat">
              <span className="migration-stat-value">100%</span>
              <span className="migration-stat-label">API Compatible</span>
            </div>
            <div className="migration-stat-divider" />
            <div className="migration-stat">
              <span className="migration-stat-value">0</span>
              <span className="migration-stat-label">Breaking Changes</span>
            </div>
          </div>
        </section>

        <section className="migration-section">
          <CodemodCard />
        </section>

        <MigrationSteps />

        <section className="migration-cta">
          <div className="migration-cta-card">
            <div className="migration-cta-content">
              <div className="migration-cta-icon-wrapper">
                <div className="migration-cta-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22,4 12,14.01 9,11.01" />
                  </svg>
                </div>
                <div className="migration-cta-sparkle migration-cta-sparkle-1" />
                <div className="migration-cta-sparkle migration-cta-sparkle-2" />
                <div className="migration-cta-sparkle migration-cta-sparkle-3" />
              </div>
              <h2 className="migration-cta-title">Ready to Migrate?</h2>
              <p className="migration-cta-description">
                Start with the automated codemod and complete your migration today.
              </p>
              <div className="migration-cta-actions">
                <a href="/demo" className="btn btn-primary">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Try the Demo
                </a>
                <a href="/docs" className="btn btn-secondary">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                  View API Docs
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
