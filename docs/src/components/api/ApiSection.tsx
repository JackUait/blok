import { useState } from "react";
import { CodeBlock } from "../common/CodeBlock";
import { CategoryIcon } from "../common/CategoryIcon";
import { ApiMethodCard } from "./ApiMethodCard";
import { ConceptsContent } from "./ConceptsContent";
import { useI18n } from "../../contexts/I18nContext";
import { generatePropertyId, generateOptionId } from "./api-anchors";
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

const PACKAGE_NAME = "@jackuait/blok";

const CONFIG_CODE = `import { Blok } from '@jackuait/blok';
import { Header, Paragraph, List, Bold, Italic, Link } from '@jackuait/blok/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    paragraph: Paragraph,
    header: { class: Header, placeholder: 'Enter a heading' },
    list: List,
    bold: Bold,
    italic: Italic,
    link: Link,
  },
});`;

const SAVE_CODE = `const data = await editor.save();`;

const QuickStartContent: React.FC = () => {
  const { t } = useI18n();
  const [packageManager, setPackageManager] = useState<PackageManager>("yarn");

  const getInstallCommand = (manager: PackageManager): string => {
    switch (manager) {
      case "yarn":
        return `yarn add ${PACKAGE_NAME}`;
      case "npm":
        return `npm install ${PACKAGE_NAME}`;
      case "bun":
        return `bun add ${PACKAGE_NAME}`;
      default:
        return `npm install ${PACKAGE_NAME}`;
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
          packageName={PACKAGE_NAME}
          onPackageManagerChange={setPackageManager}
        />
      ),
    },
    {
      title: t('api.quickStartSteps.configure.title'),
      description: t('api.quickStartSteps.configure.description'),
      code: <CodeBlock code={CONFIG_CODE} language="typescript" />,
    },
    {
      title: t('api.quickStartSteps.save.title'),
      description: t('api.quickStartSteps.save.description'),
      code: <CodeBlock code={SAVE_CODE} language="typescript" />,
    },
  ];

  return (
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
              <h3 className="font-display text-lg font-bold tracking-tight text-foreground">{step.title}</h3>
              <p className="mt-1 mb-4 text-sm leading-relaxed text-muted-foreground">{step.description}</p>
              {step.code}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const SectionHeader: React.FC<{ section: ApiSectionType }> = ({ section }) => (
  <div className="flex flex-col gap-3">
    {section.badge && (
      <div
        className="inline-flex w-fit items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary"
        data-blok-testid="api-section-badge"
      >
        <CategoryIcon category={section.badge} size={14} />
        {section.badge}
      </div>
    )}
    <h1 className="scroll-mt-24 font-display text-3xl font-extrabold tracking-tight text-foreground">
      {section.title}
    </h1>
    {section.description && (
      <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">{section.description}</p>
    )}
  </div>
);

export const ApiSection: React.FC<ApiSectionProps> = ({ section }) => {
  const { t } = useI18n();

  // Render quick-start content specially
  if (section.customType === "quick-start") {
    return (
      <section id={section.id} className="scroll-mt-24" data-blok-testid={section.id} aria-label={section.title}>
        <div className="mb-10">
          <SectionHeader section={section} />
        </div>
        <QuickStartContent />
      </section>
    );
  }

  // Render the concepts / explanation content specially
  if (section.customType === "concepts") {
    return (
      <section id={section.id} className="scroll-mt-24" data-blok-testid={section.id} aria-label={section.title}>
        <div className="mb-10">
          <SectionHeader section={section} />
        </div>
        <ConceptsContent />
      </section>
    );
  }

  return (
    <section id={section.id} className="scroll-mt-24" data-blok-testid={section.id} aria-label={section.title}>
      <SectionHeader section={section} />

      {section.methods && section.methods.length > 0 && (
        <div className="mt-10">
          <h3 className={blockTitleClass}>{t('api.methods')}</h3>
          <div className="flex flex-col gap-4">
            {section.methods.map((method, index) => (
              <ApiMethodCard key={index} method={method} sectionId={section.id} />
            ))}
          </div>
        </div>
      )}

      {section.properties && section.properties.length > 0 && (
        <div className="mt-10">
          <h3 className={blockTitleClass}>{t('api.properties')}</h3>
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
                      <td className={tdClass}>{prop.description}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section.example && (
        <div className="mt-8">
          <CodeBlock code={section.example} language="typescript" />
        </div>
      )}

      {section.table && section.table.length > 0 && (
        <div className="mt-10">
          <h3 className={blockTitleClass}>{section.title}</h3>
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
                      <td className={tdClass}>{row.description}</td>
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
