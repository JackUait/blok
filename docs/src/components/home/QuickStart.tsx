import { useMemo, useState } from "react";
import { motion, type Variants } from "framer-motion";
import { SectionReveal } from "../common/SectionReveal";
import { CodeBlock } from "../common/CodeBlock";
import type { PackageManager } from "../common/PackageManagerToggle";
import { useI18n } from "../../contexts/I18nContext";

// Steps rise + fade in sequence as the ledger scrolls into view.
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
    },
    {
      number: 2,
      title: t('api.quickStartSteps.configure.title'),
      description: t('api.quickStartSteps.configure.description'),
    },
    {
      number: 3,
      title: t('api.quickStartSteps.save.title'),
      description: t('api.quickStartSteps.save.description'),
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
      className="relative overflow-hidden bg-gradient-to-b from-background via-secondary/40 to-background py-24 sm:py-32"
      id="quick-start"
      data-blok-testid="quick-start-section"
    >
      {/* Warm sunset atmosphere — soft brand washes top + bottom, no hard edges */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        data-blok-testid="quick-start-bg"
        aria-hidden="true"
      >
        <div
          className="absolute -top-28 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-brand-from/[0.06] blur-3xl"
          data-blok-testid="quick-start-blur"
        ></div>
        <div className="absolute right-[8%] bottom-[-6rem] size-80 rounded-full bg-brand-to/[0.06] blur-3xl"></div>
        <div className="absolute bottom-[-4rem] left-[6%] size-72 rounded-full bg-primary/[0.04] blur-3xl"></div>
      </div>

      <div className="mx-auto w-full max-w-5xl px-6">
        <SectionReveal className="mx-auto max-w-2xl text-center">
          <div
            className="mx-auto mb-6 h-1 w-12 rounded-full bg-brand-gradient"
            aria-hidden="true"
          ></div>
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            {t('home.quickStart.title')}
          </h2>
        </SectionReveal>

        <motion.div
          className="mt-16 flex flex-col gap-6 sm:mt-20 sm:gap-8"
          data-blok-testid="install-steps"
          variants={railVariants}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
        >
          {STEPS.map((step, index) => {
            const isLast = index === STEPS.length - 1;

            return (
              <motion.div
                key={step.number}
                variants={stepVariants}
                className="group relative sm:pl-24"
                data-blok-testid={`install-step-${step.number}`}
                style={{ "--step-delay": `${index * 0.15}s` } as React.CSSProperties}
              >
                {/* Desktop-only thread that carries the eye down the gutter between steps */}
                {!isLast && (
                  <div
                    className="pointer-events-none absolute top-[4.5rem] bottom-[-1.5rem] left-[3.25rem] hidden w-px bg-gradient-to-b from-border to-transparent sm:block"
                    aria-hidden="true"
                  ></div>
                )}

                {/* The step card — premium surface with a hairline sunset seam up top.
                    On mobile it spans full width; on desktop it sits to the right of the
                    gutter numeral (which is pulled out via absolute positioning). */}
                <div
                  className="relative rounded-3xl border border-black/[0.06] bg-card p-5 shadow-[0_4px_24px_-10px_rgba(0,0,0,0.12)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_18px_44px_-16px_rgba(0,0,0,0.22)] dark:border-white/[0.07] sm:p-7"
                  data-blok-testid={`step-content-${step.number}`}
                >
                  <div
                    className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-via/50 to-transparent"
                    aria-hidden="true"
                  ></div>

                  {/* Header: number badge sits inline beside the title on mobile, then is
                      lifted into the desktop gutter so wide screens keep the offset numeral */}
                  <div className="flex items-baseline gap-3">
                    <div
                      className="shrink-0 select-none leading-none sm:absolute sm:-left-[4.25rem] sm:top-6"
                      data-blok-testid={`step-number-${step.number}`}
                    >
                      <span className="text-brand-gradient inline-block font-display text-4xl font-extrabold leading-none tabular-nums transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-105 sm:text-7xl">
                        {step.number}
                      </span>
                    </div>
                    <h3 className="text-xl font-bold tracking-tight">{step.title}</h3>
                  </div>

                  <p
                    className="mt-2 text-[15px] leading-relaxed text-muted-foreground"
                    data-blok-testid={`step-description-${step.number}`}
                  >
                    {step.description}
                  </p>

                  <div className="mt-5">
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
            );
          })}
        </motion.div>
      </div>
    </section>
  );
};
