import { Link } from "../common/Link";
import { CodeBlock } from "../common/CodeBlock";
import { Typo } from "../common/Typo";
import { useI18n } from "../../contexts/I18nContext";
import { useFramework } from "../../contexts/FrameworkContext";
import { adaptExample } from "../common/framework-adapt";
import { renderInline } from "./inline-code";

const TOOL_CLASS_CODE = `// callout-tool.ts
export class CalloutTool {
  private data: { text: string };

  // Shows the tool in the "/" menu. \`section\` groups the entry under a
  // labeled heading ('basic' | 'media' | 'database' | 'advanced'); omit it
  // to list the entry in the trailing unlabeled group.
  static get toolbox() {
    return { title: 'Callout', icon: '💡', section: 'basic' };
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
  // ...constructor unchanged; render() now keeps its element as \`this.box\`.

  // Opt into read-only mode. Without it, creating the editor with
  // \`readOnly: true\` — or calling \`readOnly.toggle(true)\` — throws
  // "To enable read-only mode all connected tools should support it".
  static isReadOnlySupported = true;

  save(block: HTMLElement) {
    return { text: block.textContent ?? '' };
  }

  // Drop empty callouts when the editor saves.
  validate(savedData: { text: string }) {
    return savedData.text.trim().length > 0;
  }

  // Optional: flip the DOM in place. If any registered tool lacks
  // setReadOnly(), every toggle re-runs a full save/clear/render cycle.
  setReadOnly(state: boolean) {
    this.box.contentEditable = String(!state);
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
import { Paragraph } from '@bloklabs/core/tools';
import { CalloutTool } from './callout-tool';
import { TextColorTune } from './text-color-tune';

const editor = new Blok({
  holder: 'editor',
  tools: {
    paragraph: Paragraph, // the default block every empty editor starts with
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
  // The toolbox icon may be a React element — reuse the component you render
  // in the block body; no parallel raw-SVG string to maintain.
  toolbox: { title: 'Callout', icon: <CalloutIcon /> },
  // Declares the saved data shape and its defaults — this IS your save() schema.
  propSchema: { text: { default: '' } },
  // \`config\` is the tool's config from your \`tools\` map — host props
  // (permissions, URLs…) flow in here, live, no context provider needed.
  // App-level React context (themes, stores) also reaches the component.
  // \`commit\` is idempotent: a patch that changes nothing is a full no-op,
  // so effects may echo current values (even on mount) without a guard.
  component: ({ data, commit, config }) => (
    <input
      className="callout"
      style={{ borderColor: config.accent }}
      value={data.text}
      onChange={(e) => commit({ text: e.target.value })}
    />
  ),
  // Optional read-only renderer: shown instead of \`component\` while the
  // editor is read-only — no display-vs-edit ternary inside the block.
  viewComponent: ({ data }) => <aside className="callout">{data.text}</aside>,
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
import {
  createAngularBlock,
  BLOK_BLOCK_CONTEXT,
  type AngularBlockRenderContext,
} from '@bloklabs/angular';

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
  // The token is typed \`AngularBlockRenderContext<unknown>\`, so cast it to
  // your data shape — otherwise \`ctx.data().text\` fails strict templates.
  ctx = inject(BLOK_BLOCK_CONTEXT) as AngularBlockRenderContext<{ text: string }>;
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

// Container blocks: the parts of the core tool contract a component-authored
// block reaches through the adapter — class statics, the toolbar anchor, the
// editor api/instance, and per-child decoration of the mounted holders.
const CONTAINER_AUTHORING_CODE: Partial<Record<string, { code: string; language: string }>> = {
  react: {
    language: 'tsx',
    code: `import { createReactBlock, useBlocks, useBlokInstance } from '@bloklabs/react';

export const StepsTool = createReactBlock<{ title: string }>({
  type: 'steps',
  propSchema: { title: { default: '' } },
  // Everything core reads off the tool CLASS goes in one place, under the same
  // names a vanilla tool uses: ownsChildren, keepsChildrenOnEnter,
  // conversionConfig, pasteConfig, sanitize, shortcut, upgradeData…
  // keepsChildrenOnEnter keeps Enter on the empty LAST step INSIDE the
  // container; without it that line escapes to the container's parent.
  statics: { ownsChildren: true, keepsChildrenOnEnter: true },
  // A container's own chrome usually isn't editable. Without an anchor the
  // toolbar centers on the first [contenteditable] under the host — which is
  // your FIRST CHILD BLOCK — parking +/drag halfway down the block.
  getToolbarAnchorElement: (host) => host.querySelector('[data-steps-header]'),
  // The seeding hook. Fires ONCE, after the portal's first commit — the first
  // tick at which this block's DOM (and its adopted child holders) exists;
  // rendered() runs BEFORE that commit, which is why hosts used to set the
  // caret twice around a rAF. It only fires for a genuine CREATION (the author
  // used a keystroke, \`api.blocks.insert\`, or a turn-into), never on a
  // load/undo/paste replay — where the children arrive a tick later and an
  // empty read is transient. Do not hand-roll it in \`onMounted\` by
  // accepting only the keystroke origin: that gate drops the api and turn-into
  // paths, so the container comes up empty for everything but a keypress. Read
  // \`context.origin\` here only for finer decisions.
  onCreated: (block, { api }) => {
    if (block.getChildren().length === 0) {
      api.blocks.insertInsideParent(block.id);
    }
  },
  component: ({ data, block, api, BlockChildren }) => {
    // The block's own editor, straight from context — no host plumbing. This
    // is also what makes the block re-render when its children change:
    // useBlocks refreshes on every structural mutation, including children the
    // adapter never sees (a pasted paragraph, a Tab-indent).
    const blocks = useBlocks(useBlokInstance());
    const steps = blocks.getChildren(block.id);

    return (
      <section>
        <header data-steps-header>{data.title} — {steps.length} steps</header>
        {/* Named per-child hooks instead of positional :nth-child() CSS, which
            breaks the moment a step is inserted, removed or reordered. They are
            written on each child's HOLDER; the holders stay direct children of
            the slot, so nesting and caret navigation are untouched. */}
        <BlockChildren
          childAttributes={(child, index) => ({
            'data-step-index': String(index + 1),
            'data-step-last': String(index === steps.length - 1),
          })}
        />
        <button
          onClick={() => api.blocks.insertInsideParent(block.id, steps.length)}
        >
          Add step
        </button>
      </section>
    );
  },
});`,
  },
  vue: {
    language: 'typescript',
    code: `import { computed, h } from 'vue';
import { createVueBlock, useBlocks, useBlokInstance } from '@bloklabs/vue';

export const StepsTool = createVueBlock<{ title: string }>({
  type: 'steps',
  propSchema: { title: { default: '' } },
  // Everything core reads off the tool CLASS, under the vanilla names.
  // keepsChildrenOnEnter keeps Enter on the empty LAST step INSIDE the
  // container; without it that line escapes to the container's parent.
  statics: { ownsChildren: true, keepsChildrenOnEnter: true },
  // Without an anchor the toolbar centers on the first [contenteditable] under
  // the host — which for a container is its FIRST CHILD BLOCK.
  getToolbarAnchorElement: (host) => host.querySelector('[data-steps-header]'),
  // The seeding hook. Fires ONCE, after the teleport's first commit — the first
  // tick at which this block's DOM (and its adopted child holders) exists — and
  // only for a genuine CREATION (a keystroke, \`api.blocks.insert\`, a
  // turn-into), never on a load/undo/paste replay. Do not hand-roll it in
  // \`onMounted\` by accepting only the keystroke origin: that gate drops the
  // api and turn-into paths.
  onCreated: (block, { api }) => {
    if (block.getChildren().length === 0) {
      api.blocks.insertInsideParent(block.id);
    }
  },
  setup({ data, block, api, BlockChildren }) {
    // The block's own editor, straight from inject() — no host plumbing.
    const blocks = useBlocks(useBlokInstance());
    const steps = computed(() => blocks.getChildren(block.id));

    return () =>
      h('section', [
        h('header', { 'data-steps-header': '' }, \`\${data.value.title} — \${steps.value.length}\`),
        // Named per-child hooks instead of positional :nth-child() CSS. They are
        // written on each child's HOLDER, which stays a direct child of the slot.
        h(BlockChildren, {
          childAttributes: (child, index: number) => ({
            'data-step-index': String(index + 1),
            'data-step-last': String(index === steps.value.length - 1),
          }),
        }),
        h(
          'button',
          { onClick: () => api.blocks.insertInsideParent(block.id, steps.value.length) },
          'Add step'
        ),
      ]);
  },
});`,
  },
  angular: {
    language: 'typescript',
    code: `import { Component, ElementRef, inject, viewChild, type AfterViewInit } from '@angular/core';
import {
  createAngularBlock,
  injectBlocks,
  injectBlokInstance,
  BLOK_BLOCK_CONTEXT,
  type AngularBlockRenderContext,
} from '@bloklabs/angular';

@Component({
  standalone: true,
  template: \`
    <header data-steps-header>{{ ctx.data().title }} — {{ steps().length }}</header>
    <div #slot></div>
    <button (click)="add()">Add step</button>
  \`,
})
export class StepsComponent implements AfterViewInit {
  readonly ctx = inject(BLOK_BLOCK_CONTEXT) as AngularBlockRenderContext<{ title: string }>;
  // The block's own editor, straight from DI — no host plumbing.
  private readonly blocks = injectBlocks(injectBlokInstance());
  private readonly slot = viewChild.required<ElementRef<HTMLElement>>('slot');

  steps = () => this.blocks.getChildren(this.ctx.block.id);

  ngAfterViewInit() {
    // Named per-child hooks instead of positional :nth-child() CSS. The
    // decorator is remembered and re-applied on every remount.
    this.ctx.mountChildren(this.slot().nativeElement, (child, index) => ({
      'data-step-index': String(index + 1),
    }));
  }

  add() {
    this.ctx.api.blocks.insertInsideParent(this.ctx.block.id, this.steps().length);
  }
}

export const StepsTool = createAngularBlock<{ title: string }>({
  type: 'steps',
  propSchema: { title: { default: '' } },
  component: StepsComponent,
  // Everything core reads off the tool CLASS, under the vanilla names.
  // keepsChildrenOnEnter keeps Enter on the empty LAST step INSIDE the
  // container; without it that line escapes to the container's parent.
  statics: { ownsChildren: true, keepsChildrenOnEnter: true },
  // Without an anchor the toolbar centers on the FIRST CHILD BLOCK.
  getToolbarAnchorElement: (host) => host.querySelector('[data-steps-header]'),
  // The seeding hook. Fires ONCE, once the mounted component's DOM (and its
  // adopted child holders) exists — and only for a genuine CREATION (a
  // keystroke, \`api.blocks.insert\`, a turn-into), never on a load/undo/paste
  // replay. Do not hand-roll it in \`onMounted\` by accepting only the
  // keystroke origin: that gate drops the api and turn-into paths.
  onCreated: (block, { api }) => {
    if (block.getChildren().length === 0) {
      api.blocks.insertInsideParent(block.id);
    }
  },
});`,
  },
};

// React-only: inline (selection) tools authored as components. Other adapters
// don't ship an inline-tool factory yet, so the section renders only for react.
const INLINE_TOOL_AUTHORING_CODE = `import { createReactInlineTool, useInlineTool } from '@bloklabs/react';

// A single-class toggle is just a mark spec. surround (toggle), checkState
// (whole-range coverage) and sanitize are all derived from it, running
// through the editor's range-aware mark engine (api.marks) — partial
// wrappers are split at the selection boundaries, fully-covering wrappers
// update in place, and the selection is restored.
export const Highlight = createReactInlineTool({
  type: 'highlight',
  title: 'Highlight',
  // i18n: the toolbar label resolves via toolNames.highlight in your
  // i18n.messages — no reliance on the legacy capitalized-name fallback.
  titleKey: 'highlight',
  shortcut: 'CMD+SHIFT+H',
  // The toolbar icon is a real React component — theme providers and
  // styled-components reach it; the editor unmounts it when the toolbar
  // closes, so there is nothing to clean up by hand.
  component: ({ active }) => <HighlightIcon active={active} />,
  mark: { tag: 'span', className: 'my-highlight' },
});

// Function-form values are excluded from the mark's identity, so a colour
// picker is ONE mark updating in place — not N mutually-cancelling marks.
const colorMark = {
  tag: 'mark',
  style: { color: (state: { color: string }) => state.color },
};

// Nested UI (swatches, popovers) reaches the tool via useInlineTool() —
// live active state, the tool config, the editor api, and the spec's mark
// operations bound to the live selection — no prop-drilling.
const Swatch = ({ color }: { color: string }) => {
  const { mark } = useInlineTool<Record<string, never>, { color: string }>();

  return <button onClick={() => mark?.apply({ color })} />;
};

export const TextColor = createReactInlineTool({
  type: 'textColor',
  titleKey: 'textColor',
  component: ({ active }) => (
    <ColorMenu active={active}>
      {PALETTE.map((color) => <Swatch key={color} color={color} />)}
    </ColorMenu>
  ),
  mark: colorMark,
});

// Need bespoke behaviour instead? Explicit surround/checkState win over the
// mark derivation, and both receive the editor api as a second argument:
//   surround: (range, api) => api?.marks.toggle(colorMark, { color: '#d97706' }),
//   checkState: (selection, api) => api?.marks.has(colorMark) ?? false,

// Register like any tool: tools: { highlight: Highlight, textColor: TextColor }`;

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

      {/* Container blocks — adapter frameworks only */}
      {(() => {
        const snippet = CONTAINER_AUTHORING_CODE[framework];
        if (snippet === undefined) {
          return null;
        }
        return (
          <div className="flex flex-col gap-4 border-t border-border pt-8">
            <h2 className={headingClass}>
              <Typo>{t('api.howToCustomTool.container.title')}</Typo>
            </h2>
            <p className={proseClass}>
              {renderInline(t(`api.howToCustomTool.container.body.${framework}`))}
            </p>
            <CodeBlock code={snippet.code} language={snippet.language} />
            <p className={proseClass}>
              {renderInline(t('api.howToCustomTool.container.holderNote'))}
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
