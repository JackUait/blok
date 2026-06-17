import { Link } from 'react-router-dom';
import { useI18n } from '../../contexts/I18nContext';
import { Button } from '@/components/ui/button';

export const Hero: React.FC = () => {
  const { t } = useI18n();

  const handleScrollToQuickStart = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    e.preventDefault();
    const target = document.getElementById('quick-start');
    target?.scrollIntoView({ behavior: 'auto' });
  };

  return (
    <section className="relative overflow-hidden pt-28 pb-16 sm:pt-32 sm:pb-24">
      {/* Soft brand wash backdrop */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        <div className="absolute -top-32 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute right-[-8rem] top-24 size-[24rem] rounded-full bg-chart-3/10 blur-3xl" />
      </div>

      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="text-center lg:text-left" data-blok-testid="hero-content">
          <p className="text-xs font-bold uppercase tracking-wide text-primary">
            {t('home.hero.eyebrow')}
          </p>
          <h1 className="mt-5 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            {t('home.hero.title')}
            <br />
            <span className="text-brand-gradient">{t('home.hero.titleGradient')}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground lg:mx-0">
            {t('home.hero.description')}
          </p>
          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row lg:justify-start justify-center">
            <Button variant="brand" size="lg" asChild>
              <a href="#quick-start" onClick={handleScrollToQuickStart}>
                {t('home.hero.ctaGetStarted')}
              </a>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link to="/demo">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                {t('home.hero.ctaTryItOut')}
              </Link>
            </Button>
          </div>
        </div>

        <div className="relative flex justify-center lg:justify-end" data-blok-testid="hero-demo">
          <div className="relative">
            <div
              className="absolute inset-0 -z-10 scale-110 rounded-[2rem] bg-brand-gradient opacity-20 blur-2xl"
              aria-hidden="true"
            />
            <Link
              to="/demo"
              className="group relative flex aspect-square w-72 max-w-full flex-col items-center justify-center gap-6 rounded-[2rem] border border-border bg-card p-8 shadow-card transition-all hover:-translate-y-1 hover:shadow-card-hover sm:w-80"
              aria-label={t('home.hero.mascotAriaLabel')}
            >
              <img
                src="/mascot.png"
                alt={t('home.hero.mascotAlt')}
                className="size-40 object-contain transition-transform duration-300 group-hover:scale-105"
              />
              <span className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background">
                {t('home.hero.ctaTryItOut')}
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  aria-hidden="true"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </span>
            </Link>

            <div
              className="absolute -left-6 top-8 flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-semibold shadow-card"
              aria-hidden="true"
            >
              <span className="font-mono text-primary">{'{ }'}</span>
              {t('home.hero.chipJson')}
            </div>
            <div
              className="absolute -right-4 bottom-10 flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-semibold shadow-card"
              aria-hidden="true"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                className="text-chart-4"
              >
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              {t('home.hero.chipSize')}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
