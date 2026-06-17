import { useMemo, useState } from "react";
import { FeatureModal, type FeatureDetail } from "./FeatureModal";
import { useI18n } from "../../contexts/I18nContext";

export const Features: React.FC = () => {
  const { t } = useI18n();
  const [selectedFeature, setSelectedFeature] = useState<FeatureDetail | null>(
    null,
  );

  const FEATURES = useMemo<FeatureDetail[]>(() => [
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          {/* JSON braces */}
          <path d="M12 8L8 16l4 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M20 8l4 8-4 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      title: t('home.features.cleanJson.title'),
      description: t('home.features.cleanJson.description'),
      learnMore: t('home.features.cleanJson.learnMore'),
      accent: "coral",
      tier: "primary",
      details: {
        summary: t('home.features.cleanJson.details.summary'),
        benefits: [
          t('home.features.cleanJson.details.benefit1'),
          t('home.features.cleanJson.details.benefit2'),
          t('home.features.cleanJson.details.benefit3'),
          t('home.features.cleanJson.details.benefit4'),
        ],
        codeExample: `const data = await editor.save();
// { blocks: [{ id: "x1", type: "paragraph", data: { text: "Hello" } }] }`,
        apiLink: "/docs#saver-api",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          {/* Stacked blocks — the block library */}
          <rect x="6" y="6" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
          <rect x="16" y="10" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
          <rect x="8" y="18" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="2" />
        </svg>
      ),
      title: t('home.features.blockLibrary.title'),
      description: t('home.features.blockLibrary.description'),
      learnMore: t('home.features.blockLibrary.learnMore'),
      accent: "green",
      tier: "primary",
      details: {
        summary: t('home.features.blockLibrary.details.summary'),
        benefits: [
          t('home.features.blockLibrary.details.benefit1'),
          t('home.features.blockLibrary.details.benefit2'),
          t('home.features.blockLibrary.details.benefit3'),
          t('home.features.blockLibrary.details.benefit4'),
        ],
        codeExample: `import Blok from '@jackuait/blok/full';

// Tables, databases, columns, code, media and embeds — all registered
new Blok({ holder: 'editor' });`,
        apiLink: "/tools",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          {/* Dashed frame + plus — bring your own block */}
          <rect x="6" y="6" width="20" height="20" rx="4" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" />
          <path d="M16 11v10M11 16h10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      ),
      title: t('home.features.customBlocks.title'),
      description: t('home.features.customBlocks.description'),
      learnMore: t('home.features.customBlocks.learnMore'),
      accent: "orange",
      tier: "primary",
      details: {
        summary: t('home.features.customBlocks.details.summary'),
        benefits: [
          t('home.features.customBlocks.details.benefit1'),
          t('home.features.customBlocks.details.benefit2'),
          t('home.features.customBlocks.details.benefit3'),
          t('home.features.customBlocks.details.benefit4'),
        ],
        codeExample: `class MyTool {
  static get toolbox() {
    return { title: 'My Tool', icon: '<svg>...</svg>' };
  }
  render() { return document.createElement('div'); }
  save(element) { return { text: element.innerHTML }; }
}`,
        apiLink: "/docs#tools-api",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          {/* Menu box with slash */}
          <rect x="6" y="8" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="2" />
          <path d="M18 12L14 20" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      ),
      title: t('home.features.slashCommands.title'),
      description: t('home.features.slashCommands.description'),
      learnMore: t('home.features.slashCommands.learnMore'),
      accent: "pink",
      details: {
        summary: t('home.features.slashCommands.details.summary'),
        benefits: [
          t('home.features.slashCommands.details.benefit1'),
          t('home.features.slashCommands.details.benefit2'),
          t('home.features.slashCommands.details.benefit3'),
          t('home.features.slashCommands.details.benefit4'),
        ],
        codeExample: `new Blok({
  tools: {
    myBlock: {
      class: MyBlockTool,
      toolbox: { title: 'My Block', icon: '<svg>...</svg>' }
    }
  }
});`,
        apiLink: "/docs#toolbar-api",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          {/* Kanban columns */}
          <rect x="5" y="6" width="6" height="20" rx="1.5" stroke="currentColor" strokeWidth="2" />
          <rect x="13" y="6" width="6" height="13" rx="1.5" stroke="currentColor" strokeWidth="2" />
          <rect x="21" y="6" width="6" height="16" rx="1.5" stroke="currentColor" strokeWidth="2" />
        </svg>
      ),
      title: t('home.features.databases.title'),
      description: t('home.features.databases.description'),
      learnMore: t('home.features.databases.learnMore'),
      accent: "purple",
      details: {
        summary: t('home.features.databases.details.summary'),
        benefits: [
          t('home.features.databases.details.benefit1'),
          t('home.features.databases.details.benefit2'),
          t('home.features.databases.details.benefit3'),
          t('home.features.databases.details.benefit4'),
        ],
        apiLink: "/tools#database",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          {/* Table grid */}
          <rect x="5" y="7" width="22" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
          <path d="M5 13h22M5 19h22M13 7v18M20 7v18" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ),
      title: t('home.features.tables.title'),
      description: t('home.features.tables.description'),
      learnMore: t('home.features.tables.learnMore'),
      accent: "cyan",
      details: {
        summary: t('home.features.tables.details.summary'),
        benefits: [
          t('home.features.tables.details.benefit1'),
          t('home.features.tables.details.benefit2'),
          t('home.features.tables.details.benefit3'),
          t('home.features.tables.details.benefit4'),
        ],
        apiLink: "/tools#table",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          {/* Embed frame with play */}
          <rect x="5" y="7" width="22" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
          <path d="M14 12.5l5.5 3.5-5.5 3.5z" fill="currentColor" />
        </svg>
      ),
      title: t('home.features.embeds.title'),
      description: t('home.features.embeds.description'),
      learnMore: t('home.features.embeds.learnMore'),
      accent: "blue",
      details: {
        summary: t('home.features.embeds.details.summary'),
        benefits: [
          t('home.features.embeds.details.benefit1'),
          t('home.features.embeds.details.benefit2'),
          t('home.features.embeds.details.benefit3'),
          t('home.features.embeds.details.benefit4'),
        ],
        apiLink: "/tools#embed",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          {/* Undo / redo arrows */}
          <path d="M10 16a6 6 0 0 1 6-6h2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M16 7l3 3-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M22 16a6 6 0 0 1-6 6h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
          <path d="M16 25l-3-3 3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
        </svg>
      ),
      title: t('home.features.undoRedo.title'),
      description: t('home.features.undoRedo.description'),
      learnMore: t('home.features.undoRedo.learnMore'),
      accent: "yellow",
      details: {
        summary: t('home.features.undoRedo.details.summary'),
        benefits: [
          t('home.features.undoRedo.details.benefit1'),
          t('home.features.undoRedo.details.benefit2'),
          t('home.features.undoRedo.details.benefit3'),
          t('home.features.undoRedo.details.benefit4'),
        ],
        apiLink: "/docs#history-api",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          {/* Globe */}
          <circle cx="16" cy="16" r="9" stroke="currentColor" strokeWidth="2" />
          <ellipse cx="16" cy="16" rx="4" ry="9" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 12h16M8 20h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ),
      title: t('home.features.languages.title'),
      description: t('home.features.languages.description'),
      learnMore: t('home.features.languages.learnMore'),
      accent: "mauve",
      details: {
        summary: t('home.features.languages.details.summary'),
        benefits: [
          t('home.features.languages.details.benefit1'),
          t('home.features.languages.details.benefit2'),
          t('home.features.languages.details.benefit3'),
          t('home.features.languages.details.benefit4'),
        ],
        codeExample: `new Blok({
  i18n: { locale: 'ar' } // Arabic with RTL
});`,
        apiLink: "/docs#i18n-api",
      },
    },
  ], [t]);

  const primaryFeatures = FEATURES.filter((f) => f.tier === "primary");
  const secondaryFeatures = FEATURES.filter((f) => f.tier !== "primary");

  const handleFeatureClick = (feature: FeatureDetail) => {
    setSelectedFeature(feature);
  };

  const handleCloseModal = () => {
    setSelectedFeature(null);
  };

  return (
    <section
      className="relative py-20 sm:py-28"
      id="features"
      aria-label={t('home.features.sectionLabel')}
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            <span className="block">{t('home.features.title1')}</span>
            <span className="block">{t('home.features.title2')}</span>
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            {t('home.features.description')}
          </p>
        </div>

        {/* The three pillars that define Blok — large, scanned first. */}
        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
          {primaryFeatures.map((feature) => (
            <button
              type="button"
              key={feature.accent}
              className="group flex flex-col items-start gap-5 rounded-2xl border border-border bg-card p-7 text-left shadow-sm transition-all hover:-translate-y-1 hover:border-foreground/15 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => handleFeatureClick(feature)}
              aria-label={feature.learnMore}
            >
              <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                {feature.icon}
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold tracking-tight">
                  {feature.title}
                </h3>
                <p className="text-[15px] leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </div>
              <span className="mt-auto inline-flex items-center gap-1.5 pt-2 text-sm font-semibold text-primary">
                <span className="opacity-70 transition-opacity group-hover:opacity-100">
                  {t('home.features.learnMoreLabel')}
                </span>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="transition-transform group-hover:translate-x-0.5"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </span>
            </button>
          ))}
        </div>

        {/* Supporting capabilities — compact, scanned second. */}
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {secondaryFeatures.map((feature) => (
            <button
              type="button"
              key={feature.accent}
              className="group flex items-start gap-4 rounded-xl border border-border bg-card p-5 text-left shadow-sm transition-all hover:border-foreground/15 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => handleFeatureClick(feature)}
              aria-label={feature.learnMore}
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                {feature.icon}
              </div>
              <div>
                <h3 className="text-base font-bold tracking-tight">
                  {feature.title}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <FeatureModal feature={selectedFeature} onClose={handleCloseModal} />
    </section>
  );
};
