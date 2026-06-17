import { Nav } from '../components/layout/Nav';
import { Footer } from '../components/layout/Footer';
import { CodemodCard } from '../components/migration/CodemodCard';
import { MigrationSteps } from '../components/migration/MigrationSteps';
import { useI18n } from '../contexts/I18nContext';
import { NAV_LINKS } from '../utils/constants';

export const MigrationPage: React.FC = () => {
  const { t } = useI18n();

  return (
    <>
      <Nav links={NAV_LINKS} />
      <main className="min-h-screen bg-background pt-16">
        <section className="mx-auto w-full max-w-6xl px-6 pb-12 pt-16 text-center sm:pt-24">
          <h1 className="flex flex-col items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-primary sm:text-sm">
              {t('migration.heroFromEditorJS')}
            </span>
            <span className="text-4xl font-extrabold tracking-tight text-foreground sm:text-6xl">
              {t('migration.heroToBlok')}{' '}
              <span className="text-brand-gradient">{t('migration.heroBlok')}</span>
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            {t('migration.heroDescription')}
          </p>

          <div className="mx-auto mt-10 flex max-w-2xl flex-wrap items-center justify-center gap-6 rounded-2xl border border-border bg-card px-8 py-6 shadow-card sm:gap-10">
            <div className="flex flex-col items-center">
              <span className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">{t('migration.statAverageMigrationValue')}</span>
              <span className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('migration.statAverageMigrationLabel')}</span>
            </div>
            <div className="hidden h-10 w-px bg-border sm:block" />
            <div className="flex flex-col items-center">
              <span className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">{t('migration.statApiCompatibleValue')}</span>
              <span className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('migration.statApiCompatibleLabel')}</span>
            </div>
            <div className="hidden h-10 w-px bg-border sm:block" />
            <div className="flex flex-col items-center">
              <span className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">{t('migration.statBreakingChangesValue')}</span>
              <span className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('migration.statBreakingChangesLabel')}</span>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-4xl px-6 py-12">
          <div className="mb-8 text-center">
            <span className="mb-3 inline-block rounded-full border border-border bg-secondary px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
              {t('migration.step1Badge')}
            </span>
            <h2 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">{t('migration.step1Title')}</h2>
            <p className="mx-auto mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
              {t('migration.step1Description')}
            </p>
          </div>
          <CodemodCard />
        </section>

        <MigrationSteps />

        <section className="mx-auto w-full max-w-4xl px-6 py-16">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-10 text-center shadow-card sm:p-14">
            <div className="absolute inset-x-0 top-0 h-1.5 bg-brand-gradient" />
            <h2 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">{t('migration.ctaTitle')}</h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
              {t('migration.ctaDescription')}
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a
                href="/demo"
                className="inline-flex items-center gap-2 rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-primary-foreground shadow-card transition-all hover:-translate-y-0.5 hover:shadow-card-hover"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                {t('migration.ctaTryDemo')}
              </a>
              <a
                href="/docs"
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-6 py-3 text-sm font-semibold text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-card-hover"
              >
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
        </section>
      </main>
      <Footer />
    </>
  );
};
