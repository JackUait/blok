import type { ReactNode } from "react";
import { CodeBlock } from "../common/CodeBlock";
import { useI18n } from "../../contexts/I18nContext";
import { renderInline } from "./inline-code";

const TOOL_CLASS_CODE = `// callout-tool.ts
export class CalloutTool {
  private data: { text: string };

  // Shows the tool in the "/" menu.
  static get toolbox() {
    return { title: 'Callout', icon: '💡' };
  }

  constructor({ data }: { data: { text?: string } }) {
    this.data = { text: data.text ?? '' };
  }

  // Return the element Blok mounts for this block.
  render() {
    const box = document.createElement('div');
    box.classList.add('callout');
    box.contentEditable = 'true';
    box.textContent = this.data.text;
    return box;
  }

  // Return the data Blok stores when the editor is saved.
  save(block: HTMLElement) {
    return { text: block.textContent ?? '' };
  }
}`;

const REGISTER_CODE = `import { Blok } from '@jackuait/blok';
import { CalloutTool } from './callout-tool';

const editor = new Blok({
  holder: 'editor',
  tools: {
    callout: CalloutTool, // the key becomes the block's \`type\`
  },
});`;

const OUTPUT_CODE = `const data = await editor.save();

// Your block round-trips exactly like a built-in one:
// {
//   type: 'callout',
//   data: { text: 'Heads up — this is a callout.' },
// }`;

interface HowToStep {
  key: string;
  code: ReactNode;
}

const STEPS: HowToStep[] = [
  {
    key: "scaffold",
    code: <CodeBlock code={TOOL_CLASS_CODE} language="typescript" />,
  },
  {
    key: "register",
    code: <CodeBlock code={REGISTER_CODE} language="typescript" />,
  },
  { key: "use", code: <CodeBlock code={OUTPUT_CODE} language="typescript" /> },
];

const headingClass =
  "font-display text-lg font-bold tracking-tight text-foreground";
const proseClass = "text-sm leading-relaxed text-muted-foreground";

export const HowToCustomToolContent: React.FC = () => {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-12">
      <p className="max-w-2xl text-lg leading-relaxed text-foreground/90">
        {renderInline(t("api.howToCustomTool.lead"))}
      </p>

      <div className="flex flex-col gap-10">
        {STEPS.map((step, index) => {
          const isLast = index === STEPS.length - 1;
          return (
            <div
              key={step.key}
              className="relative flex flex-col gap-3 sm:flex-row sm:gap-5"
            >
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
                <h2 className={headingClass}>
                  {t(`api.howToCustomTool.steps.${step.key}.title`)}
                </h2>
                <p className="mt-1 mb-4 text-sm leading-relaxed text-muted-foreground">
                  {renderInline(t(`api.howToCustomTool.steps.${step.key}.body`))}
                </p>
                {step.code}
              </div>
            </div>
          );
        })}
      </div>

      {/* Going further */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card px-6 py-6">
        <h2 className={headingClass}>
          {t("api.howToCustomTool.further.title")}
        </h2>
        <p className={proseClass}>
          {renderInline(t("api.howToCustomTool.further.body"))}
        </p>
      </div>

      {/* Where to go next */}
      <p className="text-base leading-relaxed text-muted-foreground">
        {t("api.howToCustomTool.next.intro")}{" "}
        <a href="#tools-api" className="font-medium text-primary hover:underline">
          {t("api.howToCustomTool.next.toolsLink")}
        </a>{" "}
        {t("api.howToCustomTool.next.middle")}{" "}
        <a href="#block-data" className="font-medium text-primary hover:underline">
          {t("api.howToCustomTool.next.blockDataLink")}
        </a>{" "}
        {t("api.howToCustomTool.next.suffix")}
      </p>
    </div>
  );
};
