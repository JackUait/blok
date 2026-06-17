import { useEffect, useMemo, useRef, useState } from "react";
import { FeatureModal, type FeatureDetail } from "./FeatureModal";
import { useI18n } from "../../contexts/I18nContext";

export const Features: React.FC = () => {
  const { t } = useI18n();
  const sectionRef = useRef<HTMLElement>(null);
  const [selectedFeature, setSelectedFeature] = useState<FeatureDetail | null>(
    null,
  );

  const FEATURES = useMemo<FeatureDetail[]>(() => [
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          {/* JSON braces */}
          <path
            d="M12 8L8 16l4 8"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M20 8l4 8-4 8"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
      title: t('home.features.cleanJson.title'),
      description: t('home.features.cleanJson.description'),
      learnMore: t('home.features.cleanJson.learnMore'),
      accent: "coral",
      details: {
        summary: t('home.features.cleanJson.details.summary'),
        benefits: [
          t('home.features.cleanJson.details.benefit1'),
          t('home.features.cleanJson.details.benefit2'),
          t('home.features.cleanJson.details.benefit3'),
          t('home.features.cleanJson.details.benefit4'),
        ],
        codeExample: `const data = await editor.save();
// { blocks: [{ type: "paragraph", data: { text: "Hello" } }] }`,
        apiLink: "/docs#core",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          {/* Command palette / menu box with slash */}
          <rect
            x="6"
            y="8"
            width="20"
            height="16"
            rx="3"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M18 12L14 20"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      ),
      title: t('home.features.slashCommands.title'),
      description: t('home.features.slashCommands.description'),
      learnMore: t('home.features.slashCommands.learnMore'),
      accent: "orange",
      details: {
        summary: t('home.features.slashCommands.details.summary'),
        benefits: [
          t('home.features.slashCommands.details.benefit1'),
          t('home.features.slashCommands.details.benefit2'),
          t('home.features.slashCommands.details.benefit3'),
          t('home.features.slashCommands.details.benefit4'),
        ],
        codeExample: `// Configure custom toolbox items
new Blok({
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
          {/* Bold A with underline - text formatting */}
          <text
            x="16"
            y="20"
            textAnchor="middle"
            fontSize="14"
            fontWeight="bold"
            fill="currentColor"
          >
            A
          </text>
          <path
            d="M10 24h12"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      ),
      title: t('home.features.inlineToolbar.title'),
      description: t('home.features.inlineToolbar.description'),
      learnMore: t('home.features.inlineToolbar.learnMore'),
      accent: "pink",
      details: {
        summary: t('home.features.inlineToolbar.details.summary'),
        benefits: [
          t('home.features.inlineToolbar.details.benefit1'),
          t('home.features.inlineToolbar.details.benefit2'),
          t('home.features.inlineToolbar.details.benefit3'),
          t('home.features.inlineToolbar.details.benefit4'),
        ],
        codeExample: `// Add custom inline tool
new Blok({
  tools: {
    highlight: {
      class: HighlightTool,
      inlineToolbar: true
    }
  }
});`,
        apiLink: "/docs#inline-toolbar-api",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          {/* Drag handle dots */}
          <circle cx="12" cy="10" r="2" fill="currentColor" />
          <circle cx="20" cy="10" r="2" fill="currentColor" />
          <circle cx="12" cy="16" r="2" fill="currentColor" />
          <circle cx="20" cy="16" r="2" fill="currentColor" />
          <circle cx="12" cy="22" r="2" fill="currentColor" opacity="0.5" />
          <circle cx="20" cy="22" r="2" fill="currentColor" opacity="0.5" />
        </svg>
      ),
      title: t('home.features.dragDrop.title'),
      description: t('home.features.dragDrop.description'),
      learnMore: t('home.features.dragDrop.learnMore'),
      accent: "mauve",
      details: {
        summary: t('home.features.dragDrop.details.summary'),
        benefits: [
          t('home.features.dragDrop.details.benefit1'),
          t('home.features.dragDrop.details.benefit2'),
          t('home.features.dragDrop.details.benefit3'),
          t('home.features.dragDrop.details.benefit4'),
        ],
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          {/* Stacked blocks - building blocks */}
          <rect
            x="6"
            y="6"
            width="10"
            height="8"
            rx="2"
            stroke="currentColor"
            strokeWidth="2"
          />
          <rect
            x="16"
            y="10"
            width="10"
            height="8"
            rx="2"
            stroke="currentColor"
            strokeWidth="2"
          />
          <rect
            x="8"
            y="18"
            width="10"
            height="8"
            rx="2"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      ),
      title: t('home.features.customBlocks.title'),
      description: t('home.features.customBlocks.description'),
      learnMore: t('home.features.customBlocks.learnMore'),
      accent: "green",
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
          {/* Eye icon - view only */}
          <path
            d="M4 16s4-8 12-8 12 8 12 8-4 8-12 8-12-8-12-8z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle cx="16" cy="16" r="4" stroke="currentColor" strokeWidth="2" />
        </svg>
      ),
      title: t('home.features.readOnly.title'),
      description: t('home.features.readOnly.description'),
      learnMore: t('home.features.readOnly.learnMore'),
      accent: "purple",
      details: {
        summary: t('home.features.readOnly.details.summary'),
        benefits: [
          t('home.features.readOnly.details.benefit1'),
          t('home.features.readOnly.details.benefit2'),
          t('home.features.readOnly.details.benefit3'),
          t('home.features.readOnly.details.benefit4'),
        ],
        codeExample: `// Set read-only mode
await editor.readOnly.set(true);

// Disable read-only
await editor.readOnly.set(false);

// Check current state
console.log(editor.readOnly.isEnabled);`,
        apiLink: "/docs#readonly-api",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          {/* Undo/Redo curved arrows */}
          <path
            d="M10 16a6 6 0 0 1 6-6h2"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M16 7l3 3-3 3"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M22 16a6 6 0 0 1-6 6h-2"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.5"
          />
          <path
            d="M16 25l-3-3 3-3"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.5"
          />
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
        apiLink: "/docs#blocks-api",
      },
    },
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          {/* Globe / language icon */}
          <circle cx="16" cy="16" r="9" stroke="currentColor" strokeWidth="2" />
          <ellipse
            cx="16"
            cy="16"
            rx="4"
            ry="9"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M8 12h16M8 20h16"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      ),
      title: t('home.features.languages.title'),
      description: t('home.features.languages.description'),
      learnMore: t('home.features.languages.learnMore'),
      accent: "cyan",
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
    {
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          {/* Clipboard */}
          <rect
            x="8"
            y="6"
            width="16"
            height="20"
            rx="2"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M12 6V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M12 13h8M12 17h6M12 21h7"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.6"
          />
        </svg>
      ),
      title: t('home.features.smartPaste.title'),
      description: t('home.features.smartPaste.description'),
      learnMore: t('home.features.smartPaste.learnMore'),
      accent: "blue",
      details: {
        summary: t('home.features.smartPaste.details.summary'),
        benefits: [
          t('home.features.smartPaste.details.benefit1'),
          t('home.features.smartPaste.details.benefit2'),
          t('home.features.smartPaste.details.benefit3'),
          t('home.features.smartPaste.details.benefit4'),
        ],
      },
    },
  ], [t]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("features-visible");
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -50px 0px" },
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

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
      ref={sectionRef}
      aria-label={t('home.features.sectionLabel')}
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-bold uppercase tracking-wide text-primary">
            {t('home.features.eyebrow')}
          </span>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
            <span className="block">{t('home.features.title1')}</span>
            <span className="block">{t('home.features.title2')}</span>
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            {t('home.features.description')}
          </p>
        </div>
        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <button
              type="button"
              key={feature.accent}
              className="group flex flex-col items-start gap-4 rounded-2xl border border-border bg-card p-6 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-feature-card
              style={{ "--animation-order": index } as React.CSSProperties}
              onClick={() => handleFeatureClick(feature)}
              aria-label={feature.learnMore}
            >
              <div className="flex size-12 items-center justify-center rounded-xl bg-secondary text-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                {feature.icon}
              </div>
              <h3 className="text-lg font-bold tracking-tight">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
              <span className="mt-auto inline-flex items-center gap-1 pt-2 text-sm font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100">
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
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </span>
            </button>
          ))}
        </div>
      </div>

      <FeatureModal feature={selectedFeature} onClose={handleCloseModal} />
    </section>
  );
};
