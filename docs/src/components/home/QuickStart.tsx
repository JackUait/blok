import { useMemo, useState } from "react";
import { CodeBlock } from "../common/CodeBlock";
import type { PackageManager } from "../common/PackageManagerToggle";
import { useI18n } from "../../contexts/I18nContext";

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

export const QuickStart: React.FC = () => {
  const { t } = useI18n();
  const [packageManager, setPackageManager] = useState<PackageManager>("yarn");

  const STEPS = useMemo(() => [
    {
      number: 1,
      title: t('api.quickStartSteps.install.title'),
      description: t('api.quickStartSteps.install.description'),
      accent: "coral",
    },
    {
      number: 2,
      title: t('api.quickStartSteps.configure.title'),
      description: t('api.quickStartSteps.configure.description'),
      accent: "orange",
    },
    {
      number: 3,
      title: t('api.quickStartSteps.save.title'),
      description: t('api.quickStartSteps.save.description'),
      accent: "pink",
    },
  ], [t]);

  // Default install command (fallback, will be overridden by CodeBlock)
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

  return (
    <section
      className="relative overflow-hidden bg-secondary/40 py-20 sm:py-28"
      id="quick-start"
      data-blok-testid="quick-start-section"
    >
      {/* Subtle decorative background wash */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        data-blok-testid="quick-start-bg"
        aria-hidden="true"
      >
        <div
          className="absolute -top-24 left-1/4 size-96 rounded-full bg-primary/5 blur-3xl"
          data-blok-testid="quick-start-blur"
        ></div>
        <div className="absolute bottom-0 right-1/4 size-80 rounded-full bg-chart-3/5 blur-3xl"></div>
      </div>

      <div className="mx-auto w-full max-w-4xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-bold uppercase tracking-wide text-primary">
            {t('home.quickStart.eyebrow')}
          </span>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">
            {t('home.quickStart.title')}
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            {t('home.quickStart.description')}
          </p>
        </div>

        <div className="relative mt-14 flex flex-col gap-8" data-blok-testid="install-steps">
          {/* Vertical timeline connector */}
          <div
            className="absolute left-5 top-5 bottom-5 w-px bg-border sm:left-6"
            aria-hidden="true"
          ></div>

          {STEPS.map((step, index) => (
            <div
              key={step.number}
              className="relative flex gap-5 sm:gap-6"
              data-blok-testid={`install-step-${step.number}`}
              style={{ "--step-delay": `${index * 0.15}s` } as React.CSSProperties}
            >
              <div
                className="relative z-10 shrink-0"
                data-blok-testid={`step-number-${step.number}`}
              >
                <div className="flex size-10 items-center justify-center rounded-full bg-foreground text-base font-bold text-background shadow-sm sm:size-12">
                  <span>{step.number}</span>
                </div>
              </div>

              <div
                className="min-w-0 flex-1 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
                data-blok-testid={`step-content-${step.number}`}
              >
                <h3 className="text-lg font-bold tracking-tight">{step.title}</h3>
                <p
                  className="mt-1.5 text-sm leading-relaxed text-muted-foreground"
                  data-blok-testid={`step-description-${step.number}`}
                >
                  {step.description}
                </p>

                <div className="mt-4">
                  {step.number === 1 && (
                    <CodeBlock
                      code={getInstallCommand(packageManager)}
                      language="bash"
                      showPackageManagerToggle
                      packageName={PACKAGE_NAME}
                      onPackageManagerChange={setPackageManager}
                    />
                  )}
                  {step.number === 2 && (
                    <CodeBlock code={CONFIG_CODE} language="typescript" />
                  )}
                  {step.number === 3 && (
                    <CodeBlock code={SAVE_CODE} language="typescript" />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
