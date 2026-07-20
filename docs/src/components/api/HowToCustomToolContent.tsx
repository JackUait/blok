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

// Framework-native alternative to the class: each adapter ships a factory that
// turns a component into a `BlockToolConstructable`. Shown only when the
// framework toggle is on an adapter (vanilla has no factory to show).
const COMPONENT_AUTHORING_CODE: Partial<Record<string, { code: string; language: string }>> = {
  react: {
    language: 'tsx',
    code: `import { createReactBlock } from '@bloklabs/react';

export const CalloutTool = createReactBlock<{ text: string }, { accent: string }>({
  type: 'callout',
  toolbox: { title: 'Callout', icon: '💡' },
  // Declares the saved data shape and its defaults — this IS your save() schema.
  propSchema: { text: { default: '' } },
  // \`config\` is the tool's config from your \`tools\` map — host props
  // (permissions, URLs…) flow in here, live, no context provider needed.
  component: ({ data, commit, config }) => (
    <input
      className="callout"
      style={{ borderColor: config.accent }}
      value={data.text}
      onChange={(e) => commit({ text: e.target.value })}
    />
  ),
});`,
  },
  vue: {
    language: 'typescript',
    code: `import { h } from 'vue';
import { createVueBlock } from '@bloklabs/vue';

export const CalloutTool = createVueBlock<{ text: string }>({
  type: 'callout',
  toolbox: { title: 'Callout', icon: '💡' },
  // Declares the saved data shape and its defaults — this IS your save() schema.
  propSchema: { text: { default: '' } },
  setup: ({ data, commit }) => () =>
    h('input', {
      class: 'callout',
      value: data.value.text,
      onInput: (event: Event) =>
        commit({ text: (event.target as HTMLInputElement).value }),
    }),
});`,
  },
  angular: {
    language: 'typescript',
    code: `import { Component, inject } from '@angular/core';
import { createAngularBlock, BLOK_BLOCK_CONTEXT } from '@bloklabs/angular';

@Component({
  standalone: true,
  template: \`<input
    class="callout"
    [value]="ctx.data().text"
    (input)="ctx.commit({ text: $any($event.target).value })"
  />\`,
})
export class CalloutComponent {
  // Per-block context: data() signal, commit(), readOnly(), block API.
  ctx = inject(BLOK_BLOCK_CONTEXT);
}

export const CalloutTool = createAngularBlock<{ text: string }>({
  type: 'callout',
  toolbox: { title: 'Callout', icon: '💡' },
  // Declares the saved data shape and its defaults — this IS your save() schema.
  propSchema: { text: { default: '' } },
  component: CalloutComponent,
});`,
  },
};

// React-only: inline (selection) tools authored as components. Other adapters
// don't ship an inline-tool factory yet, so the section renders only for react.
const INLINE_TOOL_AUTHORING_CODE = `import { createReactInlineTool } from '@bloklabs/react';

export const TextColor = createReactInlineTool({
  type: 'textColor',
  title: 'Text color',
  shortcut: 'CMD+SHIFT+C',
  // The toolbar icon is a real React component — theme providers and
  // styled-components reach it; the editor unmounts it when the toolbar
  // closes, so there is nothing to clean up by hand.
  component: ({ active }) => <FontColorIcon active={active} />,
  // Applies the formatting to the live selection's range.
  surround: (range) => applyColor(range),
  // Drives the \`active\` prop the icon receives.
  checkState: (selection) => hasColor(selection),
  sanitize: { span: { style: true } },
});

// Register like any tool: tools: { textColor: TextColor }`;

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

      {/* Component authoring — adapter frameworks only */}
      {(() => {
        const snippet = COMPONENT_AUTHORING_CODE[framework];
        if (snippet === undefined) {
          return null;
        }
        return (
          <div className="flex flex-col gap-4 border-t border-border pt-8">
            <h2 className={headingClass}>
              <Typo>{t('api.howToCustomTool.component.title')}</Typo>
            </h2>
            <p className={proseClass}>
              {renderInline(t(`api.howToCustomTool.component.body.${framework}`))}
            </p>
            <CodeBlock code={snippet.code} language={snippet.language} />
            <p className={proseClass}>
              {renderInline(t('api.howToCustomTool.component.registerNote'))}
            </p>
          </div>
        );
      })()}

      {/* Inline tool authoring — react only */}
      {framework === 'react' && (
        <div className="flex flex-col gap-4 border-t border-border pt-8">
          <h2 className={headingClass}>
            <Typo>{t('api.howToCustomTool.inlineTool.title')}</Typo>
          </h2>
          <p className={proseClass}>
            {renderInline(t('api.howToCustomTool.inlineTool.body'))}
          </p>
          <CodeBlock code={INLINE_TOOL_AUTHORING_CODE} language="tsx" />
        </div>
      )}

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
