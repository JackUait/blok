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
            {/* layered offset card behind — hovering its exposed edge drives the front card */}
            <div
              className="absolute inset-0 translate-x-4 translate-y-4 rounded-[2.25rem] border border-border bg-card/60 shadow-card transition-all duration-300 group-hover:translate-x-5 group-hover:translate-y-5"
              aria-hidden="true"
            />
            {/* morphing gradient halo — the "noodle" glow */}
            <div
              className="hero-blob pointer-events-none absolute -inset-3 -z-10 bg-brand-gradient opacity-30 blur-2xl transition-opacity duration-300 group-hover:opacity-40"
              aria-hidden="true"
            />
            <Link
              to="/demo"
              className="relative block w-72 max-w-full rounded-[2.25rem] border border-border bg-card p-5 shadow-card transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-card-hover sm:w-80"
              aria-label={t('home.hero.mascotAriaLabel')}
            >
              {/* soft brand stage behind the editor window */}
              <div
                className="hero-blob pointer-events-none absolute left-1/2 top-1/2 -z-0 size-56 -translate-x-1/2 -translate-y-1/2 bg-brand-gradient opacity-[0.12] blur-2xl"
                aria-hidden="true"
              />

              {/* faux Blok editor window — sells the block-based product */}
              <div
                className="relative overflow-hidden rounded-2xl border border-border bg-background/85 text-left backdrop-blur-sm"
                aria-hidden="true"
              >
                {/* window chrome */}
                <div className="flex items-center gap-1.5 border-b border-border/70 px-3.5 py-2.5">
                  <span className="size-2.5 rounded-full bg-chart-3/70" />
                  <span className="size-2.5 rounded-full bg-chart-4/70" />
                  <span className="size-2.5 rounded-full bg-chart-5/40" />
                  <span className="ml-2 h-2 w-16 rounded-full bg-muted" />
                </div>

                {/* editor blocks */}
                <div className="space-y-3.5 px-4 py-4">
                  {/* heading block with hover affordances (handle + plus) */}
                  <div className="relative flex items-center gap-2">
                    <div className="flex items-center gap-1 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                      <span className="flex size-4 items-center justify-center rounded-[5px] border border-border text-muted-foreground">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </span>
                      <svg width="8" height="14" viewBox="0 0 6 14" className="fill-muted-foreground/50">
                        <circle cx="1.5" cy="2" r="1.3" />
                        <circle cx="4.5" cy="2" r="1.3" />
                        <circle cx="1.5" cy="7" r="1.3" />
                        <circle cx="4.5" cy="7" r="1.3" />
                        <circle cx="1.5" cy="12" r="1.3" />
                        <circle cx="4.5" cy="12" r="1.3" />
                      </svg>
                    </div>
                    <div className="h-3.5 w-36 rounded-md bg-brand-gradient" />
                  </div>

                  {/* paragraph skeleton */}
                  <div className="space-y-2 pl-1">
                    <div className="h-2.5 w-full rounded-full bg-muted" />
                    <div className="h-2.5 w-11/12 rounded-full bg-muted" />
                    <div className="h-2.5 w-2/3 rounded-full bg-muted" />
                  </div>

                  {/* active empty block with blinking caret */}
                  <div className="flex h-4 items-center pl-1">
                    <span className="hero-caret h-4 w-px bg-foreground" />
                  </div>
                </div>

                {/* slash-command menu popover — the block-based "wow" */}
                <div className="absolute -right-6 bottom-3 w-40 rounded-xl border border-border bg-card p-1.5 shadow-card-hover transition-transform duration-300 group-hover:-translate-y-1">
                  <div className="px-1.5 pb-1 pt-0.5 font-mono text-[10px] font-semibold text-primary">
                    /
                  </div>
                  {[
                    { c: 'bg-chart-1', w: 'w-12' },
                    { c: 'bg-chart-2', w: 'w-16' },
                    { c: 'bg-chart-4', w: 'w-10' },
                  ].map((row, i) => (
                    <div
                      key={row.c}
                      className={`flex items-center gap-2 rounded-lg px-1.5 py-1 ${i === 0 ? 'bg-muted' : ''}`}
                    >
                      <span className={`size-4 rounded-md ${row.c} opacity-80`} />
                      <span className={`h-1.5 ${row.w} rounded-full bg-muted`} />
                    </div>
                  ))}
                </div>
              </div>

              {/* CTA */}
              <span className="relative mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-transform duration-300 group-hover:scale-[1.02]">
                {t('home.hero.ctaTryItOut')}
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  aria-hidden="true"
                  className="transition-transform duration-300 group-hover:translate-x-0.5"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
};
