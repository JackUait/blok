import { useState } from "react";
import { SectionReveal } from "../common/SectionReveal";
import { CodeBlock } from "../common/CodeBlock";
import { useI18n } from "../../contexts/I18nContext";
import { cn } from "@/lib/utils";
// Official brand artwork (devicon), used verbatim as image assets.
import typescriptLogo from "../../assets/logos/typescript.svg";
import reactLogo from "../../assets/logos/react.svg";
import vueLogo from "../../assets/logos/vue.svg";
import angularLogo from "../../assets/logos/angular.svg";

/** One integration entry point Blok actually ships in this package. */
interface FrameworkEntry {
  /** Stable id used for the per-row test hook and React key. */
  id: "vanilla" | "react" | "vue" | "angular" | "cdn";
  /** i18n key suffix under home.frameworks (e.g. "vanilla" → vanillaName). */
  key: "vanilla" | "react" | "vue" | "angular" | "cdn";
  /** Shiki language for the snippet. */
  language: string;
  /** The runnable snippet shown when the row is expanded. */
  code: string;
  /** Official full-colour brand SVG asset; omitted for the brand-less CDN entry. */
  logoSrc?: string;
  /** Monochrome mark drawn in `currentColor` for the white-on-brand open state. */
  mono: React.ReactNode;
  /** CSS background painted into the icon tile while the row is open. */
  brand: string;
}

/**
 * The icon tile's mark. The full-colour brand logo (closed) and the monochrome
 * mark (open, white-on-brand) are stacked and cross-faded, so opening a row
 * dissolves one into the other instead of hard-swapping nodes. The monochrome
 * mark keeps its negative space (the TS letters, the Vue notch) crisp where a
 * flat image-invert would not. Entries without a colour logo (CDN) just tint
 * their single mark from muted to white as the tile fills.
 */
const FrameworkIcon: React.FC<{ framework: FrameworkEntry; open: boolean }> = ({
  framework,
  open,
}) => (
  <span className="relative grid size-6 place-items-center">
    {framework.logoSrc && (
      <img
        src={framework.logoSrc}
        alt=""
        aria-hidden="true"
        draggable={false}
        className={cn(
          "col-start-1 row-start-1 size-6 select-none transition-[opacity,transform] duration-[450ms] ease-[cubic-bezier(0.33,1,0.68,1)] motion-reduce:transition-none",
          // The TS badge is a full-bleed square; soften its corners. Other marks
          // have transparent bounds (and shapes that reach the corners), so this
          // is scoped to the TS logo only.
          framework.id === "vanilla" && "rounded-[4px]",
          open ? "scale-90 opacity-0" : "scale-100 opacity-100",
        )}
      />
    )}
    <span
      aria-hidden="true"
      className={cn(
        "col-start-1 row-start-1 flex transition-[opacity,transform] duration-[450ms] ease-[cubic-bezier(0.33,1,0.68,1)] motion-reduce:transition-none",
        // The colour logo owns the closed state, so its mark stays hidden until
        // open; CDN has no colour logo, so its mark is always shown.
        open || !framework.logoSrc ? "scale-100 opacity-100" : "scale-90 opacity-0",
      )}
    >
      {framework.mono}
    </span>
  </span>
);

// Monochrome marks (simple-icons) for the white-on-brand open state. They render
// in `currentColor`, so the tile's white text colour whites them out cleanly.
const monoSvgProps = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "currentColor",
  "aria-hidden": true,
} as const;

const TsMark: React.FC = () => (
  <svg {...monoSvgProps}>
    <path d="M4.36 0C1.952 0 0 1.952 0 4.36V19.64C0 22.048 1.952 24 4.36 24H19.64C22.048 24 24 22.048 24 19.64V4.36C24 1.952 22.048 0 19.64 0zM18.488 9.75c.612 0 1.154.037 1.627.111a6.38 6.38 0 0 1 1.306.34v2.458a3.95 3.95 0 0 0-.643-.361 5.093 5.093 0 0 0-.717-.26 5.453 5.453 0 0 0-1.426-.2c-.3 0-.573.028-.819.086a2.1 2.1 0 0 0-.623.242c-.17.104-.3.229-.393.374a.888.888 0 0 0-.14.49c0 .196.053.373.156.529.104.156.252.304.443.444s.423.276.696.41c.273.135.582.274.926.416.47.197.892.407 1.266.628.374.222.695.473.963.753.268.279.472.598.614.957.142.359.214.776.214 1.253 0 .657-.125 1.21-.373 1.656a3.033 3.033 0 0 1-1.012 1.085 4.38 4.38 0 0 1-1.487.596c-.566.12-1.163.18-1.79.18a9.916 9.916 0 0 1-1.84-.164 5.544 5.544 0 0 1-1.512-.493v-2.63a5.033 5.033 0 0 0 3.237 1.2c.333 0 .624-.03.872-.09.249-.06.456-.144.623-.25.166-.108.29-.234.373-.38a1.023 1.023 0 0 0-.074-1.089 2.12 2.12 0 0 0-.537-.5 5.597 5.597 0 0 0-.807-.444 27.72 27.72 0 0 0-1.007-.436c-.918-.383-1.602-.852-2.053-1.405-.45-.553-.676-1.222-.676-2.005 0-.614.123-1.141.369-1.582.246-.441.58-.804 1.004-1.089a4.494 4.494 0 0 1 1.47-.629 7.536 7.536 0 0 1 1.77-.201zm-15.113.188h9.563v2.166H9.506v9.646H6.789v-9.646H3.375z" />
  </svg>
);

const ReactMark: React.FC = () => (
  <svg {...monoSvgProps}>
    <path d="M14.23 12.004a2.236 2.236 0 0 1-2.235 2.236 2.236 2.236 0 0 1-2.236-2.236 2.236 2.236 0 0 1 2.235-2.236 2.236 2.236 0 0 1 2.236 2.236zm2.648-10.69c-1.346 0-3.107.96-4.888 2.622-1.78-1.653-3.542-2.602-4.887-2.602-.41 0-.783.093-1.106.278-1.375.793-1.683 3.264-.973 6.365C1.98 8.917 0 10.42 0 12.004c0 1.59 1.99 3.097 5.043 4.03-.704 3.113-.39 5.588.988 6.38.32.187.69.275 1.102.275 1.345 0 3.107-.96 4.888-2.624 1.78 1.654 3.542 2.603 4.887 2.603.41 0 .783-.09 1.106-.275 1.374-.792 1.683-3.263.973-6.365C22.02 15.096 24 13.59 24 12.004c0-1.59-1.99-3.097-5.043-4.032.704-3.11.39-5.587-.988-6.38-.318-.184-.688-.277-1.092-.278zm-.005 1.09v.006c.225 0 .406.044.558.127.666.382.955 1.835.73 3.704-.054.46-.142.945-.25 1.44-.96-.236-2.006-.417-3.107-.534-.66-.905-1.345-1.727-2.035-2.447 1.592-1.48 3.087-2.292 4.105-2.295zm-9.77.02c1.012 0 2.514.808 4.11 2.28-.686.72-1.37 1.537-2.02 2.442-1.107.117-2.154.298-3.113.538-.112-.49-.195-.964-.254-1.42-.23-1.868.054-3.32.714-3.707.19-.09.4-.127.563-.132zm4.882 3.05c.455.468.91.992 1.36 1.564-.44-.02-.89-.034-1.345-.034-.46 0-.915.01-1.36.034.44-.572.895-1.096 1.345-1.565zM12 8.1c.74 0 1.477.034 2.202.093.406.582.802 1.203 1.183 1.86.372.64.71 1.29 1.018 1.946-.308.655-.646 1.31-1.013 1.95-.38.66-.773 1.288-1.18 1.87-.728.063-1.466.098-2.21.098-.74 0-1.477-.035-2.202-.093-.406-.582-.802-1.204-1.183-1.86-.372-.64-.71-1.29-1.018-1.946.303-.657.646-1.313 1.013-1.954.38-.66.773-1.286 1.18-1.868.728-.064 1.466-.098 2.21-.098zm-3.635.254c-.24.377-.48.763-.704 1.16-.225.39-.435.782-.635 1.174-.265-.656-.49-1.31-.676-1.947.64-.15 1.315-.283 2.015-.386zm7.26 0c.695.103 1.365.23 2.006.387-.18.632-.405 1.282-.66 1.933-.2-.39-.41-.783-.64-1.174-.225-.392-.465-.774-.705-1.146zm3.063.675c.484.15.944.317 1.375.498 1.732.74 2.852 1.708 2.852 2.476-.005.768-1.125 1.74-2.857 2.475-.42.18-.88.342-1.355.493-.28-.958-.646-1.956-1.1-2.98.45-1.017.81-2.01 1.085-2.964zm-13.395.004c.278.96.645 1.957 1.1 2.98-.45 1.017-.812 2.01-1.086 2.964-.484-.15-.944-.318-1.37-.5-1.732-.737-2.852-1.706-2.852-2.474 0-.768 1.12-1.742 2.852-2.476.42-.18.88-.342 1.356-.494zm11.678 4.28c.265.657.49 1.312.676 1.948-.64.157-1.316.29-2.016.39.24-.375.48-.762.705-1.158.225-.39.435-.788.636-1.18zm-9.945.02c.2.392.41.783.64 1.175.23.39.465.772.705 1.143-.695-.102-1.365-.23-2.006-.386.18-.63.406-1.282.66-1.933zM17.92 16.32c.112.493.2.968.254 1.423.23 1.868-.054 3.32-.714 3.708-.147.09-.338.128-.563.128-1.012 0-2.514-.807-4.11-2.28.686-.72 1.37-1.536 2.02-2.44 1.107-.118 2.154-.3 3.113-.54zm-11.83.01c.96.234 2.006.415 3.107.532.66.905 1.345 1.727 2.035 2.446-1.595 1.483-3.092 2.295-4.11 2.295-.22-.005-.406-.05-.553-.132-.666-.38-.955-1.834-.73-3.703.054-.46.142-.944.25-1.438zm4.56.64c.44.02.89.034 1.345.034.46 0 .915-.01 1.36-.034-.44.572-.895 1.095-1.345 1.565-.455-.47-.91-.993-1.36-1.565z" />
  </svg>
);

const VueMark: React.FC = () => (
  <svg {...monoSvgProps}>
    <path d="M24,1.61H14.06L12,5.16,9.94,1.61H0L12,22.39ZM12,14.08,5.16,2.23H9.59L12,6.41l2.41-4.18h4.43Z" />
  </svg>
);

const AngularMark: React.FC = () => (
  <svg {...monoSvgProps}>
    <path d="M16.712 17.711H7.288l-1.204 2.916L12 24l5.916-3.373-1.204-2.916ZM14.692 0l7.832 16.855.814-12.856L14.692 0ZM9.308 0 .662 3.999l.814 12.856L9.308 0Zm-.405 13.93h6.198L12 6.396 8.903 13.93Z" />
  </svg>
);

// CDN — no brand, so a refined globe drawn in the current text color (muted when
// closed, white once the tile fills on open).
const GlobeMark: React.FC = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9.5" />
    <path d="M2.5 12h19" />
    <path d="M12 2.5a14.6 14.6 0 0 1 3.8 9.5A14.6 14.6 0 0 1 12 21.5 14.6 14.6 0 0 1 8.2 12 14.6 14.6 0 0 1 12 2.5Z" />
  </svg>
);

// Disclosure chevron — rotates when the row is open.
const ChevronGlyph: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="6 9 12 15 18 9" />
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
    logoSrc: typescriptLogo,
    mono: <TsMark />,
    brand: "#3178c6",
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
    logoSrc: reactLogo,
    mono: <ReactMark />,
    brand: "#149eca",
  },
  {
    id: "vue",
    key: "vue",
    language: "vue",
    code: `<script setup>
import { useBlok, BlokContent } from '@jackuait/blok/vue';
import { defaultTools } from '@jackuait/blok/full';

const editor = useBlok({ tools: defaultTools });
</script>

<template>
  <BlokContent :editor="editor" />
</template>`,
    logoSrc: vueLogo,
    mono: <VueMark />,
    brand: "#41b883",
  },
  {
    id: "angular",
    key: "angular",
    language: "typescript",
    code: `import { Component } from '@angular/core';
import { BlokEditorComponent } from '@jackuait/blok/angular';
import { defaultTools } from '@jackuait/blok/full';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [BlokEditorComponent],
  template: \`<blok-editor [tools]="tools" />\`,
})
export class EditorComponent {
  tools = defaultTools;
}`,
    logoSrc: angularLogo,
    mono: <AngularMark />,
    brand: "linear-gradient(140deg, #e40035 0%, #c501a0 52%, #6c00f5 100%)",
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
    mono: <GlobeMark />,
    brand: "var(--primary)",
  },
];

/**
 * "Drop Blok into your stack" — an accordion, one row per supported entry point
 * (framework-agnostic core, the React / Vue / Angular adapters, and the CDN/IIFE
 * build). Every row starts collapsed and expands independently — open as many as
 * you like to compare — and each reveals a runnable snippet that mirrors the real
 * published API so a newcomer can copy it straight into their project.
 */
export const FrameworkCards: React.FC = () => {
  const { t } = useI18n();
  // Each row toggles on its own; all start collapsed so the reader picks what
  // to reveal.
  const [openIds, setOpenIds] = useState<Set<FrameworkEntry["id"]>>(
    () => new Set(),
  );

  const toggle = (id: FrameworkEntry["id"]): void => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <section
      className="pb-12 pt-4 sm:pb-14 sm:pt-4"
      aria-label={t("home.frameworks.sectionLabel")}
      data-blok-testid="frameworks-section"
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <SectionReveal className="max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            <span className="block">{t("home.frameworks.title1")}</span>
            <span className="block">{t("home.frameworks.title2")}</span>
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            {t("home.frameworks.description")}
          </p>
        </SectionReveal>

        <SectionReveal
          delay={0.05}
          className="mt-12 overflow-hidden rounded-3xl border border-black/[0.06] bg-card shadow-card dark:border-white/[0.08]"
        >
          {FRAMEWORKS.map((framework, index) => {
            const open = openIds.has(framework.id);
            const isFirst = index === 0;
            const isLast = index === FRAMEWORKS.length - 1;
            const triggerId = `framework-trigger-${framework.id}`;
            const panelId = `framework-panel-${framework.id}`;

            return (
              <div
                key={framework.id}
                data-blok-testid="framework-card"
                className="border-b border-black/[0.06] last:border-b-0 dark:border-white/[0.08]"
              >
                <div data-blok-testid={`framework-card-${framework.id}`}>
                  <h3 className="m-0">
                    <button
                      type="button"
                      id={triggerId}
                      aria-expanded={open}
                      aria-controls={panelId}
                      onClick={() => toggle(framework.id)}
                      className={cn(
                        "group flex w-full cursor-pointer items-center gap-4 px-5 py-5 text-left transition-colors sm:px-6",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        // Match the card's rounded corners so the focus ring and
                        // hover/open background hug the first row's top and the
                        // last row's bottom. The last row's bottom only rounds
                        // while collapsed; once open, the snippet panel sits below.
                        isFirst && "rounded-t-3xl",
                        isLast && !open && "rounded-b-3xl",
                        open ? "bg-secondary/40" : "hover:bg-secondary/40",
                      )}
                    >
                      <span
                        className={cn(
                          "relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white ring-1 shadow-sm transition-[transform,box-shadow,color] duration-[450ms] ease-[cubic-bezier(0.33,1,0.68,1)] group-hover:scale-[1.06] motion-reduce:transition-none dark:bg-white/[0.07]",
                          open
                            ? "text-white shadow-md ring-black/0"
                            : "text-muted-foreground ring-black/[0.06] dark:ring-white/[0.10]",
                        )}
                      >
                        {/* Brand fill ripples edge-to-edge from the centre — a
                            clip circle keeps it seamless, with no white margin. */}
                        <span
                          aria-hidden="true"
                          style={{ background: framework.brand }}
                          className={cn(
                            "absolute inset-0 rounded-[inherit] transition-[clip-path] duration-[450ms] ease-[cubic-bezier(0.33,1,0.68,1)] motion-reduce:transition-none",
                            open
                              ? "[clip-path:circle(75%_at_50%_50%)]"
                              : "[clip-path:circle(0%_at_50%_50%)]",
                          )}
                        />
                        <span className="relative">
                          <FrameworkIcon framework={framework} open={open} />
                        </span>
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block text-base font-bold tracking-tight text-foreground">
                          {t(`home.frameworks.${framework.key}Name`)}
                        </span>
                        <span className="block text-xs font-medium text-muted-foreground">
                          {t(`home.frameworks.${framework.key}Tagline`)}
                        </span>
                      </span>

                      <span
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all duration-300 motion-reduce:transition-none",
                          "group-hover:text-foreground",
                          open && "rotate-180 text-foreground",
                        )}
                      >
                        <ChevronGlyph />
                      </span>
                    </button>
                  </h3>

                  {/* CSS grid 0fr → 1fr gives a height-agnostic, JS-free expand. */}
                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={triggerId}
                    inert={!open}
                    className={cn(
                      "grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
                      open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                    )}
                  >
                    <div className="overflow-hidden">
                      <div className="px-5 pb-5 sm:px-6">
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          {t(`home.frameworks.${framework.key}Description`)}
                        </p>
                        <div className="mt-4">
                          <CodeBlock code={framework.code} language={framework.language} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </SectionReveal>
      </div>
    </section>
  );
};
