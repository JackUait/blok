import { Link } from 'react-router-dom';
import { useI18n } from '../../contexts/I18nContext';
import { Button } from '@/components/ui/button';

/** Six-dot drag handle — the universal "grab this block" affordance. */
const BlockHandle: React.FC<{ tone?: 'light' }> = ({ tone }) => (
  <svg
    width="7"
    height="13"
    viewBox="0 0 7 13"
    className={`mt-1 shrink-0 opacity-50 transition-opacity duration-300 group-hover:opacity-90 ${
      tone === 'light' ? 'fill-background/45' : 'fill-muted-foreground/70'
    }`}
  >
    <circle cx="2" cy="2.5" r="1.05" />
    <circle cx="5" cy="2.5" r="1.05" />
    <circle cx="2" cy="6.5" r="1.05" />
    <circle cx="5" cy="6.5" r="1.05" />
    <circle cx="2" cy="10.5" r="1.05" />
    <circle cx="5" cy="10.5" r="1.05" />
  </svg>
);

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
        {/* faint dotted grid — gives the empty space texture without noise */}
        <div className="absolute inset-0 opacity-[0.4] [background-image:radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)]" />
      </div>

      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="text-center lg:text-left" data-blok-testid="hero-content">
          <h1 className="animate-in fade-in slide-in-from-bottom-3 fill-mode-both text-4xl font-extrabold leading-[1.05] tracking-tight duration-700 sm:text-5xl lg:text-6xl">
            {t('home.hero.title')}
            <br />
            <span className="text-brand-gradient">{t('home.hero.titleGradient')}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground duration-700 animate-in fade-in slide-in-from-bottom-3 fill-mode-both delay-100 lg:mx-0">
            {t('home.hero.description')}
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 duration-700 animate-in fade-in slide-in-from-bottom-3 fill-mode-both delay-200 sm:flex-row lg:justify-start">
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
          <div className="hero-float group relative duration-1000 animate-in fade-in zoom-in-95 fill-mode-both delay-150">
            {/* the noodle sunset blooms behind the stack */}
            <div
              className="hero-blob pointer-events-none absolute -inset-8 -z-10 bg-brand-gradient opacity-25 blur-3xl transition-opacity duration-500 group-hover:opacity-40"
              aria-hidden="true"
            />

            {/* Everything is a block — a loose stack of real block types, each drifting
                on its own parallax cycle with its own drag handle. The dark code block
                anchors the bottom. The whole stack opens the playground. */}
            <Link
              to="/demo"
              className="relative flex w-72 max-w-full flex-col gap-3.5 transition-[gap] duration-500 ease-out group-hover:gap-5 sm:w-80"
              aria-label={t('home.hero.mascotAriaLabel')}
            >
              {/* Heading block */}
              <div className="hero-card-a flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-card transition-shadow duration-300 hover:shadow-card-hover">
                <BlockHandle />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-4/5 rounded-md bg-brand-gradient" />
                  <div className="h-2 w-full rounded-full bg-muted" />
                </div>
              </div>

              {/* To-do block */}
              <div className="hero-card-b flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-card transition-shadow duration-300 hover:shadow-card-hover">
                <BlockHandle />
                <div className="flex-1 space-y-2.5">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-[5px] bg-primary text-primary-foreground">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                    <span className="h-2 flex-1 rounded-full bg-muted-foreground/25" />
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="size-4 shrink-0 rounded-[5px] border-2 border-border" />
                    <span className="h-2 w-4/5 rounded-full bg-muted" />
                  </div>
                </div>
              </div>

              {/* Image block */}
              <div className="hero-card-c flex items-start gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-card transition-shadow duration-300 hover:shadow-card-hover">
                <BlockHandle />
                <div className="flex-1 space-y-2.5">
                  <div className="relative h-20 w-full overflow-hidden rounded-lg bg-muted">
                    <span className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="16" rx="2.5" />
                        <circle cx="8.5" cy="9.5" r="1.8" />
                        <path d="m4 17 5-4 4 3 3-2 4 3" />
                      </svg>
                    </span>
                  </div>
                  <div className="h-2 w-1/2 rounded-full bg-muted" />
                </div>
              </div>

              {/* Code block — the dark anchor, hints at clean JSON output */}
              <div className="hero-card-d flex items-start gap-3 rounded-2xl border border-foreground/10 bg-foreground p-3.5 shadow-card transition-shadow duration-300 hover:shadow-card-hover">
                <BlockHandle tone="light" />
                <div className="flex-1 space-y-2">
                  <div className="flex gap-2">
                    <span className="h-2 w-12 rounded-full bg-chart-1" />
                    <span className="h-2 flex-1 rounded-full bg-background/20" />
                  </div>
                  <div className="flex gap-2 pl-4">
                    <span className="h-2 w-10 rounded-full bg-chart-4" />
                    <span className="h-2 flex-1 rounded-full bg-background/20" />
                  </div>
                  <div className="flex gap-2 pl-4">
                    <span className="h-2 w-16 rounded-full bg-chart-3" />
                    <span className="h-2 w-10 rounded-full bg-background/20" />
                  </div>
                  <div className="flex gap-2">
                    <span className="h-2 w-9 rounded-full bg-background/20" />
                    <span className="h-2 w-20 rounded-full bg-background/20" />
                  </div>
                </div>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
};
