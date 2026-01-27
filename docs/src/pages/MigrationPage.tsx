import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { CodemodCard } from '../components/migration/CodemodCard';
import { MigrationSteps } from '../components/migration/MigrationSteps';
import { WaveDivider } from '../components/common/WaveDivider';
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
          <div className="migration-grid-pattern" />
        </div>

        <section className="migration-hero">
          <h1 className="migration-hero-title">
            From EditorJS to <span className="migration-hero-gradient">Blok</span>
          </h1>
          <p className="migration-hero-description">
            Blok is designed as a replacement for EditorJS. <br /> Follow this guide to migrate
            your project in minutes, not hours.
          </p>
        </section>

        <section className="migration-section">
          <CodemodCard />
        </section>

        <WaveDivider
          variant="curved"
          fillColor="var(--color-surface)"
          height={60}
          position="bottom"
        />

        <div className="migration-steps-wrapper">
          <MigrationSteps />
          <WaveDivider
            variant="layered"
            fillColor="var(--color-background)"
            height={80}
            position="bottom"
          />
        </div>

        <section className="migration-cta">
          <div className="migration-cta-card">
            <div className="migration-cta-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22,4 12,14.01 9,11.01" />
              </svg>
            </div>
            <h2>Ready to Migrate?</h2>
            <p>Start with the automated codemod and complete your migration today.</p>
            <div className="migration-cta-actions">
              <a href="/demo" className="btn btn-primary">Try the Demo</a>
              <a href="/docs" className="btn btn-secondary">View API Docs</a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
};
