import { Nav } from "../components/layout/Nav";
import { Footer } from "../components/layout/Footer";
import { MigrationHero } from "../components/migration/MigrationHero";
import { MigrationWalls } from "../components/migration/MigrationWalls";
import { MigrationObjections } from "../components/migration/MigrationObjections";
import { MigrationMove } from "../components/migration/MigrationMove";
import { NAV_LINKS } from "../utils/constants";

interface MigrationContentProps {
  /** When embedded inline (homepage tab strip), tighten the hero top spacing. */
  inline?: boolean;
}

/** The Editor.js → Blok persuasion page: hero → walls → objections → move. */
export const MigrationContent: React.FC<MigrationContentProps> = ({ inline = false }) => (
  <>
    <MigrationHero inline={inline} />
    <div className="mx-auto w-full max-w-6xl space-y-24 px-6 pb-24">
      <MigrationWalls />
      <MigrationObjections />
      <MigrationMove />
    </div>
  </>
);

export const MigrationPage: React.FC = () => (
  <>
    <Nav links={NAV_LINKS} />
    <main className="min-h-screen bg-background pt-16">
      <MigrationContent />
    </main>
    <Footer />
  </>
);
