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
        <section className="migration-hero">
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
      <Footer />
    </>
  );
};
