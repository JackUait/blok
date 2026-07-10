import { useEffect, useState } from 'react';
import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { CodemodCard } from '../components/migration/CodemodCard';
import { RewritePreview } from '../components/migration/RewritePreview';
import { MigrationSteps } from '../components/migration/MigrationSteps';
import { MigrationStepRail } from '../components/migration/MigrationStepRail';
import { MigrationSectionHeader } from '../components/migration/MigrationSectionHeader';
import { MIGRATION_STEPS } from '../components/migration/migration-data';
import { useI18n } from '../contexts/I18nContext';
import { Typo } from '../components/common/Typo';
import { Button } from '@/components/ui/button';
import { NAV_LINKS } from '../utils/constants';
import { cn } from '@/lib/utils';

const STEP_IDS = MIGRATION_STEPS.map((step) => step.id);

/** Scroll-spy: which migration step section is currently in view. */
const useActiveStep = (): string => {
  const [activeId, setActiveId] = useState<string>(STEP_IDS[0]);

  useEffect(() => {
    // IntersectionObserver hands entries back in an unspecified order, so track
    // what's on screen and resolve the winner in document order — otherwise the
    // rail's active step (and its progress fill) flickers between neighbours.
    const visible = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            visible.add(entry.target.id);
          } else {
            visible.delete(entry.target.id);
          }
        });

        const topmost = STEP_IDS.find((id) => visible.has(id));
        if (topmost) {
          setActiveId(topmost);
        }
      },
      { rootMargin: '-15% 0px -70% 0px' },
    );

    STEP_IDS.forEach((id) => {
      const element = document.getElementById(id);
      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, []);

  return activeId;
};

interface MigrationContentProps {
  /** When embedded inline (homepage tab strip), tighten the hero top spacing. */
  inline?: boolean;
}

/** The Editor.js → Blok migration guide — hero, step rail, steps. */
export const MigrationContent: React.FC<MigrationContentProps> = ({ inline = false }) => {
  const { t } = useI18n();
  const activeId = useActiveStep();

  const codemodStep = MIGRATION_STEPS[0];

  return (
    <>
      <section className={cn('relative overflow-hidden pb-16', inline ? 'pt-10' : 'pt-16 sm:pt-24')}>
        {/* The same soft atmosphere the home hero breathes — brand wash + dotted grid. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -top-28 left-1/4 size-[32rem] -translate-x-1/2 rounded-full bg-primary/[0.07] blur-3xl" />
          <div className="absolute -top-8 right-[-7rem] size-[26rem] rounded-full bg-chart-3/10 blur-3xl" />
          <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)]" />
        </div>

        <div className="mx-auto w-full max-w-6xl px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-center lg:gap-x-16">
          <div className="duration-700 animate-in fade-in slide-in-from-bottom-2 fill-mode-both">
            <p className="flex items-center gap-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              <span aria-hidden className="h-px w-8 bg-brand-gradient" />
              <Typo>{t('migration.heroEyebrow')}</Typo>
            </p>
            <h1 className="mt-5 font-display text-4xl font-extrabold tracking-tight text-balance text-foreground sm:text-5xl lg:text-6xl">
              {t('migration.heroFromEditorJS')} {t('migration.heroToBlok')}{' '}
              <span className="text-brand-gradient">{t('migration.heroBlok')}</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              <Typo>{t('migration.heroDescription')}</Typo>
            </p>
            <div
              className="mt-9 flex flex-wrap items-center gap-3 duration-700 animate-in fade-in slide-in-from-bottom-2 fill-mode-both delay-150"
              data-blok-testid="hero-ctas"
            >
              <Button variant="brand" size="lg" asChild>
                <a href="#codemod">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 17l6-5-6-5M12 19h8" />
                  </svg>
                  <Typo>{t('migration.sectionCodemodTitle')}</Typo>
                </a>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <a href="#changes">
                  <Typo>{t('migration.sectionChangesTitle')}</Typo>
                </a>
              </Button>
            </div>
          </div>

          <RewritePreview className="mt-14 duration-700 animate-in fade-in slide-in-from-bottom-4 zoom-in-[0.98] fill-mode-both delay-150 lg:mt-0" />
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl px-6 lg:grid lg:grid-cols-[13rem_1fr] lg:gap-x-16">
        <div className="hidden lg:block">
          <MigrationStepRail activeId={activeId} className="sticky top-28" />
        </div>

        <div className="min-w-0">
          <section
            id="codemod"
            className="scroll-mt-28 border-t border-border pt-12 pb-16"
            data-blok-testid="codemod-section"
          >
            <MigrationSectionHeader
              step={1}
              title={t(codemodStep.titleKey)}
              description={t(codemodStep.descriptionKey)}
            />
            <CodemodCard />
          </section>

          <MigrationSteps />
        </div>
      </div>
    </>
  );
};

export const MigrationPage: React.FC = () => (
  <>
    <Nav links={NAV_LINKS} />
    <main className="min-h-screen bg-background pt-16">
      <MigrationContent />
    </main>
    <Footer />
  </>
);
