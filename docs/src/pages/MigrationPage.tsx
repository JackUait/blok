import { Link } from 'react-router-dom';
import { Nav } from '../components/layout/Nav';
import { CodemodCard } from '../components/migration/CodemodCard';
import { MigrationSteps } from '../components/migration/MigrationSteps';
import { NAV_LINKS } from '../utils/constants';
import '../../assets/migration.css';

export const MigrationPage: React.FC = () => {
  return (
    <>
      <Nav links={NAV_LINKS} />
      <main className="migration-main">
        <div className="migration-breadcrumb">
          <Link to="/">Documentation</Link>
          <span className="breadcrumb-separator">/</span>
          <span>Migration Guide</span>
        </div>

        <section className="migration-hero">
          <div className="migration-hero-badge">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 0L1 4v7c0 4 3.2 7.5 7 8 3.8-.5 7-4 7-8V4L8 0zm0 1.3L14.5 5v6c0 3.3-2.7 6.2-6 6.7V9H5.5v-3l2.5-1.5v-2.2H8z" />
            </svg>
            Migration
          </div>
          <h1 className="migration-hero-title">From EditorJS to Blok</h1>
          <p className="migration-hero-description">
            Blok is designed as a drop-in replacement for EditorJS. Follow this guide to migrate
            your project in minutes, not hours.
          </p>
        </section>

        <section className="migration-section">
          <CodemodCard />
        </section>

        <MigrationSteps />
      </main>
    </>
  );
};
