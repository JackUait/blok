import { Link } from "react-router-dom";
import { SectionReveal } from "../common/SectionReveal";
import { HalftoneDots } from "../common/HalftoneDots";
import { useI18n } from "../../contexts/I18nContext";
import { Button } from "@/components/ui/button";

export const DocsCtaCard: React.FC = () => {
  const { t } = useI18n();
  return (
    <section className="pb-24 pt-4" data-blok-testid="docs-cta-section">
      <SectionReveal className="mx-auto w-full max-w-6xl px-6">
        <div
          className="relative overflow-hidden rounded-[2rem] border border-black/[0.06] bg-card shadow-card dark:border-white/[0.08]"
          data-blok-testid="docs-cta-card"
        >
          <div
            className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-primary/[0.07] blur-3xl"
            aria-hidden="true"
          />

          {/* Comic-style halftone dot field — an interactive canvas whose dots
              the cursor pushes away as a shape-shifting blob (see HalftoneDots) */}
          <HalftoneDots className="text-foreground/[0.08]" />

          <div className="relative px-6 py-10 sm:p-12 lg:p-16">
            <div className="mx-auto max-w-2xl text-center" data-blok-testid="docs-cta-content">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl" data-blok-testid="docs-cta-title">
                {t('home.docsCta.title')}
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground" data-blok-testid="docs-cta-description">
                {t('home.docsCta.description')}
              </p>
              <div className="mt-8 flex justify-center">
                <Button variant="brand" size="lg" asChild className="group/docs w-full sm:w-auto">
                  <Link to="/docs">
                    {t('home.docsCta.cta')}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="transition-transform duration-300 ease-out group-hover/docs:translate-x-1">
                      <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </SectionReveal>
    </section>
  );
};
