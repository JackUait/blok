import { Link } from "react-router-dom";
import { CodeBlock } from "../common/CodeBlock";
import { useI18n } from "../../contexts/I18nContext";
import { Button } from "@/components/ui/button";

const MIGRATION_COMMAND = "npx -p @jackuait/blok migrate-from-editorjs ./src";

export const MigrationCard: React.FC = () => {
  const { t } = useI18n();
  return (
    <section className="pb-24 pt-4" data-blok-testid="migration-section">
      <div className="mx-auto w-full max-w-6xl px-6">
        <div
          className="relative overflow-hidden rounded-[2rem] border border-border bg-card p-8 shadow-card sm:p-12"
          data-blok-testid="migration-card"
        >
          {/* Decorative background wash */}
          <div
            className="pointer-events-none absolute -right-16 -top-16 size-72 rounded-full bg-primary/10 blur-3xl"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute -bottom-20 -left-10 size-72 rounded-full bg-chart-3/10 blur-3xl"
            aria-hidden="true"
          />

          <div
            className="relative mx-auto max-w-2xl text-center"
            data-blok-testid="migration-content"
          >
            <div
              className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wide text-primary"
              data-blok-testid="migration-badge"
            >
              <span className="inline-flex" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" fill="currentColor" />
                </svg>
              </span>
              {t('home.migrationCard.badge')}
            </div>

            <h2
              className="mt-5 text-3xl font-extrabold tracking-tight sm:text-4xl"
              data-blok-testid="migration-title"
            >
              {t('home.migrationCard.title')}
            </h2>

            <p
              className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground"
              data-blok-testid="migration-description"
            >
              {t('home.migrationCard.description')}
            </p>

            <div className="mx-auto mt-8 max-w-xl text-left" data-blok-testid="migration-code">
              <CodeBlock code={MIGRATION_COMMAND} language="bash" />
            </div>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button variant="brand" size="lg" asChild>
                <Link to="/migration">
                  {t('home.migrationCard.viewGuide')}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <a
                  href="https://github.com/jackuait/blok/tree/master/codemod"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0012 2z" fill="currentColor" />
                  </svg>
                  {t('home.migrationCard.viewCodemod')}
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
