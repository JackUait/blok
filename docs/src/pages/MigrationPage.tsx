import { useEffect, useState } from 'react';
import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { CodeBlock } from '../components/common/CodeBlock';
import { CodemodCard } from '../components/migration/CodemodCard';
import { MigrationSteps } from '../components/migration/MigrationSteps';
import { MigrationStepRail } from '../components/migration/MigrationStepRail';
import {
  CODEMOD_DRY_RUN_COMMAND,
  MIGRATION_STEPS,
} from '../components/migration/migration-data';
import { useI18n } from '../contexts/I18nContext';
import { Typo } from '../components/common/Typo';
import { NAV_LINKS } from '../utils/constants';
import { cn } from '@/lib/utils';

const STEP_IDS = MIGRATION_STEPS.map((step) => step.id);

/** Scroll-spy: which migration step section is currently in view. */
const useActiveStep = (): string => {
  const [activeId, setActiveId] = useState<string>(STEP_IDS[0]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
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

const FactCheckIcon: React.FC = () => (
  <svg className="shrink-0 text-primary" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

interface MigrationContentProps {
  /** When embedded inline (homepage tab strip), tighten the hero top spacing. */
  inline?: boolean;
}

/** The Editor.js → Blok migration guide — hero, step rail, 5 steps, coda, CTA. */
export const MigrationContent: React.FC<MigrationContentProps> = ({ inline = false }) => {
  const { t } = useI18n();
  const activeId = useActiveStep();

  const facts = [
    t('migration.factOneCommand'),
    t('migration.factToolsMapped'),
    t('migration.factAlias'),
  ];

  const codemodStep = MIGRATION_STEPS[0];

  return (
    <>
      <section className={cn('mx-auto w-full max-w-6xl px-6 pb-12', inline ? 'pt-10' : 'pt-16 sm:pt-24')}>
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              <Typo>{t('migration.heroEyebrow')}</Typo>
            </p>
            <h1 className="mt-4 font-display text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
              {t('migration.heroFromEditorJS')} {t('migration.heroToBlok')}{' '}
              <span className="text-brand-gradient">{t('migration.heroBlok')}</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
              <Typo>{t('migration.heroDescription')}</Typo>
            </p>
            <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2" data-blok-testid="hero-facts">
              {facts.map((fact) => (
                <li key={fact} className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <FactCheckIcon />
                  <Typo>{fact}</Typo>
                </li>
              ))}
            </ul>
          </div>

          <div className="min-w-0" data-blok-testid="hero-command">
            <CodeBlock code={CODEMOD_DRY_RUN_COMMAND} language="bash" />
            <p className="mt-3 text-sm text-muted-foreground">
              <Typo>{t('migration.heroCommandHint')}</Typo>
            </p>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl px-6 lg:grid lg:grid-cols-[13rem_1fr] lg:gap-14">
        <div className="hidden lg:block">
          <MigrationStepRail activeId={activeId} className="sticky top-28" />
        </div>

        <div className="min-w-0">
          <section
            id="codemod"
            className="scroll-mt-24 py-12"
            data-blok-testid="codemod-section"
          >
            <header className="mb-8">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-sm tabular-nums text-muted-foreground/70">01</span>
                <h2 className="font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
                  <Typo>{t(codemodStep.titleKey)}</Typo>
                </h2>
              </div>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
                <Typo>{t(codemodStep.descriptionKey)}</Typo>
              </p>
            </header>
            <CodemodCard />
          </section>

          <MigrationSteps />
        </div>
      </div>

      <section className="mx-auto w-full max-w-4xl px-6 py-16">
        <div className="rounded-2xl border border-border bg-card p-10 text-center shadow-card sm:p-14">
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl"><Typo>{t('migration.ctaTitle')}</Typo></h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            <Typo>{t('migration.ctaDescription')}</Typo>
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href="/demo"
              className="inline-flex items-center gap-2 rounded-xl bg-foreground px-6 py-3 text-sm font-semibold text-background shadow-card transition-colors hover:bg-foreground/90"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <Typo>{t('migration.ctaTryDemo')}</Typo>
            </a>
            <a
              href="/docs"
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-6 py-3 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-secondary/60"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
              <Typo>{t('migration.ctaViewDocs')}</Typo>
            </a>
          </div>
        </div>
      </section>
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
