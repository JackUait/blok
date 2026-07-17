import { useState } from "react";
import { CodeBlock } from "../common/CodeBlock";
import { ApiMethodCard } from "./ApiMethodCard";
import { ConceptsContent } from "./ConceptsContent";
import { TutorialContent } from "./TutorialContent";
import { HowToCustomToolContent } from "./HowToCustomToolContent";
import { EditorAccessNote } from "./EditorAccessNote";
import { Breadcrumbs } from "./Breadcrumbs";
import { Typo } from "../common/Typo";
import { useI18n } from "../../contexts/I18nContext";
import { useFramework } from "../../contexts/FrameworkContext";
import {
  QUICK_START_SNIPPETS,
  CONFIG_SNIPPETS,
} from "../common/framework-snippets";
import { adaptExample } from "../common/framework-adapt";
import { generatePropertyId, generateOptionId } from "./api-anchors";
import { renderInline } from "./inline-code";
import type { ApiSection as ApiSectionType } from "./api-data";
import type { PackageManager } from "../common/PackageManagerToggle";

interface ApiSectionProps {
  section: ApiSectionType;
}

const blockTitleClass =
  "mb-4 font-display text-xs font-bold uppercase tracking-wide text-muted-foreground";
const thClass =
  "border-b border-border px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted-foreground";
const tdClass = "px-4 py-3 align-top text-sm text-muted-foreground";
const codeClass =
  "rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[0.8125rem] text-foreground";

const PACKAGE_NAME = "@bloklabs/core";

// Same repo the Footer's GitHub link points at — reused here rather than a
// new constant so both links always agree on where the source lives.
const REPO_URL = "https://github.com/JackUait/blok";

// One sensible source-file link per page type: customType pages each have a
// dedicated content component, everything else (the generic method/property/
// table reference pages) is authored in api-data.ts.
const EDIT_PATH_BY_CUSTOM_TYPE: Record<NonNullable<ApiSectionType["customType"]>, string> = {
  "quick-start": "docs/src/components/api/ApiSection.tsx",
  tutorial: "docs/src/components/api/TutorialContent.tsx",
  concepts: "docs/src/components/api/ConceptsContent.tsx",
  "how-to-custom-tool": "docs/src/components/api/HowToCustomToolContent.tsx",
};

const getEditPath = (section: ApiSectionType): string =>
  section.customType
    ? EDIT_PATH_BY_CUSTOM_TYPE[section.customType]
    : "docs/src/components/api/api-data.ts";

// Locale → toLocaleDateString locale tag, mirroring ChangelogPage.tsx's date
// formatting convention so "Last updated" dates read the same way site-wide.
const DATE_LOCALE_MAP: Record<string, string> = {
  en: "en-US",
  ru: "ru-RU",
};

const formatLastUpdated = (dateString: string, locale: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString(DATE_LOCALE_MAP[locale] ?? "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

// Same glyph as the Footer's GitHub link, sized down for an inline text link.
const GitHubIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
  </svg>
);

// Same stroked, rounded line style as section-icons.tsx / Toast.tsx, sized to
// sit inline with the checkpoint copy below.
const InfoIcon: React.FC = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="mt-0.5 size-5 shrink-0 text-primary"
  >
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="11" x2="12" y2="16" />
    <circle cx="12" cy="7.5" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

const QuickStartContent: React.FC = () => {
  const { t } = useI18n();
  const { framework } = useFramework();
  const [packageManager, setPackageManager] = useState<PackageManager>("yarn");

  const { container, create, save } = QUICK_START_SNIPPETS[framework];

  // The adapters are standalone packages peering on the core, so framework
  // users install both in one command.
  const installPackages = framework === "vanilla"
    ? PACKAGE_NAME
    : `${PACKAGE_NAME} @bloklabs/${framework}`;

  const getInstallCommand = (manager: PackageManager): string => {
    switch (manager) {
      case "yarn":
        return `yarn add ${installPackages}`;
      case "npm":
        return `npm install ${installPackages}`;
      case "bun":
        return `bun add ${installPackages}`;
      default:
        return `npm install ${installPackages}`;
    }
  };

  const steps = [
    {
      title: t('api.quickStartSteps.install.title'),
      description: t('api.quickStartSteps.install.description'),
      code: (
        <CodeBlock
          code={getInstallCommand(packageManager)}
          language="bash"
          showPackageManagerToggle
          packageName={installPackages}
          onPackageManagerChange={setPackageManager}
        />
      ),
    },
    {
      title: t('api.quickStartSteps.configure.title'),
      description: t('api.quickStartSteps.configure.description'),
      code: (
        <div className="flex flex-col gap-3">
          {/* Vanilla only — `new Blok({ holder: 'editor' })` mounts into this
              element, so it has to exist on the page before the script below
              runs. The other frameworks manage their own mount point. */}
          {container && (
            <CodeBlock code={container.code} language={container.language} />
          )}
          <CodeBlock code={create.code} language={create.language} />
        </div>
      ),
    },
    {
      title: t('api.quickStartSteps.save.title'),
      description: t('api.quickStartSteps.save.description'),
      code: <CodeBlock code={save.code} language={save.language} />,
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm leading-relaxed text-muted-foreground">
        <Typo>{t('api.quickStart.lead')}</Typo>
      </p>
      <div className="flex flex-col gap-10">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          return (
            <div key={index} className="relative flex flex-col gap-3 sm:flex-row sm:gap-5">
              {/* Guided-flow connector — a hairline that threads the numbered
                  markers into one continuous sequence (sm+ only, where the markers
                  share a left column). It runs behind the markers, whose opaque
                  bg-card fills mask it under each circle. */}
              {!isLast && (
                <span
                  aria-hidden
                  className="absolute top-10 -bottom-10 left-[1.125rem] hidden w-px -translate-x-1/2 bg-gradient-to-b from-border to-border/30 sm:block"
                />
              )}
              <span className="relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-card font-display text-sm font-bold text-primary shadow-sm">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1 pb-1">
                <h3 className="font-display text-lg font-bold tracking-tight text-foreground"><Typo>{step.title}</Typo></h3>
                <p className="mt-1 mb-4 text-sm leading-relaxed text-muted-foreground"><Typo>{step.description}</Typo></p>
                {step.code}
              </div>
            </div>
          );
        })}
      </div>
      {/* Closing checkpoint — confirms success and covers the most likely
          failure (the missing #editor container from the configure step
          above) so a stuck reader isn't left guessing. */}
      <div
        className="flex items-start gap-2.5 rounded-xl border border-border bg-secondary/40 px-4 py-3"
        data-blok-testid="quick-start-checkpoint"
      >
        <InfoIcon />
        <div className="flex flex-col gap-1.5">
          <p className="text-sm leading-relaxed text-foreground">
            <Typo>{t('api.quickStart.checkpoint')}</Typo>
          </p>
          {framework === 'vanilla' && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {renderInline(t('api.quickStart.troubleshooting'))}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

const SectionHeader: React.FC<{ section: ApiSectionType }> = ({ section }) => {
  const { t, locale } = useI18n();

  return (
    <div className="flex flex-col gap-3">
      <h1 className="scroll-mt-24 font-display text-3xl font-extrabold tracking-tight text-foreground">
        <Typo>{section.title}</Typo>
      </h1>
      {section.description && (
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground"><Typo>{section.description}</Typo></p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {section.lastUpdated && (
          <span data-blok-testid="api-last-updated">
            <Typo>{t('api.lastUpdated')}</Typo> {formatLastUpdated(section.lastUpdated, locale)}
          </span>
        )}
        <a
          href={`${REPO_URL}/blob/master/${getEditPath(section)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
          data-blok-testid="api-edit-on-github"
        >
          <GitHubIcon />
          <Typo>{t('api.editOnGithub')}</Typo>
        </a>
      </div>
    </div>
  );
};

export const ApiSection: React.FC<ApiSectionProps> = ({ section }) => {
  const { t } = useI18n();
  const { framework } = useFramework();

  // The Configuration page's lead example is the one place the core options are
  // shown being passed in, which differs per framework (constructor vs hook vs
  // component), so it uses the curated config snippet. Every other section-level
  // example is adapted to the active framework on the fly.
  const isConfig = section.id === "config";
  const sectionExample = isConfig
    ? CONFIG_SNIPPETS[framework]
    : section.example
      ? adaptExample(section.example, framework)
      : null;
  const exampleCode = sectionExample?.code;
  const exampleLanguage = sectionExample?.language ?? "typescript";

  // Render quick-start content specially
  if (section.customType === "quick-start") {
    return (
      <section id={section.id} className="scroll-mt-24" data-blok-testid={section.id} aria-label={section.title}>
        <Breadcrumbs currentId={section.id} pageTitle={section.title} />
        <div className="mb-10">
          <SectionHeader section={section} />
        </div>
        <QuickStartContent />
      </section>
    );
  }

  // Render the tutorial content specially
  if (section.customType === "tutorial") {
    return (
      <section id={section.id} className="scroll-mt-24" data-blok-testid={section.id} aria-label={section.title}>
        <Breadcrumbs currentId={section.id} pageTitle={section.title} />
        <div className="mb-10">
          <SectionHeader section={section} />
        </div>
        <TutorialContent />
      </section>
    );
  }

  // Render the concepts / explanation content specially
  if (section.customType === "concepts") {
    return (
      <section id={section.id} className="scroll-mt-24" data-blok-testid={section.id} aria-label={section.title}>
        <Breadcrumbs currentId={section.id} pageTitle={section.title} />
        <div className="mb-10">
          <SectionHeader section={section} />
        </div>
        <ConceptsContent />
      </section>
    );
  }

  // Render the how-to / task recipe content specially
  if (section.customType === "how-to-custom-tool") {
    return (
      <section id={section.id} className="scroll-mt-24" data-blok-testid={section.id} aria-label={section.title}>
        <Breadcrumbs currentId={section.id} pageTitle={section.title} />
        <div className="mb-10">
          <SectionHeader section={section} />
        </div>
        <HowToCustomToolContent />
      </section>
    );
  }

  return (
    <section id={section.id} className="scroll-mt-24" data-blok-testid={section.id} aria-label={section.title}>
      <Breadcrumbs currentId={section.id} pageTitle={section.title} />
      <SectionHeader section={section} />

      {section.methods && section.methods.length > 0 && (
        <div className="mt-10">
          {/* The method examples below call into a live editor instance; show
              how the active framework hands you that reference. Skipped for
              useBlocks — its methods run on the hook's api handle, not the
              editor, so the note would mislead. */}
          {section.id !== "use-blocks" && (
            <div className="mb-6">
              <EditorAccessNote />
            </div>
          )}
          <h2 className={blockTitleClass}>{t('api.methods')}</h2>
          <div className="flex flex-col gap-4">
            {section.methods.map((method, index) => (
              <ApiMethodCard key={index} method={method} sectionId={section.id} />
            ))}
          </div>
        </div>
      )}

      {section.properties && section.properties.length > 0 && (
        <div className="mt-10">
          <h2 className={blockTitleClass}>{t('api.properties')}</h2>
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={thClass}>{t('api.property')}</th>
                  <th className={thClass}>{t('api.type')}</th>
                  <th className={thClass}>{t('api.description')}</th>
                </tr>
              </thead>
              <tbody>
                {section.properties.map((prop) => {
                  const propId = generatePropertyId(section.id, prop.name);
                  return (
                    <tr
                      key={prop.name}
                      id={propId}
                      className="group scroll-mt-24 border-t border-border transition-colors hover:bg-secondary/40"
                      data-blok-testid={propId}
                    >
                      <td className={tdClass}>
                        <code className={codeClass}>{prop.name}</code>
                      </td>
                      <td className={tdClass}>
                        <code className={codeClass}>{prop.type}</code>
                      </td>
                      <td className={tdClass}><Typo>{prop.description}</Typo></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {exampleCode && (
        <div className="mt-8">
          <CodeBlock code={exampleCode} language={exampleLanguage} />
        </div>
      )}

      {section.table && section.table.length > 0 && (
        <div className="mt-10">
          <h2 className={blockTitleClass}><Typo>{section.title}</Typo></h2>
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {section.id === "config" && <th className={thClass}>{t('api.option')}</th>}
                  <th className={thClass}>{section.id === "config" ? t('api.type') : t('api.property')}</th>
                  {section.id === "config" && <th className={thClass}>{t('api.default')}</th>}
                  <th className={thClass}>{t('api.description')}</th>
                </tr>
              </thead>
              <tbody>
                {section.table.map((row) => {
                  const optionId = generateOptionId(section.id, row.option);
                  return (
                    <tr
                      key={row.option}
                      id={optionId}
                      className="group scroll-mt-24 border-t border-border transition-colors hover:bg-secondary/40"
                      data-blok-testid={optionId}
                    >
                      <td className={tdClass}>
                        <code className={codeClass}>{row.option}</code>
                      </td>
                      <td className={tdClass}>
                        <code className={codeClass}>{row.type}</code>
                      </td>
                      {section.id === "config" && (
                        <td className={tdClass}>
                          <code className={codeClass}>{row.default}</code>
                        </td>
                      )}
                      <td className={tdClass}><Typo>{row.description}</Typo></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};
