import { SectionReveal } from "../common/SectionReveal";
import { CodeBlock } from "../common/CodeBlock";
import { useI18n } from "../../contexts/I18nContext";

/** One integration entry point Blok actually ships in this package. */
interface FrameworkEntry {
  /** Stable id used for the per-card test hook and React key. */
  id: "vanilla" | "react" | "cdn";
  /** i18n key suffix under home.frameworks (e.g. "vanilla" → vanillaName). */
  key: "vanilla" | "react" | "cdn";
  /** Shiki language for the snippet. */
  language: string;
  /** The runnable snippet shown in the card. */
  code: string;
  /** Inline brand glyph. */
  icon: React.ReactNode;
}

// React atom glyph.
const ReactGlyph: React.FC = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="2" fill="currentColor" />
    <g stroke="currentColor" strokeWidth="1" fill="none">
      <ellipse cx="12" cy="12" rx="10" ry="4" />
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)" />
    </g>
  </svg>
);

// JS/TS "code" glyph — angle brackets.
const CodeGlyph: React.FC = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

// CDN / globe glyph.
const GlobeGlyph: React.FC = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z" />
  </svg>
);

const FRAMEWORKS: FrameworkEntry[] = [
  {
    id: "vanilla",
    key: "vanilla",
    language: "javascript",
    code: `import { Blok, defaultTools } from '@jackuait/blok/full';

new Blok({
  holder: 'editor',
  tools: defaultTools,
});`,
    icon: <CodeGlyph />,
  },
  {
    id: "react",
    key: "react",
    language: "jsx",
    code: `import { useBlok, BlokContent } from '@jackuait/blok/react';
import { defaultTools } from '@jackuait/blok/full';

function Editor() {
  const editor = useBlok({ tools: defaultTools });
  return <BlokContent editor={editor} />;
}`,
    icon: <ReactGlyph />,
  },
  {
    id: "cdn",
    key: "cdn",
    language: "html",
    code: `<div id="editor"></div>
<script src="https://unpkg.com/@jackuait/blok/dist/blok.iife.js"></script>
<script>
  new BlokEditor.Blok({ holder: 'editor' });
</script>`,
    icon: <GlobeGlyph />,
  },
];

/**
 * "Drop Blok into your stack" — three cards, one per supported entry point
 * (framework-agnostic core, the React adapter, and the CDN/IIFE build). Each
 * card carries a runnable snippet that mirrors the real published API so a
 * newcomer can copy it straight into their project.
 */
export const FrameworkCards: React.FC = () => {
  const { t } = useI18n();

  return (
    <section
      className="py-20 sm:py-24"
      aria-label={t("home.frameworks.sectionLabel")}
      data-blok-testid="frameworks-section"
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <SectionReveal className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            {t("home.frameworks.sectionLabel")}
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            <span className="block">{t("home.frameworks.title1")}</span>
            <span className="block">{t("home.frameworks.title2")}</span>
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            {t("home.frameworks.description")}
          </p>
        </SectionReveal>

        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {FRAMEWORKS.map((framework) => (
            <SectionReveal
              key={framework.id}
              className="flex h-full flex-col overflow-hidden rounded-3xl border border-black/[0.06] bg-card shadow-card dark:border-white/[0.08]"
            >
              <div className="flex h-full flex-col" data-blok-testid="framework-card">
                {/* A nested per-id hook lets tests target a single card. */}
                <div data-blok-testid={`framework-card-${framework.id}`} className="flex h-full flex-col">
                  <div className="flex items-center gap-3 px-6 pt-6">
                    <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/[0.08] text-primary">
                      {framework.icon}
                    </span>
                    <div>
                      <h3 className="text-base font-bold tracking-tight text-foreground">
                        {t(`home.frameworks.${framework.key}Name`)}
                      </h3>
                      <p className="text-xs font-medium text-muted-foreground">
                        {t(`home.frameworks.${framework.key}Tagline`)}
                      </p>
                    </div>
                  </div>

                  <p className="px-6 pt-3 text-sm leading-relaxed text-muted-foreground">
                    {t(`home.frameworks.${framework.key}Description`)}
                  </p>

                  <div className="mt-4 px-3 pb-4">
                    <CodeBlock code={framework.code} language={framework.language} />
                  </div>
                </div>
              </div>
            </SectionReveal>
          ))}
        </div>
      </div>
    </section>
  );
};
