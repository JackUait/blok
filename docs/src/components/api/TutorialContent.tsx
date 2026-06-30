import type { ReactNode } from "react";
import { CodeBlock } from "../common/CodeBlock";
import { Typo } from "../common/Typo";
import { useI18n } from "../../contexts/I18nContext";
import { renderInline } from "./inline-code";

const MOUNT_CODE = `import { Blok } from '@jackuait/blok';

const editor = new Blok({
  holder: 'editor', // the id of a <div> on your page
});

await editor.isReady;`;

const SAVE_CODE = `const data = await editor.save();

console.log(data);
// {
//   time: 1719000000000,
//   blocks: [
//     { id: 'a1b2c3', type: 'paragraph', data: { text: 'Hello, Blok' } },
//   ],
//   version: '1.0.0',
// }`;

const RENDER_CODE = `// On the next page load, hand the same object back:
await editor.render(data);`;

const TOOLS_CODE = `import { Blok } from '@jackuait/blok';
import { Header, List } from '@jackuait/blok/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    header: Header,
    list: List,
  },
});`;

interface TutorialStep {
  key: string;
  code?: ReactNode;
  /** Optional payoff callout rendered under the step's code. */
  payoffKey?: string;
}

const STEPS: TutorialStep[] = [
  { key: "mount", code: <CodeBlock code={MOUNT_CODE} language="typescript" /> },
  { key: "write" },
  {
    key: "save",
    code: <CodeBlock code={SAVE_CODE} language="typescript" />,
    payoffKey: "api.tutorial.steps.save.payoff",
  },
  { key: "render", code: <CodeBlock code={RENDER_CODE} language="typescript" /> },
  { key: "tools", code: <CodeBlock code={TOOLS_CODE} language="typescript" /> },
];

const nextLinkClass =
  "flex flex-col gap-1 rounded-2xl border border-border bg-card px-5 py-4 shadow-sm transition-colors hover:border-foreground/20 hover:bg-secondary/40";

export const TutorialContent: React.FC = () => {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-12">
      <p className="max-w-2xl text-lg leading-relaxed text-foreground/90">
        {renderInline(t("api.tutorial.lead"))}
      </p>

      <div className="flex flex-col gap-10">
        {STEPS.map((step, index) => {
          const isLast = index === STEPS.length - 1;
          return (
            <div
              key={step.key}
              className="relative flex flex-col gap-3 sm:flex-row sm:gap-5"
            >
              {/* Guided-flow connector — a hairline threading the numbered
                  markers into one sequence (sm+ only). Runs behind the markers,
                  whose opaque bg-card fills mask it under each circle. */}
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
                <h2 className="font-display text-lg font-bold tracking-tight text-foreground">
                  <Typo>{t(`api.tutorial.steps.${step.key}.title`)}</Typo>
                </h2>
                <p className="mt-1 mb-4 text-sm leading-relaxed text-muted-foreground">
                  {renderInline(t(`api.tutorial.steps.${step.key}.body`))}
                </p>
                {step.code}
                {step.payoffKey && (
                  <div className="mt-4 rounded-xl border border-border bg-secondary/40 px-5 py-4">
                    <p className="text-sm leading-relaxed text-foreground/90">
                      {renderInline(t(step.payoffKey))}
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Where to go next */}
      <div className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-bold tracking-tight text-foreground">
          <Typo>{t("api.tutorial.next.title")}</Typo>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <a href="#custom-block-tool" className={nextLinkClass}>
            <span className="font-display text-sm font-bold tracking-tight text-primary">
              <Typo>{t("api.links.customBlockTool")}</Typo>
            </span>
            <span className="text-sm leading-relaxed text-muted-foreground">
              <Typo>{t("api.tutorial.next.howTo")}</Typo>
            </span>
          </a>
          <a href="#concepts" className={nextLinkClass}>
            <span className="font-display text-sm font-bold tracking-tight text-primary">
              <Typo>{t("api.links.everythingIsABlock")}</Typo>
            </span>
            <span className="text-sm leading-relaxed text-muted-foreground">
              <Typo>{t("api.tutorial.next.concepts")}</Typo>
            </span>
          </a>
        </div>
      </div>
    </div>
  );
};
