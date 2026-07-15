import { Link } from "react-router-dom";
import { CodeBlock } from "../common/CodeBlock";
import { Typo } from "../common/Typo";
import { useI18n } from "../../contexts/I18nContext";
import { useFramework } from "../../contexts/FrameworkContext";
import { adaptExample } from "../common/framework-adapt";
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

const REGISTER_CODE = `import { Blok } from '@bloklabs/core';
import { Paragraph } from '@bloklabs/core/tools';
import { CalloutTool } from './callout-tool';

const editor = new Blok({
  holder: 'editor',
  tools: {
    paragraph: Paragraph, // the default block every empty editor starts with
    callout: CalloutTool, // the key becomes the block's \`type\`
  },
});`;

const OUTPUT_CODE = `const data = await editor.save();

// Your block round-trips exactly like a built-in one:
// {
//   id: 'x9k2f1',
//   type: 'callout',
//   data: { text: 'Heads up — this is a callout.' },
// }`;

// Framework-agnostic: the extended tool class plus a custom block tune. A
// tune is a settings-menu control — set `isTune` and return a menu item.
const VALIDATE_AND_TUNE_CODE = `// callout-tool.ts (extended)
export class CalloutTool {
  // ...constructor, render() unchanged

  save(block: HTMLElement) {
    return { text: block.textContent ?? '' };
  }

  // Drop empty callouts when the editor saves.
  validate(savedData: { text: string }) {
    return savedData.text.trim().length > 0;
  }
}

// text-color-tune.ts — a block tune adds a control to the settings menu.
export class TextColorTune {
  static isTune = true;

  render() {
    return { title: 'Text color', icon: '🎨', onActivate: () => {/* recolor */} };
  }
}`;

// Setup half: adapted to the active framework like the step snippets above.
const TUNES_REGISTER_CODE = `import { Blok } from '@bloklabs/core';
import { CalloutTool } from './callout-tool';
import { TextColorTune } from './text-color-tune';

const editor = new Blok({
  holder: 'editor',
  tools: {
    callout: { class: CalloutTool, tunes: ['textColor'] },
    // Register the tune as a tool so a block can list it by name.
    textColor: TextColorTune,
  },
});`;

interface HowToStep {
  key: string;
  /** Raw vanilla example, adapted to the active framework at render time. */
  code: string;
}

const STEPS: HowToStep[] = [
  { key: "scaffold", code: TOOL_CLASS_CODE },
  { key: "register", code: REGISTER_CODE },
  { key: "use", code: OUTPUT_CODE },
];

const headingClass =
  "font-display text-lg font-bold tracking-tight text-foreground";
const proseClass = "text-sm leading-relaxed text-muted-foreground";

export const HowToCustomToolContent: React.FC = () => {
  const { t } = useI18n();
  const { framework } = useFramework();

  return (
    <div className="flex flex-col gap-12">
      <p className="max-w-2xl text-lg leading-relaxed text-foreground/90">
        {renderInline(t("api.howToCustomTool.lead"))}
      </p>

      <div className="flex flex-col gap-10">
        {STEPS.map((step, index) => {
          const isLast = index === STEPS.length - 1;
          const snippet = adaptExample(step.code, framework);
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
                  <Typo>{t(`api.howToCustomTool.steps.${step.key}.title`)}</Typo>
                </h2>
                <p className="mt-1 mb-4 text-sm leading-relaxed text-muted-foreground">
                  {renderInline(t(`api.howToCustomTool.steps.${step.key}.body`))}
                </p>
                <CodeBlock code={snippet.code} language={snippet.language} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Going further */}
      <div className="flex flex-col gap-4 border-t border-border pt-8">
        <h2 className={headingClass}>
          <Typo>{t("api.howToCustomTool.further.title")}</Typo>
        </h2>
        <p className={proseClass}>
          {renderInline(t("api.howToCustomTool.further.body"))}
        </p>
        <CodeBlock code={VALIDATE_AND_TUNE_CODE} language="typescript" />
        {(() => {
          const registerSnippet = adaptExample(TUNES_REGISTER_CODE, framework);
          return (
            <CodeBlock
              code={registerSnippet.code}
              language={registerSnippet.language}
            />
          );
        })()}
        <p className={proseClass}>
          {renderInline(t("api.howToCustomTool.further.exampleNote"))}
        </p>
      </div>

      {/* Where to go next */}
      <p className="text-base leading-relaxed text-muted-foreground">
        {t("api.howToCustomTool.next.intro")}{" "}
        <Link to="/docs/tools-api" className="font-medium text-primary hover:underline">
          {t("api.howToCustomTool.next.toolsLink")}
        </Link>{" "}
        {t("api.howToCustomTool.next.middle")}{" "}
        <Link to="/docs/block-data" className="font-medium text-primary hover:underline">
          {t("api.howToCustomTool.next.blockDataLink")}
        </Link>{" "}
        {t("api.howToCustomTool.next.suffix")}
      </p>
    </div>
  );
};
