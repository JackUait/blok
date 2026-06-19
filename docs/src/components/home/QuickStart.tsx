import { useMemo, useState } from "react";
import { motion, type Variants } from "framer-motion";
import { CodeBlock } from "../common/CodeBlock";
import type { PackageManager } from "../common/PackageManagerToggle";
import { useI18n } from "../../contexts/I18nContext";

// Steps rise + fade in sequence as the timeline scrolls into view.
const railVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
};

const stepVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 220, damping: 26 },
  },
};

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
          className="absolute -top-24 left-1/4 size-96 rounded-full bg-primary/[0.03] blur-3xl"
          data-blok-testid="quick-start-blur"
        ></div>
        <div className="absolute bottom-0 right-1/4 size-80 rounded-full bg-foreground/[0.02] blur-3xl"></div>
      </div>

      <div className="mx-auto w-full max-w-4xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {t('home.quickStart.title')}
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            {t('home.quickStart.description')}
          </p>
        </div>

        <motion.div
          className="relative mt-16 flex flex-col gap-6 sm:gap-7"
          data-blok-testid="install-steps"
          variants={railVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
        >
          {/* Vertical timeline connector — a quiet neutral rail that fades out at the end */}
          <div
            className="absolute left-[1.4375rem] top-7 bottom-7 w-px bg-gradient-to-b from-border via-border to-transparent sm:left-[1.5625rem]"
            aria-hidden="true"
          ></div>

          {STEPS.map((step, index) => (
            <motion.div
              key={step.number}
              variants={stepVariants}
              className="group relative flex gap-5 sm:gap-6"
              data-blok-testid={`install-step-${step.number}`}
              style={{ "--step-delay": `${index * 0.15}s` } as React.CSSProperties}
            >
              <div
                className="relative z-10 shrink-0"
                data-blok-testid={`step-number-${step.number}`}
              >
                <div className="flex size-11 items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-foreground ring-4 ring-secondary/40 transition-transform duration-300 group-hover:scale-105 sm:size-12">
                  <span>{step.number}</span>
                </div>
              </div>

              <div
                className="min-w-0 flex-1 rounded-2xl border border-black/[0.07] bg-card p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all duration-300 hover:-translate-y-0.5 hover:border-black/[0.1] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] dark:border-white/[0.08] dark:hover:border-white/[0.14] sm:p-6"
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
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};
