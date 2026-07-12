import { useEffect, useState } from "react";
import { Nav } from "../components/layout/Nav";
import { Footer } from "../components/layout/Footer";
import { CodemodCard } from "../components/migration/CodemodCard";
import { MigrationSteps } from "../components/migration/MigrationSteps";
import { MigrationStepRail } from "../components/migration/MigrationStepRail";
import { MigrationSectionHeader } from "../components/migration/MigrationSectionHeader";
import { MIGRATION_STEPS } from "../components/migration/migration-data";
import { useI18n } from "../contexts/I18nContext";
import { Typo } from "../components/common/Typo";
import { NAV_LINKS } from "../utils/constants";

const STEP_IDS = MIGRATION_STEPS.map((step) => step.id);

/** Scroll-spy: which migration step section is in view (document-order winner). */
const useActiveStep = (): string => {
  const [activeId, setActiveId] = useState<string>(STEP_IDS[0]);
  useEffect(() => {
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        });
        const topmost = STEP_IDS.find((id) => visible.has(id));
        if (topmost) setActiveId(topmost);
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    STEP_IDS.forEach((id) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, []);
  return activeId;
};

/** The full Editor.js → Blok migration reference — the demoted step-by-step guide. */
export const MigrationReferencePage: React.FC = () => {
  const { t } = useI18n();
  const activeId = useActiveStep();
  const codemodStep = MIGRATION_STEPS[0];

  return (
    <>
      <Nav links={NAV_LINKS} />
      <main className="min-h-screen bg-background pt-16">
        <div className="mx-auto w-full max-w-6xl px-6 pt-16 sm:pt-24">
          <h1 className="font-display text-4xl font-extrabold tracking-tight text-balance text-foreground sm:text-5xl">
            <Typo>{t("migration.referencePageTitle")}</Typo>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            <Typo>{t("migration.referencePageDescription")}</Typo>
          </p>
        </div>

        <div className="mx-auto mt-12 w-full max-w-6xl px-6 lg:grid lg:grid-cols-[13rem_1fr] lg:gap-x-16">
          <div className="hidden lg:block">
            <MigrationStepRail activeId={activeId} className="sticky top-28" />
          </div>
          <div className="min-w-0">
            <section id="codemod" className="scroll-mt-28 border-t border-border pt-12 pb-16" data-blok-testid="codemod-section">
              <MigrationSectionHeader step={1} title={t(codemodStep.titleKey)} description={t(codemodStep.descriptionKey)} />
              <CodemodCard />
            </section>
            <MigrationSteps />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
};
