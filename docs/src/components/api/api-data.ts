import { BLOK_VERSION } from "../../utils/constants";

export interface ApiMethod {
  name: string;
  returnType: string;
  description: string;
  example?: string;
  /**
   * Short "when to use / gotcha" guidance, injected per-locale by
   * useApiTranslations from `api.<section>.methods.<methodKey>.note`. May
   * contain `inline code` spans (rendered as chips by ApiMethodCard).
   */
  note?: string;
  /**
   * Structured parameter documentation, rendered as a table by
   * ApiMethodCard. `name`/`type`/`required`/`default` are language-agnostic
   * and live here; `description` is overlaid per-locale by
   * useApiTranslations from
   * `api.<section>.methods.<methodKey>.params.<paramName>.description`.
   */
  params?: {
    name: string;
    type: string;
    required: boolean;
    default?: string;
    description: string;
  }[];
  /**
   * Structured failure-mode documentation, rendered as a list by
   * ApiMethodCard. `message` is the literal thrown error text
   * (language-agnostic) and lives here; `condition`/`resolution` prose is
   * overlaid per-locale by useApiTranslations from
   * `api.<section>.methods.<methodKey>.errors.<index>.*`.
   */
  errors?: {
    condition: string;
    /**
     * The literal thrown error text, verbatim. Optional because some failures
     * throw nothing at all — omit it rather than describing the absence here:
     * this field is never overlaid per-locale, so prose in it reaches a Russian
     * reader in English with no way to translate it.
     */
    message?: string;
    resolution: string;
  }[];
  /**
   * Marks the method as deprecated. When true (or when deprecatedSince is set),
   * ApiMethodCard renders a visible "Deprecated" badge. Use this when the source
   * @deprecated tag carries no version.
   */
  deprecated?: boolean;
  /**
   * Editor version this method was deprecated in (e.g. "0.23.5"). Only set this
   * when a real release version is known — when present, ApiMethodCard also
   * renders a "deprecated since vX.Y.Z" line.
   */
  deprecatedSince?: string;
  /**
   * Method key (e.g. "readOnly.set") that replaces this deprecated method.
   * Rendered by ApiMethodCard as an in-page anchor link.
   */
  replacedBy?: string;
}

export interface ApiSection {
  id: string;
  badge?: string;
  title: string;
  description?: string;
  /**
   * ISO date string (e.g. "2026-06-30") shown as a "Last updated" line near
   * the page header. Kept as a plain static string per section — no
   * git-log/build-time automation needed.
   */
  lastUpdated?: string;
  methods?: ApiMethod[];
  properties?: { name: string; type: string; description: string }[];
  table?: {
    option: string;
    type: string;
    default: string;
    description: string;
  }[];
  customType?: "quick-start" | "tutorial" | "concepts" | "how-to-custom-tool" | "dev-override-seam";
  example?: string;
}

export const API_SECTIONS: ApiSection[] = [
  {
    id: "quick-start",
    badge: "Guide",
    title: "Quick Start",
    description: "Get up and running with Blok in a few steps.",
    lastUpdated: "2026-06-30",
    customType: "quick-start",
  },
  {
    id: "tutorial",
    badge: "Tutorial",
    title: "Build your first editor",
    description:
      "Mount Blok, capture some content, and save it as JSON you can store and load back. The full round-trip in five steps.",
    lastUpdated: "2026-06-30",
    customType: "tutorial",
  },
  {
    id: "concepts",
    badge: "Concepts",
    title: "Everything is a block",
    description:
      "Blok has one core idea. Understand it, and the rest of the API falls into place.",
    lastUpdated: "2026-06-30",
    customType: "concepts",
  },
  {
    id: "custom-block-tool",
    badge: "How-to",
    title: "Create a custom block tool",
    description:
      "Build a block tool from scratch: a callout box that renders, edits, and saves like any built-in block.",
    lastUpdated: "2026-06-30",
    customType: "how-to-custom-tool",
  },
  {
    id: "core",
    badge: "Core",
    lastUpdated: "2026-06-30",
    title: "Blok Class",
    description:
      "The main editor class. It creates the Blok editor instance and manages it. Every namespace a tool reaches through `api.*` is also on the instance as `editor.*`. The properties below are that same surface, plus the `width`, `placeholder`, `tokens` and `i18n` namespaces the class declares itself.",
    methods: [
      {
        name: "save()",
        returnType: "Promise<OutputData>",
        description:
          "Extracts the current editor content as structured JSON data. This is the main method for saving editor content.",
        example: `// Save editor content
const data = await editor.save();
console.log(data.blocks); // Array of block data`,
        errors: [
          {
            condition: "The editor is in read-only mode when save() is called.",
            message: "Blok's content can not be saved in read-only mode",
            resolution: "Call `readOnly.set(false)` before saving. You can also save from the last `onSave` payload, or from your own mirrored state.",
          },
        ],
      },
      {
        name: "render(data)",
        returnType: "Promise<void>",
        description:
          "Renders editor content from previously saved JSON data. It accepts the loose wire shape (`LooseOutputData`). A `null` value for a block's `data`, `id`, or `time` from a backend DTO is normalized at the boundary.",
        example: `// Load saved content
const savedData = {
  blocks: [
    { id: '1', type: 'paragraph', data: { text: 'Hello' } }
  ]
};
await editor.render(savedData);`,
      },
      {
        name: "focus(atEnd?)",
        returnType: "boolean",
        description:
          "Sets focus to the editor. It can also put the cursor at the end of the content.",
        example: `// Focus at start
editor.focus();

// Focus at end
editor.focus(true);`,
      },
      {
        name: "clear()",
        returnType: "Promise<void>",
        description:
          "Removes all content from the editor. One empty block of the default tool stays behind, so the editor is never block-less. A later save() still returns `blocks: []`. The blank default block does not validate, so it is dropped from the output.",
        example: `// Clear all content
await editor.clear();`,
      },
      {
        name: "destroy()",
        returnType: "void",
        description:
          "Destroys the editor instance and removes all DOM elements and event listeners.",
        example: `// Clean up on component unmount
editor.destroy();`,
      },
      {
        name: "handlers.set(handlers)",
        returnType: "void",
        description:
          "Installs, replaces or removes the live editor callbacks in place: `onChange`, `onSave`, `onEnter`, `onSubmit`, `onBeforeRender`, `onAfterRender`. Because the work happens in place, caret, selection, scroll and undo history all survive. Only the keys you pass are touched. A key whose value is `undefined` UNSETS that handler. That matters because the presence of a callback is itself the semantics. An `onSubmit` makes Enter serialize and submit instead of splitting the block. An `onSave` arms the change-observation pipeline. Use it to make a callback reactive without recreating the editor. The React, Vue and Angular adapters drive this setter for you when a prop, listener or `[config]` callback appears or disappears.",
        params: [
          {
            name: "handlers",
            type: "LiveHandlers",
            required: true,
            description:
              "Partial map of live callbacks. Omitted keys are left as they are. A key set to `undefined` unsets that handler.",
          },
        ],
        example: `// "Enter sends" while composing, default Enter while editing a draft
editor.handlers.set({
  onSubmit: sendsOnEnter ? (data) => send(data) : undefined,
});

// Start mirroring content into your store, later stop again
editor.handlers.set({ onSave: (data) => store.set(data) });
editor.handlers.set({ onSave: undefined });`,
      },
      {
        name: "whenAllReady(options?)",
        returnType: "Promise<void>",
        description:
          "Static method. It resolves once every Blok instance in scope has finished booting, which means each instance's `isReady` has settled. A rejection counts as settled. It is a collective readiness signal for pages that host several instances, and it replaces hand-aggregated per-instance `onReady` callbacks. Pass `within` (an Element) to count only instances mounted inside a subtree you own. Then an unrelated editor elsewhere on the page cannot hold your gate closed. Pass `settleOn: 'rendered'` to extend readiness from construction to content in the DOM, which also covers re-renders from `render(data)` after boot. An empty scope resolves right away. Instances that appear while the promise is pending extend the wait. Instances constructed after it resolves are not covered, so call it again, or use `subscribeReady()` for a live signal.",
        example: `// A comments list: N read-only bodies + a composer.
// Wait only for the editors inside this list.
await Blok.whenAllReady({
  within: listElement,
  settleOn: 'rendered',
});
composer.focus();`,
      },
      {
        name: "readyState(options?)",
        returnType: "{ total: number; pending: number; ready: boolean }",
        description:
          "Static method. It gives a synchronous readiness snapshot for a scope. The snapshot says how many instances match `within`. It also says how many are still pending at the requested `settleOn` depth, and whether the scope is settled. An empty scope reports `ready: true`, so you do not need a \"nothing to wait for\" special case.",
        example: `const { pending, ready } = Blok.readyState({ within: listElement });

if (!ready) {
  showSkeleton(pending);
}`,
      },
      {
        name: "subscribeReady(listener)",
        returnType: "() => void",
        description:
          "Static method. It subscribes to readiness changes across all instances (construction, boot, render-state flip, destroy) and returns an unsubscribe function. The listener takes no arguments, so re-read `Blok.readyState(scope)` when it fires. It works with `useSyncExternalStore` and other store adapters, and gives a live signal instead of a one-shot latch.",
        example: `const unsubscribe = Blok.subscribeReady(() => {
  setReady(Blok.readyState({ within: listElement }).ready);
});

// later
unsubscribe();`,
      },
      {
        name: "createSelector(attr, value?)",
        returnType: "string",
        description:
          "A named export of the package root, not a member of the Blok class. It builds a CSS selector from a `DATA_ATTR` value. With no `value` it produces a presence selector. With one it produces an equality selector. Use it together with `Blok.DATA_ATTR` instead of matching Blok's internal class names, which are not part of the public surface.",
        example: `import { DATA_ATTR, createSelector } from '@bloklabs/core';

createSelector(DATA_ATTR.element); // '[data-blok-element]'
document.querySelectorAll(createSelector(DATA_ATTR.selected, true));`,
      },
      {
        name: "icons",
        returnType: "string",
        description:
          "Named exports of the `@bloklabs/core/icons` subpath, not members of the Blok class. They are Blok's own glyphs as SVG strings, one `Icon*` constant per glyph (`IconBold`, `IconPlus`, `IconTrash`, `IconWarning`, …). They are plain strings, so they drop straight into the places a tool must supply markup: a tool's `static get toolbox()` icon and the entries returned by `renderSettings()`. The subpath ships a generated, self-contained declaration file (`types/icons.d.ts`) that lists every constant, so editor autocomplete is the reference for the full set.",
        example: `import { IconBold, IconPlus } from '@bloklabs/core/icons';

class Callout {
  static get toolbox() {
    return { title: 'Callout', icon: IconPlus };
  }

  renderSettings() {
    return [{ icon: IconBold, title: 'Bold text', onActivate: () => this.toggleBold() }];
  }
}`,
      },
    ],
    properties: [
      {
        name: "DATA_ATTR",
        type: "Record<DataAttrKey, DataAttrValue>",
        description:
          "A named export of the package root (`import { DATA_ATTR } from '@bloklabs/core'`), not a property of the editor instance. It holds the stable `data-blok-*` attribute names Blok writes on its DOM. This is the supported way to query editor DOM and write host tests, instead of matching internal class names. The `DataAttrKey` / `DataAttrValue` types and the `createSelector()` helper are exported alongside it.",
      },
      {
        name: "BLOK_FONT_SIZE_TOKENS",
        type: "BlokFontSizeTokens",
        description:
          "A named export of the package root (`import { BLOK_FONT_SIZE_TOKENS } from '@bloklabs/core'`), not a property of the editor instance. It gives the CSS custom property each `style.fontSize` scenario writes, in a map shaped exactly like the config itself (`BLOK_FONT_SIZE_TOKENS.paragraph`, `.heading[1]`, `.list.checklist`, `.bookmark.link`, …). Use it wherever typography is driven by a channel other than the constructor config: a per-region CSS rule, or `editor.tokens.set({ [BLOK_FONT_SIZE_TOKENS.paragraph]: '18px' })` at runtime. Then the custom property names never have to be hand-copied, and a rename is a compile error instead of a silent no-op.",
      },
      {
        name: "version",
        type: "string",
        description:
          "A named export of the package root (`import { version } from '@bloklabs/core'`), not a property of the editor instance. It is the running editor version, the same value stamped into `OutputData.version`.",
      },
      {
        name: "PendingBlok",
        type: "{ isReady; isRendered; destroy(); theme; width; placeholder; tokens; i18n }",
        description:
          "A type exported from the package root (`import type { PendingBlok } from '@bloklabs/core'`), not a property of the editor instance. It is the surface guaranteed to exist synchronously between `new Blok(config)` and `isReady` resolving. Blok builds its module APIs (`blocks`, `caret`, `history`, `readOnly`, …) asynchronously, so reading them earlier returns `undefined`. `PendingBlok` declares only the eight members listed here. That turns the window into a compile error instead of an `undefined` at runtime: `const pending: PendingBlok = new Blok(config); const editor = await pending.isReady;`.",
      },
      {
        name: "isReady",
        type: "Promise<Blok>",
        description:
          "Promise that resolves with the ready editor instance. The API namespaces below (`blocks`, `caret`, `history`, `readOnly`, …) are built asynchronously. They are `undefined` until it resolves, so type the reference you hold during that window as `PendingBlok`.",
      },
      {
        name: "isRendered",
        type: "boolean",
        description:
          "Synchronous render-readiness flag. It is true once the current render batch has landed in the DOM, and it mirrors the `data-blok-rendered` wrapper attribute. It is false before the first render and while a re-render is in flight. It complements the async `isReady` and `onReady`: no await or callback is needed, so mount state can be polled synchronously.",
      },
      { name: "blocks", type: "Blocks", description: "Blocks API module" },
      { name: "caret", type: "Caret", description: "Caret API module" },
      { name: "history", type: "History", description: "History API module" },
      { name: "saver", type: "Saver", description: "Saver API module" },
      {
        name: "toolbar",
        type: "Toolbar",
        description: "Toolbar API module",
      },
      {
        name: "inlineToolbar",
        type: "InlineToolbar",
        description: "Inline toolbar API module",
      },
      { name: "tools", type: "Tools", description: "Tools API module" },
      {
        name: "uploader",
        type: "Uploader",
        description: "Uploader API module for asset uploads routed by asset kind",
      },
      { name: "events", type: "Events", description: "Events API module" },
      {
        name: "listeners",
        type: "Listeners",
        description: "Listeners API module",
      },
      { name: "notifier", type: "Notifier", description: "Notifier API module" },
      {
        name: "sanitizer",
        type: "Sanitizer",
        description: "Sanitizer API module",
      },
      {
        name: "selection",
        type: "Selection",
        description: "Selection API module",
      },
      {
        name: "marks",
        type: "Marks",
        description: "Marks API module for range-aware inline-mark operations",
      },
      { name: "styles", type: "Styles", description: "Styles API module" },
      { name: "tooltip", type: "Tooltip", description: "Tooltip API module" },
      { name: "readOnly", type: "ReadOnly", description: "ReadOnly API module" },
      { name: "ui", type: "Ui", description: "UI API module" },
      { name: "theme", type: "Theme", description: "Theme API module" },
      { name: "width", type: "Width", description: "Width API module" },
      {
        name: "placeholder",
        type: "Placeholder",
        description: "Placeholder API module",
      },
      {
        name: "tokens",
        type: "Tokens",
        description: "Runtime theme-tokens API module",
      },
      {
        name: "i18n",
        type: "EditorI18n",
        description:
          "I18n API module. It has everything a tool gets through `api.i18n`, plus `update()`",
      },
      {
        name: "config",
        type: "Readonly<Pick<BlokConfig, 'linkPaste' | 'link'>>",
        description:
          "Read-only view of selected editor configuration: the `link` and `linkPaste` options this instance was created with. A custom inline or link tool reads the host's link policy from here (as `api.config`) instead of working it out again.",
      },
      {
        name: "rectangleSelection",
        type: "{ cancelActiveSelection(): void; isRectActivated(): boolean; clearSelection(): void; startSelection(pageX: number, pageY: number, shiftKey?: boolean): void; endSelection(): void }",
        description:
          "Drag-select (rubber-band) control. It is also reachable inside a tool as `api.rectangleSelection`. `startSelection(pageX, pageY, shiftKey?)` begins a rubber-band from page coordinates. `endSelection()` resets the drag state and hides the overlay. `isRectActivated()` reports whether a rubber-band is currently active. `clearSelection()` drops the active flag. `cancelActiveSelection()` aborts a selection in progress (clear + end). Another selection system, for example table cell selection, calls it when it takes priority.",
      },
    ],
  },
  {
    id: "config",
    title: "Configuration",
    description:
      "The configuration object passed to the Blok constructor. It is formally split into two types. `BlokMountOptions` holds the options that are fixed for the life of the instance (holder, tools, i18n, and so on). `BlokState` holds the LIVE fields: `readOnly` (including `hideControls`), `hideToolbar`, `toolbarPosition`, `inlineToolbar`, and the editor callbacks `onChange`, `onSave`, `onEnter`, `onSubmit`, `onBeforeRender` and `onAfterRender`. Every `BlokState` field maps to a documented runtime setter (`readOnly.set`, `toolbar.setHidden`, `toolbar.setPosition`, `tools.setInlineToolbar`, `handlers.set`). Changing one never requires recreating the editor. The React, Vue and Angular adapters react to these props and inputs in place. Callback PRESENCE is itself load-bearing: an `onSubmit` turns Enter into serialize-and-submit, and an `onSave` arms the change pipeline. That is why `handlers.set` also accepts `undefined`, to unset one. `BlokConfig = BlokMountOptions & BlokState`, so existing code compiles unchanged.",
    example: `import { Blok, type BlokConfig } from '@bloklabs/core';
import { Paragraph, Header } from '@bloklabs/core/tools';

const config: BlokConfig = {
  holder: 'editor',
  tools: {
    paragraph: Paragraph,
    header: { class: Header, placeholder: 'Enter a heading' },
  },
  placeholder: 'Start writing...',
  minHeight: 300,
  defaultBlock: 'paragraph',
  data: {
    blocks: [
      { id: '1', type: 'paragraph', data: { text: 'Hello!' } }
    ]
  },
  readOnly: false,
  onChange: (api, event) => {
    console.log('Content changed', event);
  },
};

const editor = new Blok(config);`,
    table: [
      {
        option: "holder",
        type: "string | HTMLElement",
        default: "'blok'",
        description: "Container element ID or reference",
      },
      {
        option: "tools",
        type: "Record<string, ToolConstructable | ToolSettings>",
        default: "{}",
        description:
          "Available block and inline tools. Nothing is registered by default. The `{}` default leaves only Blok's internal tools (`stub`, `delete`, `copyLink`, `convertTo`), so a bare `new Blok({ holder })` cannot render even a paragraph. Two ready-made bundles are exported from `@bloklabs/core/full`. `defaultTools` holds paragraph, header and list, all with `inlineToolbar: true`. `allTools` holds `defaultTools` plus quote, callout, code, toggle and every inline tool. Setting `toolbox: false` on a tool keeps it registered, so existing blocks still render and blocks.insert() still works. It removes the tool from every user-insertion path: the + / slash menu, the convert menu, and its keyboard shortcut. That is useful for permission gating. You can flip it at runtime via `tools.update(name, { toolbox })`. The React adapter applies changes to the `tools` prop's `toolbox` values automatically. So a permission change never requires recreating the editor.",
      },
      {
        option: "tunes",
        type: "string[]",
        default: "undefined",
        description:
          "Names of block tunes added to every block tool that does not declare its own `tunes` set. The tune classes themselves must be registered in `tools` (a class with `static isTune = true`).",
      },
      {
        option: "placeholder",
        type: "string | false",
        default: "false",
        description:
          "Placeholder text handed to every block of the default tool. It reaches every block, not only the first, and not only while the document is empty. With the built-in paragraph it is visible whenever a block is empty and focused. Note that `false` (also the default) does not remove the placeholder. The paragraph tool then falls back to its own built-in localized text (\"Write something or press / to select a tool\"). To blank it, give the default tool an empty placeholder of its own: `tools: { paragraph: { class: Paragraph, placeholder: '' } }`.",
      },
      {
        option: "minHeight",
        type: "number",
        default: "300",
        description:
          "Height in px of the editor's bottom clickable zone",
      },
      {
        option: "captureClicksBelowEditor",
        type: "boolean",
        default: "false",
        description:
          "Opt-in: clicks on the host page below the editor append a block, with zero layout footprint. Pair it with `minHeight: 0` to remove the bottom zone entirely. Only clicks landing on the empty background of an element that contains the editor count. Clicks on your own content rendered below are ignored. Propagation is never stopped, so host click handlers keep working alongside.",
      },
      {
        option: "inlineEmoji",
        type: "boolean",
        default: "true",
        description:
          "Inline emoji menu. Typing `:` followed by a name in a text block opens it, for example `:fire`. Picking an emoji replaces the typed `:query` with the character. The colon opens the menu only at the start of a word. That means at the start of the block, or right after a space. `10:30`, `http://` and `Note: this` do not open it. At least one character must follow the colon. Typing a closing `:` can insert the emoji right away. That only happens when the query is an exact shortcode. `:fire:` gives 🔥 without the menu ever opening. Any other query is left as typed text. Escape closes the menu. It leaves the typed text unchanged. The page does not scroll while the menu is open. The menu's own grid still scrolls. The menu has no search field, no random button, and no remove button. It also has no curated section. Those stay on the Callout tool's own emoji picker, which this option does not affect. `false` turns the menu off. An absent key keeps it on.",
      },
      {
        option: "defaultBlock",
        type: "string",
        default: "'paragraph'",
        description: "Default block type",
      },
      {
        option: "data",
        type: "OutputData | LooseOutputData | null",
        default: "undefined",
        description:
          "Initial data to render. The loose wire shape is accepted: `null` values for block `data`, `id`, or `time` (common in backend DTOs) are normalized at the boundary. A whole-document `null` is also accepted and normalized to an empty document. So you can pass nullable controlled state straight through, without a `value ?? { blocks: [] }` guard.",
      },
      {
        option: "dataModel",
        type: "'legacy' | 'hierarchical' | 'auto'",
        default: "'auto'",
        description:
          "Input/output data model. 'auto' detects the format of the data you render and preserves it on save. 'legacy' always uses the nested `items[]` structure. 'hierarchical' always uses flat blocks with `parent`/`content` references.",
      },
      {
        option: "sanitizer",
        type: "SanitizerConfig",
        default: "{}",
        description:
          "Editor-wide default sanitizer allowlist. Blok composes it with each tool's own `sanitize` rules. It applies on save, on render, on paste and on copy of selected blocks.",
      },
      {
        option: "readOnly",
        type: "boolean | { hideControls?: boolean }",
        default: "false",
        description:
          "Enable read-only mode. Pass `{ hideControls: true }` to also hide the hover toolbar, block settings, and inline toolbar. Live field: change it at runtime via `readOnly.set(state, { hideControls })`. The same instance flips modes in place, preserving caret, undo history and scroll.",
      },
      {
        option: "onChange",
        type: "(api: API, event: BlockMutationEvent | BlockMutationEvent[]) => void",
        default: "undefined",
        description:
          "Change callback function. The event argument carries the mutation that occurred, or an array of them when several fire at once. Latency is bounded, so it is safe to drive UI from. The first change of an idle document arrives on the next microtask, in the same frame the user typed in. The changes after it are coalesced into one further call at the end of a short batch window, and later changes never extend that window. Live field: install, replace or unset it at runtime via `handlers.set({ onChange })`. Its presence, together with `onSave`, is what arms Blok's change-observation pipeline at all.",
      },
      {
        option: "onSave",
        type: "(data: OutputData, api: API) => void",
        default: "undefined",
        description:
          "Reactive save callback. It fires automatically with the full serialized content on every batched content change, so you do not have to call save() by hand. It rides the trailing edge of the batch window only. Unlike onChange it never leads the window, because serializing the whole document is too expensive to front-run the batch with. Live field: install, replace or unset it at runtime via `handlers.set({ onSave })`. Its mere presence makes Blok serialize the document once per change batch.",
      },
      {
        option: "onReady",
        type: "(blok?: Blok) => void",
        default: "undefined",
        description:
          "Fires once when the editor becomes ready, receiving the fully-initialized Blok instance",
      },
      {
        option: "onEnter",
        type: "(event: KeyboardEvent, api: API) => boolean | void",
        default: "undefined",
        description:
          "Fires when Enter is pressed in a block, before Blok splits it or creates a new one. Return true to mark it handled, and Blok suppresses its default block split or create (the native newline is still prevented). It never fires for tools with enableLineBreaks, or while a popover or toolbar owns Enter, or for a soft-line-break Shift+Enter. The one exception is iOS: Safari reports Shift+Enter for a sentence-ending '. ', and Blok creates a block, so the hook fires there too. It suits chat inputs (\"Enter sends\"). Pair it with the paragraph tool's preserveBlank config instead of subclassing Paragraph. Live field: install, replace or unset it at runtime via `handlers.set({ onEnter })`.",
      },
      {
        option: "onSubmit",
        type: "(data: OutputData, api: API) => void",
        default: "undefined",
        description:
          "Fires with the full serialized OutputData on the Enter that would otherwise create or split a block, the \"Enter sends\" gesture. Blok serializes the document and suppresses the default split, so you do not wire save() into onEnter by hand. It inherits every onEnter escape. When both are set, an onEnter that returns true takes precedence and suppresses onSubmit. Live field: install, replace or unset it at runtime via `handlers.set({ onSubmit })`. Pass `undefined` to restore Blok's default Enter (split the block) without recreating the editor.",
      },
      {
        option: "onError",
        type: "(error: Error, context: { source: 'save' }) => void",
        default: "undefined",
        description:
          "Fires when an editor operation fails that Blok would otherwise only log. Today the sole source is serialization. Both the debounced auto-save and an explicit save() route through it. A failed save() rejects with the underlying error and never resolves with undefined, so wrap explicit saves in try/catch. onError additionally surfaces failures of the debounced auto-save, which has no promise of its own.",
      },
      {
        option: "onBeforePaste",
        type: "(html: string) => string | null",
        default: "undefined",
        description:
          "Transforms the raw `text/html` clipboard payload before any Blok preprocessing or sanitization, so you no longer need a capture-phase paste interceptor. Return the HTML to feed into the rest of the paste pipeline. Return null to skip the HTML path and fall through to plain text. Everything below runs after your hook. Blok normalizes what other apps put on the clipboard. Copy an answer out of ChatGPT, Claude or Gemini, or a page out of Notion or Google Docs. It arrives as real blocks, not one flat paragraph. That means headings, lists, tables, quotes and code. ChatGPT and Gemini get a dedicated pre-pass on top, because each hides meaning in markup the sanitizer would otherwise drop. ChatGPT ships no MathML. So a formula's LaTeX is recovered from its source attribute and rebuilt as an equation. Its code blocks are also de-duplicated. Each one renders as a nested editor. Gemini's code language is read off the label it prints above the block. Claude has no pre-pass of its own: its answers are already semantic HTML, so they come through the standard HTML and markdown paths.",
      },
      {
        option: "onBeforeRender",
        type: "(blocks: OutputBlockData[]) => OutputBlockData[]",
        default: "undefined",
        description:
          "Transforms the blocks array just before it is rendered. It runs on the initial render, on every `blocks.render()` call, and on the repaints Blok performs itself. Those repaints are a runtime `i18n.update()` and the read-only fallback re-render. It receives the raw saved blocks, before format analysis or hierarchical expansion, and returns the blocks to render. That way app-specific data migrations run inside Blok instead of ahead of it. It must therefore be idempotent: those repaints feed it blocks it has already transformed. Live field: install, replace or unset it at runtime via `handlers.set({ onBeforeRender })`.",
      },
      {
        option: "onAfterRender",
        type: "(api: API) => void",
        default: "undefined",
        description:
          "Fires after each render batch lands in the DOM: the initial render, every `blocks.render()`, and the repaints Blok performs itself. Those are a runtime `i18n.update()` locale or messages change, and a `readOnly.set()` toggle that falls back to a full re-render because a mounted tool does not support in-place read-only. Use it for post-render side effects such as scroll restoration or attaching observers. Keep those extra triggers in mind if you count renders. Distinct from onReady, which fires once when the editor first becomes ready. Live field: install, replace or unset it at runtime via `handlers.set({ onAfterRender })`.",
      },
      {
        option: "autofocus",
        type: "boolean",
        default: "false",
        description:
          "If true, sets the caret in the first block once the editor is ready",
      },
      {
        option: "scrollToBlock",
        type: "{ topOffset?: number }",
        default: "undefined",
        description:
          "Blok always smooth-scrolls to the block whose id matches the page URL hash (`#<blockId>`) once blocks are rendered. That includes blocks rendered later via `blocks.render()`. This option only tunes that behavior: `topOffset` (default 0) reserves space above the block for a sticky header.",
      },
      {
        option: "inlineToolbar",
        type: "string[] | boolean",
        default: "true",
        description:
          "Default inline toolbar for all tools. An array restricts it to the listed inline tools, and false disables it. The array picks which tools appear, never where. The toolbar always renders the built-ins in one fixed order (convert, bold, italic, underline, strikethrough, inline code, equation, sup/sub, link, color, clear formatting). Any custom inline tool is appended after them, in registration order. Live field: reconfigure it at runtime via `tools.setInlineToolbar(config)`.",
      },
      {
        option: "hideToolbar",
        type: "boolean",
        default: "false",
        description:
          "Hide the hover block toolbar (plus button / drag handle) and collapse the editor gutter reserved for it. The keyboard \"/\" menu keeps working. Live field: flip it at runtime via `toolbar.setHidden(hidden)`.",
      },
      {
        option: "toolbarPosition",
        type: "'left' | 'right'",
        default: "'left'",
        description:
          "Which side of the content column the floating block controls (plus button and drag/settings handle) occupy. `'right'` moves both the controls and the gutter reserved for them to the editor's inline-end side. The start gutter collapses and an equal one opens at the end, so the text reclaims the space the controls used to occupy. The values name the LTR-physical side and are applied through logical properties, so an RTL editor mirrors them. No effect while `hideToolbar` is on, or in chromeless read-only, because there are no controls to place. Live field: move them at runtime via `toolbar.setPosition(position)`.",
      },
      {
        option: "i18n",
        type: "I18nConfig",
        default: "undefined",
        description:
          "Internationalization config (locale plus message dictionary). Live field: switch language at runtime via `i18n.update({ locale, messages })`. The editor relabels in place, so caret and undo history survive a language switch. `defaultLocale` is the exception and stays mount-only. Custom tool titles are localizable by registration name, for example a `fileLink` tool via `messages: { 'toolNames.fileLink': '…' }`, or via a `titleKey` in the tool's toolbox entry.",
      },
      {
        option: "uploader",
        type: "BlokUploader",
        default: "undefined",
        description:
          "Editor-level uploader for every media asset, routed by asset KIND rather than by tool. `uploadByFile(file, { kind, tool })` and `uploadByUrl(url, { kind, tool })` receive `kind: 'image' | 'video' | 'audio' | 'file'`, so one implementation serves the image, video, audio and file blocks. That includes assets a tool owns outside its own media family, such as the audio block's cover art (`kind: 'image'`, `tool: 'audio'`), which has no tool-level uploader of its own. A tool-level uploader (`tools.image.config.uploader`) stays authoritative for its own kind and takes precedence. This one is the fallback. Without either, assets become `blob:` URLs that do not survive a reload.",
      },
      {
        option: "server",
        type: "string",
        default: "undefined",
        description:
          "Base URL of a service speaking Blok's upload and unfurl contracts, such as `https://blok.myapp.com`, or a same-origin path like `/api/blok`. It is shorthand only. It fills in `uploader` and the bookmark tool's `endpoint` when you have not set them yourself, and anything you set explicitly wins. That is what lets you take the service for link previews while uploading into your own S3, with no bridging code. It does not configure document storage. Your documents stay yours. See `persistence`.",
      },
      {
        option: "ticket",
        type: "string",
        default: "undefined",
        description:
          "Endpoint in YOUR app that mints a short-lived access pass for the signed-in user, answering `{ \"ticket\": \"<pass>\" }`. You only need it when `server` points at a standalone service. Routes running inside your own app already know who the caller is. The editor caches the pass and replaces it ahead of expiry rather than at it, so no request arrives already invalid. Uploads and link previews share the same pass. `@bloklabs/server/ticket` exports `blokTicket()` for minting it, and any backend can do the same with its own JWT library.",
      },
      {
        option: "persistence",
        type: "{ load(): Promise<OutputData | PersistedDocument | null>; save(data: OutputData, ctx: SaveContext): Promise<SaveResult | void>; onError?(error: unknown): void }",
        default: "undefined",
        description:
          "Load the document on mount and save it as it changes, against your own endpoint. The Blok service stores no documents. It takes two callbacks rather than a URL, because the endpoint shape, its auth and the document id are yours. Saves never run in parallel, and only the newest pending document follows the one in flight. So a slow save finishing after a fast one cannot bring stale content back. Loading only happens when you passed no `data`, and setting `onSave` yourself wins. `load` may answer with a version alongside the document. Each `save` is told the version it is overwriting and may report the one it wrote. Blok only carries that version between the two calls, so your endpoint stays the only place a stale write is detected.",
      },
      {
        option: "collaboration",
        type: "{ doc: string; user?: { name: string; color?: string }; offline?: boolean; offlineScope?: string }",
        default: "undefined",
        description:
          "Real-time multiplayer editing against the sync service `server` points at. Two editors opened on the same `doc` see each other's edits live. `doc` is the shared document id, and it becomes one path segment of the sync URL. It must therefore be a single path segment: no `/`, no encoded slash, no `.` or `..`. Anything else is refused at construction rather than failing at the door. `user` is the DISPLAY identity the other people see: the name on their avatar, and the color of their cursor and of the small face parked in the margin beside the block they are in. It is also what the `user: { id }` option, which records edit attribution, gets NAMED by. Set both and peers can read \"Last edited by <name>\" on the blocks you edited, because the id rides into the presence state alongside that name. The name is published to the room. `user.name` is not, so a host that sets only `user.name` names itself and nobody else. Everyone in the room also sees when you were last active, alongside where your cursor is. Set neither and you are present as an anonymous avatar with no id published at all. `color` is HEX only (`#rgb`, `#rrggbb`, with or without alpha). Anything else is replaced with a color from the built-in palette. `offline` keeps a copy of the document in that browser, so edits made while disconnected survive a reload. It is off by default, because it writes document content into browser storage, and it is dropped whenever the service resets the document. It REQUIRES `offlineScope`, an opaque stable id for the signed-in account. Browser storage belongs to the browser rather than to a person, so without a partition the next person on a shared profile is handed the previous one's document. It is never an authorization claim, because the server never sees it, and it is never the display identity. Do not derive it from anything that rotates: a new partition on every refresh strands every copy before it. It requires `server`, and is mutually exclusive with `persistence`. The sync service owns the whole document round-trip, so a second load/save pair would give the document two owners. Both pairings are refused at construction. Absent, it costs nothing: Blok opens no socket. Mount-only: changing it means recreating the editor. React and Vue take it as a `collaboration` prop. Angular has no dedicated input, so it goes through `[config]`. Connection state and the people present arrive on the `collaboration:status` event.",
      },
      {
        option: "theme",
        type: "'auto' | 'light' | 'dark'",
        default: "'auto'",
        description:
          "Color theme; 'auto' follows the OS preference via prefers-color-scheme",
      },
      {
        option: "onThemeChange",
        type: "(resolvedTheme: ResolvedTheme) => void",
        default: "undefined",
        description:
          "Fires with the RESOLVED theme ('light' or 'dark') whenever it changes. That covers the OS preference flipping while `theme` is 'auto', and `theme.set()` changing what the theme resolves to. It does not fire on initialization, and it does not fire when a `theme.set()` leaves the resolved theme unchanged. It is a core config option, not an adapter-only prop. The framework adapters expose the same callback as the `onThemeChange` prop, the `theme-change` emit and the `themeChange` output.",
      },
      {
        option: "link",
        type: "{ target?: string; rel?: string; transformHref?: (href: string) => string; transform?: (context: LinkTransformContext) => LinkTransformResult | void }",
        default: "undefined",
        description:
          "Controls the anchors Blok creates, instead of post-processing the rendered DOM. It applies on every path that produces an `<a>`: the Link inline tool, `blocks.render()` (anchors coming from stored block HTML) and paste. `target` defaults to '_blank' and `rel` to 'nofollow'. `transform` is the superset and supersedes `transformHref`, which is then ignored. It receives the href, text and element, and may return `href`, `target`, `rel` and extra `attributes`. Omitted fields fall back to the shorthand defaults, including the same-page `_self` rule. Both must be idempotent: on the render and paste paths they re-run against already-transformed anchors on every render.",
      },
      {
        option: "linkPaste",
        type: "{ allowGenericEmbed?: boolean; allowedEmbedOrigins?: string[] }",
        default: "undefined",
        description:
          "Notion-style link-paste behavior. Set `allowGenericEmbed: true` to also offer \"Create embed\" (framed in a sandboxed iframe) for URLs that match no registered embed provider. The default keeps Blok's registry-only embed guarantee. `allowedEmbedOrigins` is the fine-grained middle ground: hostnames (`dashboards.example.com`) or wildcard subdomain patterns (`*.internal.example.dev`) that may be framed as generic embeds. A stored generic embed matching neither renders as a safe clickable link card instead of an iframe, so the URL stays visible without being framed.",
      },
      {
        option: "user",
        type: "{ id: string; name?: string }",
        default: "undefined",
        description:
          "Identity of the current editor. Blok stamps `user.id` onto the `lastEditedBy` of every block this user edits, and without it `lastEditedBy` stays null. Add `name` and the block settings footer reads \"Last edited by <name>\" with no callback to wire. That name is local only, so peers name you from `collaboration.user.name`. Set both to be named everywhere. For other people's ids Blok asks `resolveUser`, and in a collaborative room it also learns names from the peers themselves. The id is not private under collaboration: it goes into the shared document as `lastEditedBy`, and, only when `collaboration.user.name` is set too, into the presence state next to that name. That is how peers name each other. Pass an opaque per-document token instead of an internal account key if that matters.",
      },
      {
        option: "resolveUser",
        type: "(id: string) => UserInfo | Promise<UserInfo | null> | null",
        default: "undefined",
        description:
          "Resolves the `lastEditedBy` user id Blok shows in the block settings footer. It may return synchronously or asynchronously. Return null for an unknown user, and Blok falls back to the name that user published to the collaborative room, or to the date alone. Blok asks at most once per id: it keeps both an answer and an \"I don't know this one\" for the editor's lifetime. A callback that throws or rejects is absorbed rather than breaking the menu, and because that is not an answer, the id is asked about again later. Wiring this callback also means an unauthenticated name from the room is never shown while the lookup is still running. The id arrives trimmed and stripped of NUL. One longer than 128 characters is refused rather than passed on.",
      },
      {
        option: "notifierPosition",
        type: "NotifierPosition",
        default: "'bottom-center'",
        description:
          "Where the built-in toast container is anchored on screen.",
      },
      {
        option: "notifier",
        type: "(options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions) => void",
        default: "undefined",
        description:
          "Replaces the built-in toast entirely. Blok calls your handler with the same options object instead of rendering its own DOM notification.",
      },
      {
        option: "logLevel",
        type: "LogLevels",
        default: "LogLevels.VERBOSE",
        description:
          "How much Blok logs to the console. The values are `VERBOSE`, `INFO`, `WARN` and `ERROR`. There is no \"silent\" level, so `LogLevels.ERROR` is the quietest. `LogLevels` is a named export of the package root.",
      },
    ],
  },
  {
    id: "blocks-api",
    badge: "Blocks",
    title: "Blocks API",
    description:
      "Manage blocks in the editor: create, delete, update, and reorder content.",
    methods: [
      {
        name: "blocks.clear()",
        returnType: "Promise<void>",
        description: "Remove all blocks from the editor.",
        example: `await editor.blocks.clear();
// All content removed; editor keeps one empty paragraph`,
      },
      {
        name: "blocks.render(data)",
        returnType: "Promise<void>",
        description:
          "Render passed JSON data as blocks, replacing the current document. It is echo-safe: when the incoming document is structurally equal to the current saved content (`time`/`version` are ignored), the call is a caret-preserving no-op. So the `data → render → onSave → setState → data` round-trip needs no dedupe on your side. It accepts the loose wire shape (`LooseOutputData`). The editor deep-clones the data, so the passed object is never mutated or retained. You can pass frozen store state (Redux, Immer) directly.",
        example: `const data = {
  blocks: [
    { id: '1', type: 'paragraph', data: { text: 'Hello World' } },
    { id: '2', type: 'header', data: { text: 'Title', level: 1 } }
  ]
};
await editor.blocks.render(data);`,
      },
      {
        name: "blocks.renderFromHTML(data)",
        returnType: "Promise<void>",
        description:
          "Render HTML string as blocks by converting it to block format.",
        example: `const html = '<h1>Title</h1><p>Hello World</p>';
await editor.blocks.renderFromHTML(html);
// HTML is converted to appropriate blocks`,
      },
      {
        name: "blocks.importMarkdown(md, options?)",
        returnType: "Promise<OutputData>",
        description:
          "Converts a Markdown string to blocks and renders them. This REPLACES the current document, because it calls `blocks.render()` internally. The converter is lazy-loaded on the first call. The resolved OutputData is the document that was rendered. `options` is a `MarkdownImportConfig` (tool mapping, GFM toggle, micromark/mdast extensions). To add blocks instead of replacing them, use `markdownToBlocks()` from the standalone `@bloklabs/core/markdown` subpath together with `blocks.insertMany()`.",
        example: `const data = await editor.blocks.importMarkdown('# Title\\n\\n- one\\n- two');
// The whole document is replaced; data is the rendered OutputData`,
        params: [
          {
            name: "md",
            type: "string",
            required: true,
            description: "Markdown source string.",
          },
          {
            name: "options",
            type: "MarkdownImportConfig",
            required: false,
            default: "undefined",
            description: "Tool mapping, GFM toggle, and micromark/mdast extensions.",
          },
        ],
      },
      {
        name: "blocks.exportMarkdown()",
        returnType: "Promise<string>",
        description:
          "Serializes the current document to Markdown. It is the outbound twin of `importMarkdown`. Blocks are read through the Saver, so the output reflects the saved (validated) document, not the raw DOM. The promise resolves to '' when there is nothing to save. Blocks owned by a table cell are serialized inside the pipe table, not repeated as loose lines. What Markdown cannot express is degraded. Table `colspan`/`rowspan` and heading columns are dropped. A table with no heading row gets an empty header row, because GFM requires one.",
        example: `const md = await editor.blocks.exportMarkdown();
// → '# Title\\n\\n- one\\n- two'`,
      },
      {
        name: "blocks.delete(index?, setCaret?)",
        returnType: "Promise<void>",
        description:
          "Remove the block at the specified index, or current block if no index provided.",
        example: `// Delete current block
await editor.blocks.delete();

// Delete block at index 0
await editor.blocks.delete(0);

// Delete without moving the user's caret (programmatic deletion)
await editor.blocks.delete(0, false);`,
        params: [
          {
            name: "index",
            type: "number",
            required: false,
            default: "current block index",
            description: "Index of the block to delete.",
          },
          {
            name: "setCaret",
            type: "boolean",
            required: false,
            default: "true",
            description:
              "Whether to move the caret to the surviving block after deletion. Pass false to avoid stealing the user's caret during programmatic deletion.",
          },
        ],
      },
      {
        name: "blocks.move(toIndex, fromIndex?)",
        returnType: "void",
        description:
          "Moves a block to a new position. If fromIndex is not provided, moves the current block.",
        example: `// Move current block to top
editor.blocks.move(0);

// Move block from index 2 to index 0
editor.blocks.move(0, 2);`,
      },
      {
        name: "blocks.getBlockByIndex(index)",
        returnType: "BlockAPI | undefined",
        description:
          "Get the BlockAPI object for the block at the specified index.",
        example: `const block = editor.blocks.getBlockByIndex(0);
if (block) {
  console.log(block.id, block.name);
}`,
      },
      {
        name: "blocks.getById(id)",
        returnType: "BlockAPI | null",
        description:
          "Get the BlockAPI object for the block with the specified ID.",
        example: `const block = editor.blocks.getById('block-123');
if (block) {
  await editor.blocks.update(block.id, { text: 'New content' });
}`,
      },
      {
        name: "blocks.getCurrentBlockIndex()",
        returnType: "number",
        description: "Get the index of the currently focused block.",
        example: `const index = editor.blocks.getCurrentBlockIndex();
console.log('Current block index:', index);`,
      },
      {
        name: "blocks.getBlockIndex(blockId)",
        returnType: "number | undefined",
        description: "Get the index of a block by its ID.",
        example: `const index = editor.blocks.getBlockIndex('block-123');
if (index !== undefined) {
  console.log('Block is at index:', index);
}`,
      },
      {
        name: "blocks.getBlockByElement(element)",
        returnType: "BlockAPI | undefined",
        description:
          "Get the BlockAPI object for the block containing the given HTML element.",
        example: `document.addEventListener('click', (e) => {
  const block = editor.blocks.getBlockByElement(e.target);
  if (block) {
    console.log('Clicked on block:', block.id);
  }
});`,
      },
      {
        name: "blocks.scrollToBlock(id)",
        returnType: "void",
        description:
          "Scrolls a block into view, selects it, pulses the arrival highlight and announces the navigation to assistive tech. It is the public counterpart of the boot-time URL-hash scroll. It does nothing when no block with that id is in the document. Framework adapters that mount into a detached holder (React/Vue/Angular) render seeded content before it joins the page, so the boot hash scroll defers. @bloklabs/react drains it automatically once the holder connects. For deep linking, call this method yourself after the editor is ready.",
        example: `editor.blocks.scrollToBlock(nodeId);`,
      },
      {
        name: "blocks.getChildren(parentId)",
        returnType: "BlockAPI[]",
        description: "Get all child blocks of a parent container block.",
        example: `const children = editor.blocks.getChildren('parent-block-id');
children.forEach(child => {
  console.log('Child:', child.id);
});`,
      },
      {
        name: "blocks.setBlockParent(blockId, parentId)",
        returnType: "void",
        description:
          "Reparents a block. It updates the block's `parentId` and the parent's `contentIds` through core's single reparent chokepoint. Pass `null` to move the block back to the root level. An unknown `blockId` does nothing and logs a warning. A `parentId` that would make the block a descendant of itself throws.",
        example: `// Move a block into a container block
editor.blocks.setBlockParent('child-block-id', 'parent-block-id');

// Move it back to the root level
editor.blocks.setBlockParent('child-block-id', null);`,
      },
      {
        name: "blocks.insertInsideParent(parentId, insertIndex, childData?, toolName?)",
        returnType: "BlockAPI",
        description:
          "Inserts a block as a child of `parentId` atomically. The creation and the parent assignment are grouped into ONE undo entry, so a single Cmd+Z removes it completely. That is better than `insert()` followed by a reparent, which is two entries. `insertIndex` is the FLAT document index where the child should appear. `toolName` picks the child's block tool and defaults to `config.defaultBlock`. A tool that is restricted inside table cells is demoted to the default block when the new child would land inside one. An unregistered name throws before anything is written. `childData` defaults to `{ text: '' }` for the default block. For any other `toolName` it defaults to `{}`, which lets the tool apply its own defaults.",
        example: `const parentIndex = editor.blocks.getBlockIndex('parent-block-id') ?? 0;
const child = editor.blocks.insertInsideParent(
  'parent-block-id',
  parentIndex + 1,
  { text: 'Nested content' },
);

// A TYPED child in the same single undo entry — no insert-then-reparent
editor.blocks.insertInsideParent(
  'parent-block-id',
  parentIndex + 1,
  { text: 'Nested heading', level: 2 },
  'header',
);`,
      },
      {
        name: "blocks.getBlocksCount()",
        returnType: "number",
        description: "Get the total number of blocks in the editor.",
        example: `const count = editor.blocks.getBlocksCount();
console.log('Total blocks:', count);`,
      },
      {
        name: "blocks.insert(type?, data?, config?, index?, needToFocus?, replace?, id?, tunes?, origin?)",
        returnType: "BlockAPI",
        description:
          "Insert a new block with full control over its properties and position.",
        example: `// Insert after the current block with the default type
const block = editor.blocks.insert();
// → BlockAPI { id: 'kP3xQ...', name: 'paragraph', ... }

// Insert paragraph with data at index 0
const block = editor.blocks.insert('paragraph', { text: 'Hello' }, undefined, 0);

// Insert with custom ID
const block = editor.blocks.insert('header', { text: 'Title' }, undefined, undefined, undefined, undefined, 'custom-id');

// From your own slash menu / toolbar: declare the user gesture so a container
// tool seeds its default children (see BlockOrigin on the tool contract)
const block = editor.blocks.insert('column_list', undefined, undefined, index, undefined, undefined, undefined, undefined, 'user');`,
        params: [
          {
            name: "type",
            type: "string",
            required: false,
            default: "config.defaultBlock",
            description: "Tool name to instantiate.",
          },
          {
            name: "data",
            type: "BlockToolData",
            required: false,
            default: "{}",
            description: "Initial tool data for the new block.",
          },
          {
            name: "config",
            type: "ToolConfig",
            required: false,
            default: "{}",
            description:
              "Ignored. It is accepted only to keep the positional signature stable. The editor binds it to `_config` and never reads it. The block-manager insert options carry no `config` field, so the created block still uses the editor-level tool config from `config.tools`. Pass `undefined`.",
          },
          {
            name: "index",
            type: "number",
            required: false,
            default: "current block index + 1",
            description: "Position to insert the block at.",
          },
          {
            name: "needToFocus",
            type: "boolean",
            required: false,
            default: "true",
            description: "Whether to move focus to the inserted block. Pass false to insert without moving the caret.",
          },
          {
            name: "replace",
            type: "boolean",
            required: false,
            default: "false",
            description: "Replace the existing block at index instead of inserting around it.",
          },
          {
            name: "id",
            type: "string",
            required: false,
            default: "auto-generated",
            description: "Custom id for the new block.",
          },
          {
            name: "tunes",
            type: "{ [name: string]: BlockTuneData }",
            required: false,
            default: "undefined",
            description: "Optional tune data applied at creation, keyed by tune name.",
          },
          {
            name: "origin",
            type: "BlockOrigin",
            required: false,
            default: "'api'",
            description:
              "Why the block is being created. It is handed to the tool constructor as `origin`. That is how a container tool tells a genuine creation (seed default children) from a re-materialisation, such as a document load, an undo/redo replay or a paste (never seed). Pass `'user'` when the insert comes from your own insertion UI: a custom toolbar, slash menu or keyboard shortcut. Then Blok's own containers (`column_list`, `column`) and your own behave the same as they do for the built-in menu. Leave it out for programmatic inserts and refetches. The `'api'` default is still a creation, but it is never mistaken for a user gesture.",
          },
        ],
        errors: [
          {
            condition: "No `type` is given and no `defaultBlock` is configured.",
            message: "Could not insert Block. Tool name is not specified.",
            resolution: "Pass an explicit `type`, or set `defaultBlock` in the editor config.",
          },
          {
            condition: "The resolved tool name is not registered in the editor.",
            message: 'Could not compose Block. Tool «<type>» not found.',
            resolution: "Register the tool in the editor's `tools` config before inserting a block of that type.",
          },
          {
            condition: "`replace: true` is passed but no block exists at `index`.",
            message: 'Could not replace Block at index <index>. Block not found.',
            resolution: "Check `index` against `blocks.getBlocksCount()` before calling with `replace: true`.",
          },
        ],
      },
      {
        name: "blocks.insertMany(blocks, index?)",
        returnType: "BlockAPI[]",
        description:
          "Insert multiple blocks at once. When the index is omitted, the blocks are appended at the end of the document.",
        example: `const blocksToInsert = [
  { id: '1', type: 'paragraph', data: { text: 'First' } },
  { id: '2', type: 'paragraph', data: { text: 'Second' } }
];
const inserted = editor.blocks.insertMany(blocksToInsert, 0);
console.log('Inserted:', inserted.length, 'blocks');`,
        params: [
          {
            name: "blocks",
            type: "OutputBlockData[] | LooseOutputBlockData[]",
            required: true,
            description:
              "The blocks to insert. Loose wire blocks are accepted. A `null` `data` becomes `{}`, and a `null`/empty `id` gets a generated one.",
          },
          {
            name: "index",
            type: "number",
            required: false,
            default: "end of document",
            description:
              "Position to insert at. When omitted, defaults to appending at the end of the document.",
          },
        ],
        errors: [
          {
            condition: "The provided `index` is negative.",
            message: "Index should be greater than or equal to 0",
            resolution: "Pass an `index` of 0 or greater, or omit it to append.",
          },
        ],
      },
      {
        name: "blocks.composeBlockData(toolName)",
        returnType: "Promise<BlockToolData>",
        description: "Create empty block data for the specified tool type.",
        example: `const emptyData = await editor.blocks.composeBlockData('paragraph');
// Returns: { text: '' } or appropriate empty state for the tool`,
        errors: [
          {
            condition: "`toolName` is not a registered tool.",
            message: 'Block Tool with type "<toolName>" not found',
            resolution: "Register the tool in the editor's `tools` config first.",
          },
        ],
      },
      {
        name: "blocks.update(id, data?, tunes?)",
        returnType: "Promise<BlockAPI>",
        description:
          "Updates a block's data and/or tunes. The data update is applied IN PLACE when the block's tool implements `setData(newData)` on its prototype. Every React/Vue/Angular block does, as do the built-in header, list, code, toggle and table tools. In place means the same block instance, the same DOM holder and the same mounted component keep living. So ephemeral tool state, adopted child blocks and the caret all survive. That is what makes `update()` safe to call on every keystroke, for example when renaming a card while the user types. Three cases fall back to recomposing the block: tools without `setData`, a tool whose `setData` returns `false` (it needs a different DOM shape), and any call that passes `tunes`. Recomposing means a fresh tool instance replaces the old one, which is destroyed.",
        example: `// Update block data
const block = await editor.blocks.update('block-123', { text: 'New text' });

// Update with tunes
const block = await editor.blocks.update('block-123', undefined, { alignment: 'center' });

// Guard against an id that no longer exists (e.g. the block was deleted
// concurrently) instead of letting the rejection surface unhandled
try {
  await editor.blocks.update(staleId, { text: 'New text' });
} catch {
  console.warn('Block was already removed, skipping update');
}`,
        params: [
          {
            name: "id",
            type: "string",
            required: true,
            description: "Id of the block to update.",
          },
          {
            name: "data",
            type: "Partial<BlockToolData>",
            required: false,
            default: "undefined",
            description: "Partial data merged into the block's existing data.",
          },
          {
            name: "tunes",
            type: "Record<string, BlockTuneData>",
            required: false,
            default: "undefined",
            description: "Tune data merged into the block's existing tunes.",
          },
        ],
        errors: [
          {
            condition: "No block exists with the given `id`.",
            message: 'Block with id "<id>" not found',
            resolution: "Confirm the id with `blocks.getById()` before calling `update()`.",
          },
        ],
      },
      {
        name: "blocks.convert(id, newType, dataOverrides?)",
        returnType: "Promise<BlockAPI>",
        description:
          "Convert a block to a different type. Both tools must support conversion config.",
        example: `// Convert paragraph to header
const headerBlock = await editor.blocks.convert('block-123', 'header', { level: 2 });

// Convert with data overrides
const headerBlock = await editor.blocks.convert('block-123', 'header', { text: 'New Title', level: 1 });

// Not every pair of tools supports conversion — guard it rather than
// assuming the target type is always convertible
try {
  await editor.blocks.convert('block-123', 'table');
} catch (error) {
  console.warn('Conversion not supported between these tools:', error);
}`,
        params: [
          {
            name: "id",
            type: "string",
            required: true,
            description: "Id of the block to convert. Its tool must declare conversionConfig.export.",
          },
          {
            name: "newType",
            type: "string",
            required: true,
            description: "Name of the registered tool to convert to. Its tool must declare conversionConfig.import.",
          },
          {
            name: "dataOverrides",
            type: "BlockToolData",
            required: false,
            default: "undefined",
            description: "Data fields to overwrite on the resulting block after conversion.",
          },
        ],
        errors: [
          {
            condition: "No block exists with the given `id`.",
            message: 'Block with id "<id>" not found',
            resolution: "Confirm the id with `blocks.getById()` before calling `convert()`.",
          },
          {
            condition: "`newType` is not a registered tool.",
            message: 'Block Tool with type "<newType>" not found',
            resolution: "Register the target tool in the editor's `tools` config.",
          },
          {
            condition: "The source tool has no conversionConfig.export, the target tool has no conversionConfig.import, or neither does.",
            message: 'Conversion from "<sourceType>" to "<newType>" is not possible. <ToolName(s)> tool(s) should provide a "conversionConfig"',
            resolution: "Add a conversionConfig to whichever tool is missing one, or convert through an intermediate tool that supports both directions.",
          },
        ],
      },
      {
        name: "blocks.splitBlock(currentBlockId, currentBlockData, newBlockType, newBlockData, insertIndex)",
        returnType: "BlockAPI",
        description:
          "Atomically split a block by updating the current block and inserting a new block. Both operations are grouped into a single undo entry.",
        example: `// Split a paragraph at cursor position
const newBlock = editor.blocks.splitBlock(
  'current-block-id',
  { text: 'First part' },
  'paragraph',
  { text: 'Second part' },
  1
);`,
      },
      {
        name: "blocks.stopBlockMutationWatching(index)",
        returnType: "void",
        description:
          "Stop mutation watching on a block at the specified index. Use this to prevent spurious block-changed events during block replacement operations.",
        example: `// Replace a block without triggering change events
editor.blocks.stopBlockMutationWatching(0);
// Perform block replacement...
// Mutation observer will not fire for this block`,
      },
      {
        name: "blocks.startBlockMutationWatching(blockId)",
        returnType: "void",
        description:
          "Re-arms mutation watching on a block previously silenced by `stopBlockMutationWatching`. It takes an id, not an index, because inserts and replacements between the two calls shift indexes. An id that no longer exists is silently skipped: a block replaced in place was constructed with its own watcher.",
        example: `const blockId = editor.blocks.getBlockByIndex(0)?.id;
editor.blocks.stopBlockMutationWatching(0);
// Perform block replacement...
if (blockId) {
  editor.blocks.startBlockMutationWatching(blockId);
}`,
      },
      {
        name: "blocks.transact(fn)",
        returnType: "void",
        description:
          "Groups every block operation performed inside `fn` into a single undo entry. `fn` must be SYNCHRONOUS. Operations that land after an await are no longer part of the group. Use it so structural edits are not partially undoable.",
        example: `editor.blocks.transact(() => {
  editor.blocks.insert('paragraph', { text: 'One' });
  editor.blocks.insert('paragraph', { text: 'Two' });
});
// A single Cmd+Z removes both blocks`,
      },
      {
        name: "blocks.beginTransaction()",
        returnType: "void",
        description:
          "Opens an undo group that stays open across async boundaries. Every block operation until `endTransaction()` lands in one undo entry. Use it for pointer gestures that mutate the document continuously, such as dragging a table's corner to add rows. `transact()` cannot help there, because it only wraps a synchronous function. Pair every call with `endTransaction()`.",
        example: `editor.blocks.beginTransaction();
// ... continuous mutations across async boundaries ...
editor.blocks.endTransaction();`,
      },
      {
        name: "blocks.endTransaction()",
        returnType: "void",
        description: "Close the undo group opened by `beginTransaction()`.",
        example: `editor.blocks.beginTransaction();
// ... continuous mutations across async boundaries ...
editor.blocks.endTransaction();`,
      },
      {
        name: "blocks.transactWithoutCapture(fn)",
        returnType: "void",
        description:
          "Run block operations without recording anything in the undo history. Use it for auto-repair and normalization (e.g. ensuring an empty cell always has a block) that Cmd+Z should never step through.",
        example: `editor.blocks.transactWithoutCapture(() => {
  editor.blocks.insert('paragraph', {}, undefined, 0);
});
// Nothing was added to the undo history`,
      },
      {
        name: "blocks.setPointerDragActive(active)",
        returnType: "void",
        description:
          "Tell core that a pointer drag interaction started or ended. While it is active, DOM-mutation-triggered Yjs syncs are suppressed. That way browser DOM churn during the drag cannot corrupt Yjs state.",
        example: `editor.blocks.setPointerDragActive(true);
// ... run the drag gesture ...
editor.blocks.setPointerDragActive(false);`,
      },
    ],
    properties: [
      {
        name: "isSyncingFromYjs",
        type: "boolean",
        description:
          "A readonly getter. It is true while a Yjs sync operation (undo/redo) is in progress. Tools read it to skip cleanup that would fight undo state. This is a PROPERTY on `editor.blocks`, unlike the React hook's `isSyncingFromYjs()` method.",
      },
      {
        name: "isPointerDragActive",
        type: "boolean",
        description:
          "A readonly getter. It is true while a pointer drag interaction is active. Framework adapters read it to defer a programmatic `dispatchChange` in the middle of a drag, because core silently drops such a change. They re-dispatch it once the drag ends.",
      },
    ],
  },
  {
    id: "block-api",
    badge: "Block",
    title: "BlockAPI",
    description:
      "Interface for working with individual blocks. Returned by blocks.getById(), blocks.getBlockByIndex(), and blocks.insert().",
    methods: [
      {
        name: "block.save()",
        returnType: "Promise<void|SavedData>",
        description: "Save the block content and return its data.",
        example: `const block = editor.blocks.getById('block-123');
const saved = await block.save();
// saved resolves to a SavedData object (or undefined if extraction fails):
// { id: 'block-123', tool: 'paragraph', data: { text: 'Block content' }, time: 1717000000000 }
console.log(saved?.data); // { text: 'Block content' }`,
      },
      {
        name: "block.validate(data)",
        returnType: "Promise<boolean>",
        description: "Validate block data against the tool's validation rules.",
        example: `const block = editor.blocks.getById('block-123');
const isValid = await block.validate({ text: 'Hello' });
if (!isValid) {
  console.log('Block data is invalid');
}`,
      },
      {
        name: "block.call(methodName, param?)",
        returnType: "void",
        description: "Call a custom method on the block's tool.",
        example: `const block = editor.blocks.getById('block-123');
// Call a custom method defined in the tool
block.call('showNotification', { message: 'Hello' });`,
      },
      {
        name: "block.dispatchChange()",
        returnType: "void",
        description: "Manually trigger the onChange callback for this block.",
        example: `const block = editor.blocks.getById('block-123');
// Trigger change after invisible modification
block.dispatchChange();`,
      },
      {
        name: "block.getActiveToolboxEntry()",
        returnType: "Promise<ToolboxConfigEntry | undefined>",
        description:
          "Get the active toolbox entry for this block (e.g., Heading 1 vs Heading 2).",
        example: `const block = editor.blocks.getById('block-123');
const entry = await block.getActiveToolboxEntry();
if (entry) {
  console.log('Active entry:', entry.title);
}`,
      },
      {
        name: "block.getChildren()",
        returnType: "BlockAPI[]",
        description:
          "This block's direct children as BlockAPI objects, in order. Every BlockAPI the editor hands out is live. So you can walk the children it returns recursively (`child.getChildren()`) and change them (`child.setParent(...)`, `child.insertChild(...)`).",
        example: `const block = editor.blocks.getById('toggle-123');
block?.getChildren().forEach((child) => console.log(child.id));`,
      },
      {
        name: "block.setParent(parentId)",
        returnType: "void",
        description:
          "Reparent this block under `parentId`, or back to the root level with `null`. It goes through core's single `setBlockParent` entry point, so the parent's `contentIds` is updated together with this block's `parentId`.",
        example: `const block = editor.blocks.getById('block-123');
block?.setParent('parent-block-id');

// Back to the root level
block?.setParent(null);`,
      },
      {
        name: "block.insertChild(childData?, position?, toolName?, options?)",
        returnType: "BlockAPI",
        description:
          "Insert a child block under THIS block atomically. Creation and parent assignment land in a single undo entry (it delegates to `blocks.insertInsideParent`). `position` is a `BlockChildPosition`: 'start' | 'end' | { before: childId } | { after: childId }. It defaults to 'end', which appends past the whole subtree. `toolName` picks the child's block tool and defaults to `config.defaultBlock`, so a TYPED child is one operation instead of insert-then-reparent. A tool that is restricted inside table cells is demoted to the default block when the new child would land inside one. `childData` defaults to `{ text: '' }` for the default block, and to `{}` when `toolName` names a different tool. `options` uses the same `{ focus, caret, id, tunes, replace }` vocabulary as the framework adapters' rich `insert` spec. So a container tool never has to place the caret by hand, or follow up with an `update` to apply tunes.",
        example: `const block = editor.blocks.getById('toggle-123');
const child = block?.insertChild({ text: 'Hidden content' });

// Place it among the existing children instead of appending
block?.insertChild({ text: 'First' }, 'start');
block?.insertChild({ text: 'After that one' }, { after: 'child-id' });

// A typed child, in a single undo entry
block?.insertChild({ text: 'Section', level: 3 }, 'end', 'header');

// Drop the caret into the new child at a specific offset
block?.insertChild({ text: 'Draft' }, 'end', undefined, { caret: { offset: 5 } });

// Idempotent: a re-running effect cannot duplicate this child
block?.insertChild({ text: 'Intro' }, 'start', undefined, { id: 'intro-row' });

// Child-level "turn into" — overwrite an existing child, keeping it parented
block?.insertChild({ text: 'Now a heading', level: 3 }, { before: 'child-id' }, 'header', { replace: true });`,
        params: [
          {
            name: "childData",
            type: "BlockToolData",
            required: false,
            default: "{ text: '' } / {}",
            description:
              "Data for the new child block. It defaults to an empty paragraph blob for the default block tool. When toolName is given it defaults to {}, which lets the tool apply its own defaults.",
          },
          {
            name: "position",
            type: "BlockChildPosition",
            required: false,
            default: "'end'",
            description:
              "Where among the existing children to insert: 'start', 'end', { before: childId } or { after: childId }.",
          },
          {
            name: "toolName",
            type: "string",
            required: false,
            default: "config.defaultBlock",
            description:
              "Block tool to create for the child. It is demoted to the default block when it is restricted inside table cells and the new child would land inside one.",
          },
          {
            name: "options",
            type: "InsertChildOptions",
            required: false,
            default: "{}",
            description:
              "focus makes the new child the current block. caret places the caret inside it ({ position?, offset? }), and applies only when a child is actually created. id sets an explicit id. An id that already exists works as insert-if-absent: that child is returned and nothing is created. tunes is block tune data applied at creation. replace overwrites the child named by an object position instead of inserting beside it. With 'start' or 'end' there is nothing to overwrite, so the call throws.",
          },
        ],
      },
      {
        name: "block.moveChild(childId, delta)",
        returnType: "void",
        description:
          "Move a direct child by `delta` positions among its siblings, clamped to the valid range. A child carrying its own subtree lands past the target sibling's descendants, not inside them. It does nothing when `delta` is 0, when `childId` is not a direct child, or when the clamped move would not change the position.",
        example: `const block = editor.blocks.getById('toggle-123');
block?.moveChild('child-id', -1); // one position toward the start
block?.moveChild('child-id', 1);  // one position toward the end`,
      },
    ],
    properties: [
      { name: "id", type: "string", description: "Unique block identifier" },
      {
        name: "name",
        type: "string",
        description: 'Tool name (e.g., "paragraph", "header")',
      },
      {
        name: "config",
        type: "ToolConfig",
        description: "Tool config passed on initialization",
      },
      {
        name: "holder",
        type: "HTMLElement",
        description: "Wrapper of Tool's HTML element",
      },
      {
        name: "isEmpty",
        type: "boolean",
        description: "True if block content is empty",
      },
      {
        name: "selected",
        type: "boolean",
        description:
          "True if the block is part of a BLOCK-level selection (rubber-band drag, Shift+Click, Shift+Arrow, Cmd/Ctrl+A). A drag across the text of several blocks makes a character-level selection instead. That marks no block as selected, so read it from the document's own Selection.",
      },
      {
        name: "focusable",
        type: "boolean",
        description: "True if block has inputs to be focused",
      },
      {
        name: "stretched",
        type: "boolean",
        description: "Getter/setter for block stretch state",
      },
      {
        name: "parentId",
        type: "string | null",
        description: "Id of the parent block, or null if this block has no parent",
      },
      {
        name: "contentIds",
        type: "readonly string[]",
        description:
          "Ids of this block's direct children, in order. It is a read-only copy, so changing it does nothing. This is the block-level counterpart of parentId: it lets a container tool read its children without reaching for the editor API",
      },
      {
        name: "preservedData",
        type: "BlockToolData",
        description:
          "Last successfully extracted block tool data. It is synchronous, so it helps when async save() is not feasible, e.g. clipboard operations",
      },
      {
        name: "preservedTunes",
        type: "{ [name: string]: BlockTuneData }",
        description:
          "Last successfully extracted block tune data. It is synchronous, so it helps when async save() is not feasible, e.g. clipboard operations",
      },
    ],
  },
  {
    id: "caret-api",
    badge: "Caret",
    title: "Caret API",
    description: "Control cursor position and selection within the editor.",
    methods: [
      {
        name: "caret.setToFirstBlock(position?, offset?)",
        returnType: "boolean",
        description:
          "Set caret to the first block with optional position and offset.",
        example: `// Set to start of first block
editor.caret.setToFirstBlock('start');

// Set to end of first block
editor.caret.setToFirstBlock('end');

// Offset applies only to the 'default' position —
// 'start' and 'end' place the caret at the boundary and ignore it
editor.caret.setToFirstBlock('default', 5);`,
      },
      {
        name: "caret.setToLastBlock(position?, offset?)",
        returnType: "boolean",
        description:
          "Set caret to the last block with optional position and offset.",
        example: `// Focus last block at end
editor.caret.setToLastBlock('end');

// Focus last block at start
editor.caret.setToLastBlock('start');`,
      },
      {
        name: "caret.setToPreviousBlock(position?, offset?)",
        returnType: "boolean",
        description: "Move caret to the previous block.",
        example: `editor.caret.setToPreviousBlock('end');
// Caret now at end of previous block`,
      },
      {
        name: "caret.setToNextBlock(position?, offset?)",
        returnType: "boolean",
        description: "Move caret to the next block.",
        example: `editor.caret.setToNextBlock('start');
// Caret now at start of next block`,
      },
      {
        name: "caret.setToBlock(blockOrIdOrIndex, position?, offset?)",
        returnType: "boolean",
        description: "Set caret to a specific block by BlockAPI, ID, or index.",
        example: `// By index
editor.caret.setToBlock(0, 'end');
// → true if the caret moved, false if the target block doesn't exist

// By ID
editor.caret.setToBlock('block-123', 'start');

// By BlockAPI (getById can return null, so guard it)
const block = editor.blocks.getById('block-123');
if (block) {
  editor.caret.setToBlock(block);
}`,
        params: [
          {
            name: "blockOrIdOrIndex",
            type: "BlockAPI | string | number",
            required: true,
            description: "Target block, given as a BlockAPI instance, block id, or numeric index.",
          },
          {
            name: "position",
            type: "'start' | 'end' | 'default'",
            required: false,
            default: "'default'",
            description: "Where within the block to place the caret.",
          },
          {
            name: "offset",
            type: "number",
            required: false,
            default: "0",
            description: "Absolute character offset from the start of the block's current input. It applies only when `position` is `'default'`. The values `'start'` and `'end'` place the caret at the boundary and ignore the offset.",
          },
        ],
        errors: [
          {
            condition: "blockOrIdOrIndex is a valid id or index that does not resolve to an existing block (unknown id or out-of-range index).",
            resolution: "For id and index inputs, check the boolean return value. Only a falsy result tells you the target was not found. Passing a null BlockAPI, such as an unchecked getById() result, is invalid input and throws, so null-check before calling.",
          },
        ],
      },
      {
        name: "caret.focus(atEnd?)",
        returnType: "boolean",
        description:
          "Set focus to the editor, optionally at the end of content.",
        example: `// Focus at start
editor.caret.focus();

// Focus at end
editor.caret.focus(true);`,
      },
      {
        name: "caret.updateLastCaretAfterPosition()",
        returnType: "void",
        description:
          'Update the "after" position of the most recent caret undo entry. Use it after async caret movements.',
        example: `// After moving caret asynchronously
requestAnimationFrame(() => {
  editor.caret.setToBlock(0);
  editor.caret.updateLastCaretAfterPosition();
});`,
      },
    ],
  },
  {
    id: "events-api",
    badge: "Events",
    title: "Events API",
    description: "Subscribe to and manage editor lifecycle events.",
    methods: [
      {
        name: "on(event, callback)",
        returnType: "void",
        description: "Subscribe to an editor event.",
        example: `// Listen for block mutations — the callback receives the event payload,
// not an API object
editor.on('block changed', ({ event }) => {
  console.log('Block mutated:', event.type);
});

// Listen for individual block renders
editor.on('block:rendered', ({ blockId }) => {
  console.log('Rendered block:', blockId);
});

// Wait for a container block's child holders to settle before touching them.
// A React/Vue/Angular block renders through a portal that commits AFTER
// block:rendered, so a caret set in that window is dropped; this event fires
// once the holders are in the container's slot (it repeats on every later
// reconciliation pass — it is a settle signal, not a change signal).
const child = editor.blocks.insertInsideParent(containerId);

editor.on('block:childrenMounted', ({ blockId, childIds }) => {
  if (blockId === containerId && childIds.includes(child.id)) {
    editor.caret.setToBlock(child.id);
  }
});

// With the \`collaboration\` config on, this is the sync/presence indicator
// feed: status is 'connecting' | 'connected' | 'offline' | 'error', and
// participants lists everyone in the document, the reader included. 'offline'
// is still retrying (retryInMs says when) and local edits stay pending;
// 'error' has stopped for good and carries the reason. Single-player editors
// never emit it.
editor.on('collaboration:status', ({ status, participants }) => {
  console.log(status, participants.map((person) => person.user.name));
});

// To react to content changes with access to the API, use the
// onChange(api, event) config callback (async is allowed there):
//   onChange: async (api) => { const data = await api.save(); }`,
      },
      {
        name: "off(event, callback)",
        returnType: "void",
        description: "Unsubscribe from an editor event.",
        example: `const handleRendered = (payload) => console.log('Rendered');
editor.on('block:rendered', handleRendered);

// Later, remove the listener (pass the same function reference)
editor.off('block:rendered', handleRendered);`,
      },
      {
        name: "emit(event, data)",
        returnType: "void",
        description:
          "Emit a custom event. It is fire-and-forget over the listeners registered at that moment. There is no replay, so a handler subscribed after the emit never sees it.",
        example: `// Subscribe first — an emit with no listener is simply dropped
editor.on('custom-event', (data) => {
  console.log(data.message); // 'Hello'
});

editor.emit('custom-event', { message: 'Hello', data: 123 });`,
      },
    ],
  },
  {
    id: "history-api",
    badge: "History",
    title: "History API",
    description: "Control undo and redo for editor operations.",
    methods: [
      {
        name: "history.undo()",
        returnType: "void",
        description: "Undo the last operation.",
        example: `// Undo last change
editor.history.undo();

// Undo multiple times
for (let i = 0; i < 3; i++) {
  editor.history.undo();
}`,
      },
      {
        name: "history.redo()",
        returnType: "void",
        description: "Redo the last undone operation.",
        example: `// Redo last undone change
editor.history.redo();

// Redo multiple times
for (let i = 0; i < 3; i++) {
  editor.history.redo();
}`,
      },
      {
        name: "history.canUndo()",
        returnType: "boolean",
        description: "Check if undo is available (there are operations to undo).",
        example: `if (editor.history.canUndo()) {
  editor.history.undo();
} else {
  console.log('Nothing to undo');
}`,
      },
      {
        name: "history.canRedo()",
        returnType: "boolean",
        description: "Check if redo is available (there are undone operations to redo).",
        example: `if (editor.history.canRedo()) {
  editor.history.redo();
} else {
  console.log('Nothing to redo');
}`,
      },
      {
        name: "history.clear()",
        returnType: "void",
        description: "Clear all history. Removes all undo/redo entries.",
        example: `// Clear history when loading new content.
// render() is async and records its own undo entries,
// so await it before clearing.
await editor.blocks.render(newData);
editor.history.clear();`,
      },
    ],
  },
  {
    id: "saver-api",
    badge: "Saver",
    title: "Saver API",
    description: "Save and export editor content.",
    methods: [
      {
        name: "saver.save()",
        returnType: "Promise<OutputData>",
        description:
          "Alias for the main save() method. It rejects while read-only mode is enabled. It warns and throws `Error(\"Blok's content can not be saved in read-only mode\")` before reaching the Saver. Guard the call with `editor.readOnly.isEnabled`, or call `await editor.readOnly.set(false)` first.",
        example: `if (!editor.readOnly.isEnabled) {
  const data = await editor.saver.save();
  // Returns: { version, time, blocks }
}`,
        errors: [
          {
            condition: "Read-only mode is enabled (`editor.readOnly.isEnabled === true`).",
            message: "Blok's content can not be saved in read-only mode",
            resolution:
              "Disable read-only with `readOnly.set(false)` before saving, or gate the call on `readOnly.isEnabled`.",
          },
          {
            condition: "Collecting the data failed (a tool's save() threw).",
            message: "Blok's content can not be saved because collecting data failed",
            resolution:
              "Inspect the rejected error: it is the tool's own error whenever the Saver recorded one.",
          },
        ],
      },
    ],
  },
  {
    id: "selection-api",
    badge: "Selection",
    title: "Selection API",
    description: "Work with text selection within the editor.",
    methods: [
      {
        name: "selection.findParentTag(tagName, className?)",
        returnType: "HTMLElement | null",
        description:
          "Find the parent element of the current selection matching the tag and optionally class.",
        example: `const bold = editor.selection.findParentTag('B');
if (bold) {
  console.log('Selection is inside bold text');
}

const link = editor.selection.findParentTag('A', 'external-link');`,
      },
      {
        name: "selection.expandToTag(node)",
        returnType: "void",
        description: "Expand selection to cover the entire element.",
        example: `const element = editor.selection.findParentTag('B');
if (element) {
  editor.selection.expandToTag(element);
  // Now entire bold element is selected
}`,
      },
      {
        name: "selection.setFakeBackground()",
        returnType: "void",
        description:
          "Set a fake background to imitate selection when focus moves away. Useful for inline tools.",
        example: `// Save selection visual before opening a modal
editor.selection.setFakeBackground();
// Open modal - selection stays visually highlighted`,
      },
      {
        name: "selection.removeFakeBackground()",
        returnType: "void",
        description: "Remove the fake background selection.",
        example: `// After closing modal
editor.selection.removeFakeBackground();`,
      },
      {
        name: "selection.clearFakeBackground()",
        returnType: "void",
        description:
          "Clear all fake background state: both DOM elements and internal flags.",
        example: `// Full cleanup after undo/redo
editor.selection.clearFakeBackground();`,
      },
      {
        name: "selection.save()",
        returnType: "void",
        description: "Save the current selection range to restore later.",
        example: `// Save selection before moving focus
editor.selection.save();

// Do something that moves focus away...

// Restore selection
editor.selection.restore();`,
      },
      {
        name: "selection.restore()",
        returnType: "void",
        description: "Restore a previously saved selection range.",
        example: `editor.selection.save();
// ... operations that move focus ...
editor.selection.restore();`,
      },
    ],
  },
  {
    id: "marks-api",
    badge: "Marks",
    title: "Marks API",
    lastUpdated: "2026-07-22",
    description:
      "Range-aware inline-mark operations for building inline formatting tools. selection.findParentTag inspects only the selection's two boundary nodes (anchor and focus) and their ancestors. api.marks works on the WHOLE range instead. has answers \"is every text node in the selection covered\". apply and remove split partially-covered wrappers at the range boundaries, update fully-covering wrappers in place, and restore the selection afterwards. apply and remove also extend the range over trailing whitespace that browsers exclude from double-click selections. A MarkSpec describes a mark declaratively: tag, aliasTags, className, attributes, style. aliasTags lets legacy tag variants match as the SAME mark, for example <b> next to <strong>, or <em> next to <i>. New wrappers always use the canonical tag. String values are static and take part in the mark's identity. Function-form values are resolved from the state passed to apply/toggle, and are deliberately EXCLUDED from identity. That is what makes a colour picker ONE mark that updates in place, rather than N mutually-cancelling marks. Two specs sharing tag, classNames and static attributes belong to the same family. They compose on a single element. A text-colour spec and a background-colour spec can both sit on one <mark>. Every method defaults to the live selection's first range when no range is passed. The core export markSanitizerConfig(spec) derives the sanitizer rule a mark produces. It allowlists the spec's tag, strips style properties and classes the spec does not declare, and keeps declared attributes. Function-form values are handled by property name, so dynamic values are never dropped on save. The React adapter's createReactInlineTool applies the same derivation automatically when a tool declares a mark spec.",
    example: `// One spec = one mark. Static values (tag, className, attribute/style
// strings) form the mark's identity; function-form values do not.
const textColor = {
  tag: 'mark',
  style: { color: (state) => state.color },
};
const bgColor = {
  tag: 'mark',
  style: { 'background-color': (state) => state.color },
};

// Range-aware: splits partially-covered wrappers at the boundaries,
// updates fully-covering wrappers in place, restores the selection
editor.marks.apply(textColor, { color: '#2563eb' });

// Same family (same tag, no conflicting statics) → composes on ONE element
editor.marks.apply(bgColor, { color: '#fef3c7' });
// → <mark style="color: #2563eb; background-color: #fef3c7">…</mark>

// Derive the sanitizer rule the mark produces for a vanilla inline tool
import { markSanitizerConfig } from '@bloklabs/core';

class TextColorTool {
  static get sanitize() {
    return markSanitizerConfig(textColor);
  }
}`,
    methods: [
      {
        name: "marks.has(spec, range?)",
        returnType: "boolean",
        description:
          "Whether every text node in the range is inside a wrapper matching the spec. Whitespace-only text nodes are ignored. At a collapsed caret, the caret's ancestors are checked. selection.findParentTag checks only the selection's boundary nodes and their ancestors. This method is stricter: a selection that only partially carries the mark reports false.",
        params: [
          {
            name: "spec",
            type: "MarkSpec",
            required: true,
            description: "Declarative mark description: tag plus optional className, attributes, and style.",
          },
          {
            name: "range",
            type: "Range",
            required: false,
            default: "current selection",
            description: "Range to check. Defaults to the live selection's first range.",
          },
        ],
        example: `const highlight = { tag: 'span', className: 'my-highlight' };

// True only when the WHOLE selection is covered — a half-highlighted
// selection reports false, so a toolbar icon cannot lie
const active = editor.marks.has(highlight);`,
      },
      {
        name: "marks.find(spec, from?)",
        returnType: "HTMLElement | null",
        description:
          "Nearest ancestor element matching the spec, starting from the given node (or the current selection's start container). Matching respects the full spec, not just the tag name: tag, classNames, and static attribute/style values.",
        params: [
          {
            name: "spec",
            type: "MarkSpec",
            required: true,
            description: "Declarative mark description: tag plus optional className, attributes, and style.",
          },
          {
            name: "from",
            type: "Node",
            required: false,
            default: "selection start container",
            description: "Node to start the upward search from. Defaults to the current selection's start container.",
          },
        ],
        example: `const wrapper = editor.marks.find({ tag: 'mark' });

if (wrapper) {
  editor.selection.expandToTag(wrapper);
}`,
      },
      {
        name: "marks.read(spec, range?)",
        returnType: "MarkSnapshot | null",
        description:
          "Read the current values of the spec's declared properties from the wrapper at the range start. Returns null when the range is not inside a matching wrapper. The snapshot carries the matched element plus its declared style properties and attributes. Unset and transparent-valued style properties are omitted.",
        params: [
          {
            name: "spec",
            type: "MarkSpec",
            required: true,
            description: "Declarative mark description: tag plus optional className, attributes, and style.",
          },
          {
            name: "range",
            type: "Range",
            required: false,
            default: "current selection",
            description: "Range to read from. Defaults to the live selection's first range.",
          },
        ],
        example: `const colorMark = {
  tag: 'mark',
  style: { color: (state) => state.color },
};

// Preselect the current colour in a picker UI
const snapshot = editor.marks.read(colorMark);
const current = snapshot?.style['color']; // e.g. 'rgb(37, 99, 235)'`,
      },
      {
        name: "marks.apply(spec, state?, range?)",
        returnType: "HTMLElement[]",
        description:
          "Wrap the range in the mark, or update matching wrappers in place. Splits partially-covered same-family wrappers at the range boundaries. Extends the range over trailing whitespace that browsers exclude from double-click selections. Leaves the new contents selected. Returns the created or updated wrapper elements. A collapsed range (a bare caret with nothing selected) is a no-op: apply returns an empty array without touching the DOM or the selection.",
        params: [
          {
            name: "spec",
            type: "MarkSpec",
            required: true,
            description: "Declarative mark description: tag plus optional className, attributes, and style.",
          },
          {
            name: "state",
            type: "State",
            required: false,
            description: "Value passed to the spec's function-form attribute/style properties.",
          },
          {
            name: "range",
            type: "Range",
            required: false,
            default: "current selection",
            description: "Range to format. Defaults to the live selection's first range.",
          },
        ],
        example: `editor.marks.apply(colorMark, { color: '#d97706' });

// Same identity → the SAME wrapper is updated in place, not nested
editor.marks.apply(colorMark, { color: '#2563eb' });`,
      },
      {
        name: "marks.remove(spec, range?)",
        returnType: "HTMLElement[]",
        description:
          "Removes the spec's declared properties and classes from wrappers in the range, and unwraps wrappers left bare. For a non-collapsed range, partially-covered wrappers are split so text outside the range keeps its formatting. A collapsed caret instead targets its enclosing wrapper whole: no split happens, and the spec's properties are stripped from the entire wrapper. Either way, the selection is restored. Returns the wrappers that survived because they still carry other properties.",
        params: [
          {
            name: "spec",
            type: "MarkSpec",
            required: true,
            description: "Declarative mark description: tag plus optional className, attributes, and style.",
          },
          {
            name: "range",
            type: "Range",
            required: false,
            default: "current selection",
            description: "Range to deformat. Defaults to the live selection's first range.",
          },
        ],
        example: `editor.marks.remove(colorMark);
// A <mark> that also carried a background-colour spec survives
// with only the colour stripped`,
      },
      {
        name: "marks.toggle(spec, state?, range?)",
        returnType: "boolean",
        description:
          "Calls remove when the range already carries the mark, and apply otherwise. Returns the resulting state: true when the mark is now applied. At a collapsed caret with no existing mark it returns true without applying anything, because apply is a no-op on a collapsed range. Call toggle on a non-collapsed range, or treat the return value as the intended state rather than a confirmation.",
        params: [
          {
            name: "spec",
            type: "MarkSpec",
            required: true,
            description: "Declarative mark description: tag plus optional className, attributes, and style.",
          },
          {
            name: "state",
            type: "State",
            required: false,
            description: "Value passed to the spec's function-form attribute/style properties.",
          },
          {
            name: "range",
            type: "Range",
            required: false,
            default: "current selection",
            description: "Range to toggle. Defaults to the live selection's first range.",
          },
        ],
        example: `const highlight = { tag: 'span', className: 'my-highlight' };

const nowApplied = editor.marks.toggle(highlight);`,
      },
    ],
  },
  {
    id: "styles-api",
    badge: "Styles",
    title: "Styles API",
    description:
      "Access CSS class names for styling custom tools and UI elements. You can also customize the editor's layout and chrome through public CSS custom properties. The main way to override theme tokens is `style.tokens` in the Blok constructor config. Pass `--blok-*` keys and values. Blok injects a per-instance stylesheet that reaches the editor and, automatically, UI portaled to `document.body` (popovers, tooltips, top-layer elements). Invalid keys are skipped with a warning. The stylesheet is removed on destroy. Injected `style.tokens` values are static per application. They apply identically in light and dark themes and across read-only state. So state-dependent tokens like the editor gutter belong in CSS instead. `style.tokens` ignores `--blok-editor-gutter-*` keys with a warning. They are not frozen at construction, though. `editor.tokens.set(tokens)` rewrites the injected stylesheet at runtime, which is what a host light/dark toggle needs. Without it, flipping a token meant recreating the editor or hand-writing a global stylesheet that targets the portal scopes yourself. `set()` takes the complete token set: it replaces, it does not merge, mirroring `style.tokens`. Tokens you leave out of the new palette stop applying, and `{}` removes the stylesheet. `editor.tokens.get()` returns what is currently applied. The API is available synchronously right after construction. Calls made before `isReady` are buffered and replayed. The React, Vue and Angular adapters drive it reactively: pass `style={{ tokens }}` (React/Vue) or `[styleTokens]` (Angular), and changes sync in place without recreating the editor. There is a CSS-only alternative. Blok declares its own palette at zero specificity via `:where()`. So one plain selector like `[data-blok-interface] { --blok-popover-bg: … }` wins whatever the stylesheet order. But popovers portal to `document.body`, so that global stylesheet must also target `[data-blok-popover], [data-blok-top-layer]` to reach them. `--blok-content-max-width` stays authoritative in both width modes. `width='full'` only swaps its fallback to `none`. In edit mode Blok automatically reserves 56px of gutter for the floating +/⠿ block controls. The wrapper carries `data-blok-readonly` while read-only is active. Plain read-only KEEPS the gutter. The block-hover copy-link control lives there. And `readOnly.set()` flips modes in place, so collapsing the gutter would shift the document sideways on every toggle. The gutter collapses to 0 automatically only where it is genuinely dead space. That means chromeless read-only: `readOnly: { hideControls: true }`, where the wrapper carries `data-blok-controls-hidden`. It also means `hideToolbar: true` in the constructor config. There the hover toolbar never opens, the wrapper carries `data-blok-toolbar-hidden`, and no gutter space is reserved. `--blok-editor-gutter-start` is an override hook, not a required incantation. Set it to any value to change the default, including `0px` to remove the gutter. The gutter override contract is guaranteed, not incidental. Blok declares the gutter default and both state collapses at zero specificity via `:where()`. A unit contract test enforces that. So a host declaration of the gutter tokens at any positive specificity always wins the cascade. Declare them on the wrapper element itself, for example `[data-blok-interface] { --blok-editor-gutter-start: 16px }`, not only on an ancestor. The controls-hidden and toolbar-hidden collapses re-declare the tokens on the wrapper, and custom properties resolve from the nearest declaration. So an ancestor-level value loses to the collapse, while a wrapper-level one survives it. The content column's horizontal position is configurable at the API level too. Use `style.contentAlign?: 'left' | 'center' | 'right'` (default `'left'`) in the Blok constructor config. Blok also repaints native text selection inside the editor with `--blok-selection-inline`. Override that token to recolor it. Or pass `style.nativeSelection: true` (default `false`) to opt out entirely. Blok then falls back to the selection colors defined by the browser or the host. A token override cannot express CSS-wide keywords like `revert`, so reverting needs this flag. With the flag on, the wrapper carries `data-blok-native-selection` and Blok's `::selection` rules skip the editor. The fake-background highlight, shown while a menu input holds focus, then follows the UA `Highlight` color. Popovers keep Blok's selection color. Background surfaces are public tokens too. Most hover and light UI surfaces follow `--blok-bg-light`. Media empty-state cards use `--blok-bg-secondary`, bordered by `--blok-border-secondary`. The image and file loading skeletons and the upload placeholders use `--blok-bg-tertiary`. That token defaults to `--blok-bg-light`, so it tracks the theme. To recolor the skeleton surface, override `--blok-bg-tertiary` directly. Do not overload `--blok-bg-light` and drag every other surface along with it. Like all palette-backed color tokens, the surface tokens are re-declared by Blok on the editor wrapper at zero specificity. So apply overrides through `style.tokens`, `editor.tokens.set()`, or a CSS selector matching the wrapper (`[data-blok-interface]`) itself. A custom-property declaration on an ancestor container is shadowed by the wrapper's own declaration and silently does nothing. Layout hooks such as `--blok-content-max-width` are read with fallbacks and never declared by Blok. The same is true for the list, heading, embed, block-padding and placeholder-color tokens. That is why those DO inherit from any ancestor. The gutter tokens and `--blok-search-input-placeholder` are wrapper-declared like the palette, so they too need a wrapper-level rule. Note that the injected token stylesheets target Blok's scope attributes globally. With several editor instances on one page, each instance's `style.tokens` / `tokens.set()` stylesheet applies to ALL Blok UI on the page. It does not stop at its own instance. Each sheet is removed when its own instance is destroyed. Where sets conflict between instances, the stylesheet order in `<head>` decides, not application recency. So give every instance one shared set instead of relying on conflict order. Scope per-instance differences with a CSS rule on each editor's own wrapper instead. Body-mounted popover UI always follows the page-wide sheets. The sheets are injected at the start of `<head>`. So a host stylesheet rule of equal specificity, a plain `[data-blok-interface] { … }`, still beats `style.tokens` for the tokens it declares. Block rhythm is public too. `--blok-block-padding-top`, `--blok-block-padding-bottom` and `--blok-block-padding-inline` drive the padding of every block tool wrapper: paragraph, heading, list, toggle and quote. Each tool keeps its historical value as the fallback: 7px/7px/2px for most blocks, and 0.2em vertical for quotes. So one override retunes all blocks at once. That is exactly what a read-only host needs for tight inline-style rendering. Previously that was only possible by overriding `[data-blok-tool]` internals. The callout panel is the deliberate exception. Its card inset is `--blok-callout-padding-block` (default 5px), NOT the rhythm tokens. So tightening rhythm cannot collapse the callout card onto its text. The emoji still stays on the first text line, because its button follows `--blok-block-padding-top` together with the child text. Note that non-default padding slightly shifts derived geometry, such as the toggle-heading arrow offset, which follows `--blok-block-padding-top`. Column layout is public in the same way. A columns row is `[data-blok-columns]`, and each column holder is one of its direct `[data-blok-element]` children. A read-only row also carries `data-blok-columns-static-gutter`. Published rows take their gutter from the container, not from the `[data-blok-column-resizer]` separators. Those separators only exist while editing. `--blok-column-gutter` sets the gap (default `min(2rem, 4vw)`). `--blok-column-min-width` sets how far a column may be squeezed. The default is `0`, so a column can be dragged all the way to collapse. BOTH the layout and the resizer drag honor that floor, because the drag reads the resolved value back at pointer-down. So raising it stops the handle at the floor instead of persisting a width the layout refuses to render. Block nesting is public the same way. A block nested under another (Tab at root level) is indented by `--blok-block-indent-step` per level (default `24px`). It is real CSS, not an inline style, so a plain host rule retunes or removes it with no `!important`. Blok zeroes the step inside every `[data-blok-nested-blocks]` child slot. That is the marker every container tool renders for its children, first-party and third-party alike. So blocks a container already positions are never pushed sideways by their depth on top of that. A container that DOES want the indent declares the step back on its own slot. The reset rides on inheritance rather than on a JS check. That is deliberate: it also holds for a slot created after the child was inserted. A framework adapter's portal does exactly that. Text size is public per block AND per scenario through `style.fontSize`. That is the supported alternative to targeting Blok's internal class names. Every key writes one public token. `fontSize.paragraph` → `--blok-paragraph-font-size`. `fontSize.heading[1]` → `--blok-heading-1-font-size`. `fontSize.list.checklist` → `--blok-checklist-font-size`. The same holds for both quote variants, callout, code, toggle and the two table densities (`compact` / `comfortable`). It also holds for every media caption (image, video, audio, file, embed) and the three bookmark parts (title, description, link). Headings reuse the pre-existing heading tokens rather than minting parallel ones. Omitted keys keep Blok's built-in size, so an editor renders exactly as before everywhere it does not opt in. Per-tool size settings still outrank it. A paragraph tool configured with `styles.size` writes that size as an inline style on the block. So does a list with `itemSize`. No token can override an inline style. So scenarios you want to drive from `style.fontSize` must not also carry a per-tool size. Values may be absolute or relative (`px`, `rem`, `em`, `%`). Every ornament sitting beside sized text derives its own metrics from the same token. That covers a list bullet, checkbox, callout emoji or toggle arrow. So each one stays optically aligned at any scale, with no extra CSS. These tokens are read with fallbacks. Blok never declares them on its own. So an editor that does NOT configure `style.fontSize` also accepts them from a plain CSS rule on any ancestor. It accepts them from `style.tokens` / `editor.tokens.set()` too. The token NAMES ship as a constant. `import { BLOK_FONT_SIZE_TOKENS } from '@dodopizza/blok'` gives you a map shaped exactly like the config (`BLOK_FONT_SIZE_TOKENS.paragraph`, `BLOK_FONT_SIZE_TOKENS.heading[1]`, `BLOK_FONT_SIZE_TOKENS.bookmark.link`…). A host that scopes typography from CSS then never hand-copies the strings. And a rename becomes a compile error rather than a silent no-op. The channels compose. `style.fontSize` is the construction-time value, and `editor.tokens.set({ [BLOK_FONT_SIZE_TOKENS.paragraph]: '18px' })` overrides it at runtime. The theme-token sheet is injected directly after the fontSize sheet at equal specificity, so it wins. That is the channel for a size that must change after mount, such as a density, zoom or accessibility toggle. `style.fontSize` itself is read once at construction. Unlike `style.tokens`, the injected fontSize sheet is scoped to its own editor. The wrapper carries `data-blok-instance`, and the sheet's editor selector is keyed to it. So a second editor on the page keeps Blok's built-in sizes, or its own config. It does not inherit the first one's. The one part that stays page-wide is body-mounted UI. Popovers and tooltips render outside every editor's subtree, so those rules follow `<head>` order when instances disagree. One nesting rule is worth knowing. A callout renders its body text as a child paragraph block. So callout text follows `fontSize.callout`. It falls back to `fontSize.paragraph` when that key is unset. Setting only `paragraph` resizes callout bodies along with body text. To make the two differ, set `fontSize.callout` explicitly. Finally, the view renderer (`@bloklabs/core/view`) emits semantic HTML, and its stylesheet carries only the class-based scenarios. Paragraph, headings, list, checklist, both quote sizes, callout, code and toggle respond in view output. The caption, table-cell and bookmark sizes are editor-only.",
    example: `// Customize the editor from your host app via CSS custom properties —
// no need to target Blok's internal test IDs or data attributes.
// The hooks below are read with fallbacks and never declared by Blok, so
// they inherit from ANY ancestor — a plain container rule works:
.my-editor-container {
  /* Cap the content column at a custom width (default: 720px) */
  --blok-content-max-width: 650px;

  /* Extra start padding on list blocks (default: 0px) */
  --blok-list-padding-start: 18px;

  /* Checklists follow --blok-list-padding-start unless this is set —
     use it to indent checklists independently of other list styles */
  --blok-checklist-padding-start: 0px;

  /* Gap between a list marker/checkbox and its content (default: 0px) */
  --blok-list-gap: 6px;

  /* Indent applied per nesting level to blocks nested with Tab
     (default: 24px). Set it to 0px to switch nesting indentation off. */
  --blok-block-indent-step: 24px;

  /* Padding of every block tool wrapper. Fallbacks keep each tool's own
     default (7px/7px/2px for most blocks; quotes fall back to 0.2em
     vertical). Tighten all three for compact read-only inline
     rendering — no need to override [data-blok-tool]: */
  --blok-block-padding-top: 0;
  --blok-block-padding-bottom: 0.2em;
  --blok-block-padding-inline: 0;

  /* The callout card's own inset (default 5px) is deliberately separate
     from block rhythm — the rhythm override above leaves it alone: */
  --blok-callout-padding-block: 4px;

  /* Placeholder color of empty blocks (default: follows --blok-gray-text) */
  --blok-placeholder-color: rgba(112, 118, 132, 0.6);

  /* Heading typography (defaults mirror the built-in scale) */
  --blok-heading-1-font-size: 32px;
  --blok-heading-font-weight: 600;
  --blok-heading-margin-top: 16px;
  --blok-heading-margin-bottom: 16px;

  /* Space above embed blocks (default: 8px) */
  --blok-embed-margin-top: 16px;
}

// Container tools decline the nesting indent automatically: Blok zeroes the
// step inside every [data-blok-nested-blocks] child slot, so blocks your
// container positions itself are never also pushed by their depth. The indent
// is plain CSS, so opting it back IN inside your container is a declaration,
// not an !important fight:
.my-container-tool [data-blok-nested-blocks] {
  --blok-block-indent-step: 24px;
}

// Primary way to override theme tokens: style.tokens in the constructor
// config. Blok injects a per-instance stylesheet that reaches the editor
// AND UI portaled to document.body (popovers, tooltips, top-layer
// elements) automatically — no manual selector targeting needed.
new Blok({
  style: {
    tokens: {
      '--blok-selection': 'rgba(35, 131, 226, 0.28)',
      '--blok-popover-bg': '#1f1f1f',

      // Surface backgrounds. Most hover/light surfaces follow
      // --blok-bg-light; media empty-state cards use --blok-bg-secondary
      // with --blok-border-secondary; image/file loading skeletons and
      // upload placeholders use --blok-bg-tertiary, which defaults to
      // --blok-bg-light. Override the specific token you mean — no need
      // to overload --blok-bg-light to reach the skeleton surface.
      // NOTE: palette-backed color tokens like these are re-declared by
      // Blok on the editor wrapper itself, so set them here (or with a
      // CSS selector matching the wrapper, as below) — a declaration on
      // an ancestor container is shadowed and does nothing.
      '--blok-bg-light': '#eff2f5',
      '--blok-bg-secondary': '#f7f8fa',
      '--blok-border-secondary': 'rgba(55, 53, 47, 0.09)',
      '--blok-bg-tertiary': '#f0f0f0',
    },
  },
});

// CSS-only alternative: a plain host selector works too — Blok's palette
// is declared at zero specificity via :where(), so this always wins.
// Popovers/menus portal to document.body, so target them explicitly too.
[data-blok-interface],
[data-blok-popover],
[data-blok-top-layer] {
  --blok-popover-bg: #1a1a1a;

  /* Placeholder color of popover search inputs — wrapper-declared by Blok
     (like the palette) and consumed inside body-mounted popovers, so set
     it here or via style.tokens, never on an ancestor container: */
  --blok-search-input-placeholder: rgba(112, 118, 132, 0.8);
}

// Blok reserves 56px of start gutter automatically in edit mode for the
// floating +/⠿ block controls, collapsing to 0 only when the gutter is
// dead space: chromeless read-only (data-blok-controls-hidden) or
// hideToolbar (data-blok-toolbar-hidden). Plain read-only keeps the
// gutter so in-place mode flips never shift the layout.
// The gutter tokens are declared on the wrapper by Blok (default + state
// collapses), so overrides MUST target the wrapper itself — an ancestor
// container rule is shadowed and does nothing. Set any value, including
// 0px to remove the gutter, or redeclare it to opt back into the
// reserved space while controls are hidden:
.my-editor-container [data-blok-interface] {
  --blok-editor-gutter-start: 56px;
  --blok-editor-gutter-end: 16px;
}

// Center the content column instead of left-aligning it (default: 'left')
const editor = new Blok({
  holder: 'editor',
  style: { contentAlign: 'center' },
});

// Per-block, per-scenario type scale — every text-bearing block (and every
// scenario inside it: a caption, a density mode, a size variant) is settable
// from the config. This is the supported way to resize block text; there is
// no need to target Blok's internal class names. Each entry writes that
// block's --blok-*-font-size token. Omitted keys keep Blok's built-in size,
// and values may be absolute or relative (px / rem / em / %) — bullets,
// checkboxes, the callout emoji and the toggle arrow derive their metrics
// from the same token, so they stay aligned at any scale.
new Blok({
  holder: 'editor',
  style: {
    fontSize: {
      paragraph: '17px',
      // Headings reuse the existing --blok-heading-N-font-size tokens
      heading: { 1: '2.25rem', 2: '1.75rem', 3: '1.375rem' },
      list: { item: '17px', checklist: '17px' },
      quote: { default: '17px', large: '1.4em' },
      // Callout text is a child paragraph block: it follows this key, and
      // falls back to fontSize.paragraph when this key is omitted. Set it
      // explicitly to make callout text differ from body text.
      callout: '17px',
      code: '13px',
      toggle: '17px',
      table: { compact: '14px', comfortable: '17px' },
      image: { caption: '13px' },
      video: { caption: '13px' },
      audio: { caption: '13px' },
      file: { caption: '13px' },
      embed: { caption: '13px' },
      bookmark: { title: '15px', description: '13px', link: '13px' },
    },
  },
});

// Sizes that must CHANGE after mount (density / zoom / accessibility toggle)
// go through the token channel instead — style.fontSize is read once at
// construction and its stylesheet outranks tokens.set() for the scenarios it
// declares. So leave those scenarios out of style.fontSize entirely and
// size them from the token channel only:
editor.tokens.set({
  '--blok-paragraph-font-size': compact ? '15px' : '18px',
  '--blok-list-font-size': compact ? '15px' : '18px',
});

// Unconfigured scenarios also accept a plain CSS rule from any ancestor —
// Blok reads these tokens with fallbacks and never declares them itself:
.my-editor-container {
  --blok-quote-large-font-size: 24px;
}

// NOTE: the sheet Blok injects for style.fontSize is page-global, like
// style.tokens — it retypes EVERY editor on the page, including instances
// that set no fontSize of their own. Scope per-instance differences with a
// rule on that editor's own wrapper:
#editor-b [data-blok-interface] {
  --blok-paragraph-font-size: 15px;
}

// Flip theme tokens at runtime — e.g. from a host light/dark toggle.
// set() replaces the whole set, so tokens dropped from the new palette
// stop applying. Available immediately; calls before isReady are buffered.
editor.tokens.set({
  '--blok-popover-bg': isDark ? '#1f1f1f' : '#ffffff',
  '--blok-text-primary': isDark ? '#e6e6e6' : '#1a1a1a',
});
editor.tokens.get(); // -> currently applied tokens

// In React/Vue the same channel is a reactive prop (Angular: [styleTokens])
<BlokEditor style={{ tokens: isDark ? darkTokens : lightTokens }} />

// Opt out of Blok's ::selection repaint and use the native/host-defined
// selection colors instead (recoloring is possible via
// --blok-selection-inline; reverting to the UA default needs this flag)
new Blok({
  holder: 'editor',
  style: { nativeSelection: true },
});

// Access CSS class names for styling custom tools
const styles = editor.styles;

// Use class names in your custom tool
class MyCustomTool {
  constructor({ api }) {
    this.api = api;
  }

  render() {
    const wrapper = document.createElement('div');
    wrapper.className = this.api.styles.block;

    const input = document.createElement('input');
    input.className = this.api.styles.input;

    const button = document.createElement('button');
    button.className = this.api.styles.button;
    button.textContent = 'Click me';

    wrapper.appendChild(input);
    wrapper.appendChild(button);

    return wrapper;
  }
}

// Available class names:
// - api.styles.block              // Base block wrapper
// - api.styles.inlineToolButton   // Inline toolbar button
// - api.styles.inlineToolButtonActive  // Active inline tool
// - api.styles.input              // Input elements
// - api.styles.loader             // Loading spinner
// - api.styles.settingsButton     // Settings button
// - api.styles.settingsButtonActive   // Active settings
// - api.styles.settingsButtonFocused  // Focused settings
// - api.styles.settingsButtonFocusedAnimated  // Focused settings with click animation
// - api.styles.button             // General button`,
    properties: [
      {
        name: "block",
        type: "string",
        description: "Base block wrapper styles",
      },
      {
        name: "inlineToolButton",
        type: "string",
        description: "Inline toolbar button styles",
      },
      {
        name: "inlineToolButtonActive",
        type: "string",
        description: "Active inline tool button styles",
      },
      { name: "input", type: "string", description: "Input element styles" },
      { name: "loader", type: "string", description: "Loading spinner styles" },
      {
        name: "settingsButton",
        type: "string",
        description: "Settings button styles",
      },
      {
        name: "settingsButtonActive",
        type: "string",
        description: "Active settings button styles",
      },
      {
        name: "settingsButtonFocused",
        type: "string",
        description: "Focused settings button styles",
      },
      {
        name: "settingsButtonFocusedAnimated",
        type: "string",
        description: "Focused settings button styles with click animation",
      },
      { name: "button", type: "string", description: "General button styles" },
    ],
  },
  {
    id: "toolbar-api",
    badge: "Toolbar",
    title: "Toolbar API",
    description: "Control the block toolbar and its state.",
    methods: [
      {
        name: "toolbar.close(options?)",
        returnType: "void",
        description: "Close the toolbar with optional configuration.",
        example: `// Standard close. The next mousemove re-opens the toolbar: close() clears the
// hovered block and resets the hover dedup, so BlockHovered fires again.
editor.toolbar.close();

// Close and keep it closed while the pointer stays on the same block
// (skips the hover-state reset, so no BlockHovered is re-emitted for it).
editor.toolbar.close({ setExplicitlyClosed: false });`,
      },
      {
        name: "toolbar.open()",
        returnType: "void",
        description: "Open the toolbar.",
        example: `editor.toolbar.open();`,
      },
      {
        name: "toolbar.toggleBlockSettings(openingState?, trigger?, options?)",
        returnType: "void",
        description: "Toggle the block settings menu (☰).",
        example: `// Toggle current state
editor.toolbar.toggleBlockSettings();

// Force open
editor.toolbar.toggleBlockSettings(true);

// Force close
editor.toolbar.toggleBlockSettings(false);

// Anchor the settings popover to a custom trigger element.
// Left placement is already the default for an element trigger —
// opt out to open the popover to the right instead:
editor.toolbar.toggleBlockSettings(true, triggerEl, { placeLeftOfAnchor: false });`,
        params: [
          {
            name: "openingState",
            type: "boolean",
            required: false,
            default: "toggle current state",
            description: "Force the settings menu open (true) or closed (false).",
          },
          {
            name: "trigger",
            type: "HTMLElement",
            required: false,
            default: "undefined",
            description: "Element to anchor the settings popover to.",
          },
          {
            name: "options",
            type: "ToolbarBlockSettingsOptions",
            required: false,
            default: "undefined",
            description:
              "Placement overrides. `placeLeftOfAnchor` is already `true` when you pass a trigger element. Set it to `false` to open the popover to the right of the trigger instead.",
          },
        ],
      },
      {
        name: "toolbar.toggleToolbox(openingState?)",
        returnType: "void",
        description: "Toggle the toolbox (+ menu).",
        example: `// Toggle current state
editor.toolbar.toggleToolbox();

// Force open
editor.toolbar.toggleToolbox(true);`,
      },
      {
        name: "toolbar.setHidden(hidden)",
        returnType: "void",
        description:
          "Runtime setter for `config.hideToolbar`. It hides or shows the hover toolbar (plus button and drag handle). It also collapses or restores the editor gutter reserved for it. The wrapper's `data-blok-toolbar-hidden` attribute is kept in sync, so no dead space is left behind. The keyboard \"/\" menu keeps working while the toolbar is hidden.",
        params: [
          {
            name: "hidden",
            type: "boolean",
            required: true,
            description: "true hides the hover toolbar and collapses the gutter. false restores both.",
          },
        ],
        example: `// Hide the hover toolbar and collapse its gutter
editor.toolbar.setHidden(true);

// Restore it
editor.toolbar.setHidden(false);`,
      },
      {
        name: "toolbar.setPosition(position)",
        returnType: "void",
        description:
          "Runtime setter for `config.toolbarPosition`. It moves the floating block controls between the editor's inline-start and inline-end gutters. The wrapper's `data-blok-toolbar-position` attribute is kept in sync. That attribute drives both the gutter swap and the side the controls dock to. The block-settings menu mirrors with them, so it never opens over the block it belongs to. An open toolbar is re-laid out in place rather than closed.",
        params: [
          {
            name: "position",
            type: "'left' | 'right'",
            required: true,
            description: "'left' for the inline-start gutter (the default), 'right' for inline-end.",
          },
        ],
        example: `// Move the +/\u283F controls to the right of the content column
editor.toolbar.setPosition('right');

// Back to the left gutter
editor.toolbar.setPosition('left');`,
      },
    ],
  },
  {
    id: "inline-toolbar-api",
    badge: "Inline",
    title: "InlineToolbar API",
    description: "Control the inline formatting toolbar (bold, italic, etc.).",
    methods: [
      {
        name: "inlineToolbar.close()",
        returnType: "void",
        description: "Close the inline toolbar.",
        example: `editor.inlineToolbar.close();`,
      },
      {
        name: "inlineToolbar.open()",
        returnType: "void",
        description: "Open the inline toolbar at the current selection.",
        example: `editor.inlineToolbar.open();`,
      },
    ],
  },
  {
    id: "notifier-api",
    badge: "Notifier",
    title: "Notifier API",
    description:
      "Display notification messages to users. Rendering is pluggable. Pass `notifier: (options) => …` in the constructor config and Blok calls your handler instead of rendering anything. The built-in toast is skipped entirely, including its i18n `okText`/`cancelText` defaults. Any error your handler throws propagates to the `show()` call site. `notifierPosition` places the built-in container: 'bottom-left' | 'bottom-right' | 'bottom-center' | 'top-left' | 'top-right' | 'top-center' (default 'bottom-center').",
    methods: [
      {
        name: "notifier.show(options)",
        returnType: "void",
        description:
          "Show a notification message. Supports simple, confirm, and prompt notifications.",
        example: `// Simple notification
editor.notifier.show({
  message: 'Changes saved',
  style: 'success'
});
// → renders a body-mounted, viewport-fixed toast (default: bottom-center —
//   see config.notifierPosition); returns nothing to await

// Confirm notification
editor.notifier.show({
  message: 'Delete this block?',
  type: 'confirm',
  okHandler: () => console.log('Confirmed'),
  cancelHandler: () => console.log('Cancelled')
});

// Prompt notification
editor.notifier.show({
  message: 'Enter a title',
  type: 'prompt',
  okHandler: (value) => console.log('Entered:', value)
});`,
        params: [
          {
            name: "options",
            type: "NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions",
            required: true,
            description: "Notification configuration. Shape depends on type.",
          },
          {
            name: "options.message",
            type: "string",
            required: true,
            description: "Notification text. May contain HTML.",
          },
          {
            name: "options.type",
            type: "'alert' | 'confirm' | 'prompt'",
            required: false,
            default: "'alert'",
            description: "Notification type. confirm and prompt add action buttons.",
          },
          {
            name: "options.style",
            type: "'success' | 'error'",
            required: false,
            default: "undefined",
            description: "Marks the notification's semantic kind. With `'error'` the message's screen-reader live region is `assertive`. Otherwise it is `polite`. The value is also stamped onto `data-blok-testid` as `notification-success` / `notification-error`. The built-in toast looks the same either way. There is no success/error coloring.",
          },
          {
            name: "options.time",
            type: "number",
            required: false,
            default: "8000",
            description: "Auto-dismiss delay in ms for alert notifications (default 8000). Confirm and prompt notifications ignore this and stay until the user resolves them.",
          },
          {
            name: "options.okText",
            type: "string",
            required: false,
            default: "i18n `notifier.confirm` / `notifier.ok` ('Confirm' / 'OK' in English)",
            description: "Label for the confirm/submit button (confirm/prompt types only).",
          },
          {
            name: "options.okHandler",
            type: "(event: Event) => void | (value: string) => void",
            required: false,
            default: "undefined",
            description: "Confirm/submit callback. Receives the click event for confirm, or the input value for prompt. Required for prompt notifications.",
          },
          {
            name: "options.cancelText",
            type: "string",
            required: false,
            default: "i18n `notifier.cancel` ('Cancel' in English)",
            description: "Label for the cancel button (confirm and prompt types).",
          },
          {
            name: "options.cancelHandler",
            type: "(event: Event) => void",
            required: false,
            default: "undefined",
            description: "Cancel/close callback. If you provide it, Blok calls it before the dialog closes via the cancel button or dismiss/Escape. It runs for both confirm and prompt types.",
          },
          {
            name: "options.inputType",
            type: "string",
            required: false,
            default: "'text'",
            description: "HTML input type for the prompt's text field (prompt type only).",
          },
          {
            name: "options.placeholder",
            type: "string",
            required: false,
            default: "undefined",
            description: "Placeholder text for the prompt's input field (prompt type only).",
          },
          {
            name: "options.default",
            type: "string",
            required: false,
            default: "undefined",
            description: "Default value pre-filled in the prompt's input field (prompt type only).",
          },
        ],
        errors: [
          {
            condition: "The notifier module fails to load (e.g. blocked by CSP, dynamic import failure).",
            message: "[Blok] Failed to display notification. Reason: <error>",
            resolution: "The built-in notifier never throws or rejects. Check the browser console instead: the failure is logged, not passed to your call site. A custom `config.notifier` handler is different. Blok calls it synchronously, and its exceptions are not caught.",
          },
        ],
      },
    ],
  },
  {
    id: "sanitizer-api",
    badge: "Sanitizer",
    title: "Sanitizer API",
    description:
      "Clean and sanitize HTML content to prevent XSS attacks. A tool's `static get sanitize()` can also map a data field to the string `'plaintext'` instead of a tag map. That marks the field as literal source text rather than markup.",
    example: `// A tool declares which of its data fields are markup and which are literal text
class CodeTool {
  static get sanitize() {
    return {
      code: 'plaintext',            // literal source — never HTML-parsed
      caption: { b: true, i: true } // markup — sanitized against these tags
    };
  }
}`,
    methods: [
      {
        name: "sanitizer.clean(taintString, config)",
        returnType: "string",
        description:
          "Clean an HTML string using the provided sanitizer configuration. `'plaintext'` entries are field-level directives, not tag rules, so `clean()` filters them out of the config before parsing. Allowlisting `href`/`src` allows the attribute, not its scheme. `clean()` also drops URL values that can execute (`javascript:`, `data:text/html`, `data:image/svg+xml`), so an allowlisted anchor can never come back as a live script link.",
        example: `const dirtyHtml = '<script>alert("xss")</script><p>Hello</p>';
const clean = editor.sanitizer.clean(dirtyHtml, {
  p: true,  // Allow <p> tags
  b: true   // Allow <b> tags
});
// Returns: '<p>Hello</p>' (script tag removed)

const link = editor.sanitizer.clean('<a href="javascript:alert(1)">x</a>', { a: { href: true } });
// Returns: '<a>x</a>' (executable scheme dropped, text kept)`,
      },
    ],
    properties: [
      {
        name: "plaintext",
        type: "'plaintext'",
        description:
          "A field-level sanitizer rule a tool declares in `static get sanitize()`. It is part of the `SanitizerRule` union exported from the package root. Sanitization is an HTML parse: it entity-encodes bare `<`/`&` and drops text shaped like a stray end tag. For a field holding literal source text, such as a code block's `code`, that is irrecoverable corruption. A field marked `'plaintext'` skips tag sanitization, the URL-scheme pass and the editor-level global sanitizer, and round-trips byte-identical. It is declared as a plain string literal rather than a Symbol, so tool sanitize configs survive JSON and `structuredClone`.",
      },
    ],
  },
  {
    id: "tooltip-api",
    badge: "Tooltip",
    title: "Tooltip API",
    description: "Display tooltip hints on UI elements.",
    methods: [
      {
        name: "tooltip.show(element, content, options?)",
        returnType: "void",
        description: "Show a tooltip on the specified element.",
        example: `const button = document.querySelector('button');
editor.tooltip.show(button, 'Click to save', {
  placement: 'top',
  delay: 200 // timeout before showing
});`,
        params: [
          {
            name: "element",
            type: "HTMLElement",
            required: true,
            description: "Element the tooltip is anchored to.",
          },
          {
            name: "content",
            type: "TooltipContent",
            required: true,
            description: "Tooltip content: a string, HTMLElement, DocumentFragment or Node.",
          },
          {
            name: "options",
            type: "TooltipOptions",
            required: false,
            default: "undefined",
            description: "Placement and timing overrides. `onHover()` takes the same object.",
          },
          {
            name: "options.placement",
            type: "string",
            required: false,
            default: "'bottom'",
            description: "Declared as `string`. The values honored are 'top', 'bottom', 'left' and 'right'. The tooltip auto-flips to the opposite side when the requested side lacks room in the viewport.",
          },
          {
            name: "options.delay",
            type: "number",
            required: false,
            default: "0",
            description: "Milliseconds to wait before showing. It is skipped entirely when another tooltip hid within the previous 300 ms, so sweeping across adjacent triggers stays instant.",
          },
          {
            name: "options.marginTop",
            type: "number",
            required: false,
            default: "0",
            description: "Extra vertical offset, applied for bottom placement only.",
          },
          {
            name: "options.marginLeft",
            type: "number",
            required: false,
            default: "0",
            description: "Extra horizontal offset, applied for left placement only.",
          },
          {
            name: "options.marginRight",
            type: "number",
            required: false,
            default: "0",
            description: "Extra horizontal offset, applied for right placement only.",
          },
        ],
      },
      {
        name: "tooltip.hide()",
        returnType: "void",
        description: "Hide the currently visible tooltip.",
        example: `editor.tooltip.hide();`,
      },
      {
        name: "tooltip.onHover(element, content, options?)",
        returnType: "void",
        description: "Show tooltip on hover using event listeners. It takes the same `options` as `show()`. Keyboard-focus reveals ignore `delay`, so keyboard users never wait.",
        example: `const button = document.querySelector('button');
editor.tooltip.onHover(button, 'Click me', {
  placement: 'bottom'
});`,
      },
    ],
  },
  {
    id: "theme-api",
    badge: "Theme",
    title: "Theme API",
    description:
      "Read and switch the editor color theme at runtime. The configured mode and the theme actually painted are two different questions. `get()` answers the first, `getResolved()` the second. To be notified instead of polling, pass the core config option `onThemeChange`. It fires with the resolved theme when the theme changes, including OS-preference flips while the mode is 'auto'.",
    methods: [
      {
        name: "theme.get()",
        returnType: "'light' | 'dark' | 'auto'",
        description:
          "The configured theme mode. It is exactly what was passed as `config.theme`, or last set via `theme.set()`. Returns 'auto' when the editor follows the OS preference, so this is not the theme currently painted.",
        example: `console.log(editor.theme.get()); // 'auto'`,
      },
      {
        name: "theme.set(mode)",
        returnType: "void",
        description:
          "Set the theme mode. Pass 'light' or 'dark' to pin it, or 'auto' to follow the OS preference via prefers-color-scheme.",
        example: `editor.theme.set('dark');

// Back to following the OS
editor.theme.set('auto');`,
      },
      {
        name: "theme.getResolved()",
        returnType: "'light' | 'dark'",
        description:
          "The theme actually being painted. When the mode is 'auto', it is the theme left after evaluating the OS preference. Use it to match surrounding UI to the editor.",
        example: `editor.theme.set('auto');
console.log(editor.theme.getResolved()); // 'dark' on a dark-mode OS`,
      },
    ],
  },
  {
    id: "width-api",
    badge: "Width",
    title: "Width API",
    description:
      "Control the editor content width mode. 'narrow' keeps content inside the default `--max-width-content`. 'full' drops the constraint, so content fills its container.",
    methods: [
      {
        name: "width.get()",
        returnType: "'narrow' | 'full'",
        description: "The active content width mode. Defaults to 'narrow'.",
        example: `console.log(editor.width.get()); // 'narrow'`,
      },
      {
        name: "width.set(value)",
        returnType: "void",
        description:
          "Set the content width mode. This is what the React/Vue/Angular `width` prop syncs to after mount.",
        example: `editor.width.set('full');`,
      },
      {
        name: "width.toggle()",
        returnType: "void",
        description:
          "Flip the content width mode between 'narrow' and 'full'. It is the one-call \"full width\" switch.",
        example: `editor.width.toggle();`,
      },
    ],
  },
  {
    id: "placeholder-api",
    badge: "Placeholder",
    title: "Placeholder API",
    description:
      "Read and change the editor-level placeholder (the hint shown on the empty default block) at runtime, without recreating the editor.",
    methods: [
      {
        name: "placeholder.get()",
        returnType: "string | false",
        description:
          "The current editor placeholder, or false when it is disabled.",
        example: `console.log(editor.placeholder.get()); // 'Type / for commands'`,
      },
      {
        name: "placeholder.set(value)",
        returnType: "void",
        description:
          "Sets the editor placeholder. It updates existing blocks in place and applies to blocks created afterward. Pass false to disable. Available synchronously after construction: pre-ready calls are buffered and replayed.",
        example: `const editor = new Blok({ holder: 'blok' });

// Safe before isReady — buffered and replayed once the editor boots
editor.placeholder.set('Write something…');

// Disable it
editor.placeholder.set(false);`,
      },
    ],
  },
  {
    id: "readonly-api",
    badge: "ReadOnly",
    title: "ReadOnly API",
    description:
      "Control the read-only state of the editor. Toggling happens in place as long as every registered block tool implements `setReadOnly(state)` on its prototype. Every bundled tool does. The same editor instance then flips modes and keeps caret position, undo history and scroll. So an edit/view toggle is `readOnly.set(!isEditing)` on ONE instance, instead of destroying one editor and constructing another. The check is all-or-nothing. Install a single block tool without `setReadOnly` and every toggle falls back to a save, clear and re-render cycle. That cycle recreates all block instances and does not restore the caret. Scroll is still restored, and the undo history is deliberately left untouched.",
    example: `// The edit/view toggle: one instance, one call.
// Caret, undo history and scroll survive the switch —
// no destroy-and-recreate.
async function setEditing(isEditing: boolean) {
  await editor.readOnly.set(!isEditing);
}

// Framework adapters do this for you: change the readOnly
// prop (React/Vue) or input (Angular) and the adapter calls
// readOnly.set on the existing instance — same editor identity.`,
    methods: [
      {
        name: "readOnly.set(state, options?)",
        returnType: "Promise<boolean>",
        description:
          "Set read-only mode to the specified boolean state. The toggle happens in place, with no destroy or recreate step: block instances, caret position, undo history and scroll are all preserved. That holds only if every registered block tool implements `setReadOnly(state)` on its prototype. The check is all-or-nothing. One tool without it sends EVERY toggle down the fallback path of save, clear and re-render (every bundled tool has one, a third-party tool may not). That path recreates all block instances and does not restore the caret, though scroll and undo history still survive. Pass `{ hideControls: true }` to also hide the hover toolbar, block settings and inline toolbar while read-only is active. The option writes the object form of `config.readOnly`, so the live state reflects it. Returns the new state.",
        note:
          "The preferred way to enter or leave read-only mode. It toggles in place and preserves caret, undo history and scroll, as long as every registered block tool implements `setReadOnly()`. Returns a promise that resolves to the new state once applied.",
        params: [
          {
            name: "state",
            type: "boolean",
            required: true,
            description: "Read-only state to set.",
          },
          {
            name: "options.hideControls",
            type: "boolean",
            required: false,
            default: "unchanged (inherits the current `config.readOnly`)",
            description:
              "Hide all editor controls (hover toolbar, block settings popover, inline toolbar) while read-only is active. The value is sticky. `set()` writes `config.readOnly` only when you pass an actual boolean, so omitting the option keeps whatever `hideControls` is already in effect, from the constructor config or from an earlier `set()` call. Pass `{ hideControls: false }` explicitly to bring the controls back. `false` is the effective value only when `config.readOnly` was never given in object form.",
          },
        ],
        example: `// The edit/view toggle: ONE instance, flipped in place —
// caret, undo history and scroll survive the switch
await editor.readOnly.set(!isEditing);

// Enable read-only and hide all controls
// (hover toolbar, block settings, inline toolbar)
await editor.readOnly.set(true, { hideControls: true });

// Check state
console.log(editor.readOnly.isEnabled); // true or false
console.log(editor.readOnly.togglesInPlace); // true`,
      },
      {
        name: "readOnly.toggle(state?)",
        returnType: "Promise<boolean>",
        description: "Toggle read-only state. Without a parameter it toggles the current state. With a parameter it sets the specified state.",
        deprecated: true,
        replacedBy: "readOnly.set",
        example: `// Toggle current state
const isReadOnly = await editor.readOnly.toggle();

// Enable read-only
await editor.readOnly.toggle(true);

// Disable read-only
await editor.readOnly.toggle(false);`,
      },
    ],
    properties: [
      {
        name: "isEnabled",
        type: "boolean",
        description: "Current read-only state",
      },
      {
        name: "togglesInPlace",
        type: "true",
        description:
          "A build-level marker, hardcoded to `true`. It says this build of Blok has the in place toggle path, instead of always recreating the editor. It is not a capability probe. It does not report whether the currently installed tool set qualifies for that path. That path needs every block tool to implement `setReadOnly`, and it is not exposed anywhere. Use the marker only to detect a Blok build old enough to predate in-place toggling.",
      },
    ],
  },
  {
    id: "i18n-api",
    badge: "I18n",
    title: "I18n API",
    description:
      "Internationalization support for translating UI strings. The runtime `i18n.update()` mutator switches language in place. The locale catalogue itself ships as a separate published entry point, `@bloklabs/core/locales`. Only English is bundled, and the other 68 locales load on demand. Use `normalizeLocale()` as the pre-flight check for a locale you did not hard-code. `i18n.update({ locale })` with an unsupported tag keeps the current locale and warns on the console instead of throwing.",
    methods: [
      {
        name: "i18n.t(dictKey, vars?)",
        returnType: "string",
        description:
          "Translate a key from the global dictionary, optionally interpolating string or number values.",
        example: `const text = editor.i18n.t('toolNames.text');
console.log(text); // 'Text' (or translated string)

const limit = editor.i18n.t('tools.image.emptyMaxSize', { size: '10 MB' });
console.log(limit); // 'max 10 MB' (or translated string)`,
      },
      {
        name: "i18n.has(dictKey)",
        returnType: "boolean",
        description: "Check if a translation exists for the given key.",
        example: `if (editor.i18n.has('toolNames.text')) {
  const translation = editor.i18n.t('toolNames.text');
}`,
      },
      {
        name: "i18n.getEnglishTranslation(key)",
        returnType: "string",
        description:
          "Get the English translation for a key (used for multilingual search).",
        example: `const english = editor.i18n.getEnglishTranslation('toolNames.heading');
console.log(english); // 'Heading'`,
      },
      {
        name: "i18n.getLocale()",
        returnType: "string",
        description: "Get the active locale code (e.g. 'en').",
        example: `const locale = editor.i18n.getLocale();
console.log(locale); // 'en'`,
      },
      {
        name: "i18n.getDirection()",
        returnType: "'ltr' | 'rtl'",
        description:
          "Get the text direction currently in effect. It is derived from the active locale, unless an explicit `direction` override was set. This lives on the editor instance only. The `api.i18n` handed to tools carries just `t`, `has`, `getEnglishTranslation` and `getLocale`. So a tool must take the direction from the host, either its own config or the `i18n:changed` event, rather than calling this.",
        example: `if (editor.i18n.getDirection() === 'rtl') {
  // mirror your own chrome next to the editor
}`,
      },
      {
        name: "i18n.update({ locale?, messages?, direction? })",
        returnType: "Promise<void>",
        description:
          "Switch language at runtime. `config.i18n` is otherwise read once during boot, so a host with a language switcher had to recreate the editor to relabel it. That threw away caret, focus, selection and undo history. `update()` relabels in place instead: no recreation, nothing lost. `locale` accepts any supported code, or `'auto'` to re-run browser detection. `messages` merges host overrides over the locale dictionary. It is re-applied automatically after every later locale change, so a bare locale flip never silently drops your custom strings. `direction` overrides the direction implied by the locale, which you normally do not need. Calls are serialized internally, so lazily-loaded locale chunks cannot land out of order. The last call wins. The scope is everything. UI built on demand (block settings, the convert menu, notifications, screen-reader announcements) picks up the new locale the next time it opens. UI stamped up front (toolbar and plus-button labels, tooltips, the toolbox list) is relabelled immediately. Block content is repainted from your data: placeholders, media-toolbar labels, cell controls, anything a tool resolved while rendering. That includes tools that know nothing about locale changes. The repaint is invisible to you. `onChange` does not fire, scroll is kept, and the caret returns to the block that had it. Fires the `i18n:changed` event with `{ locale, direction }`. It is available synchronously after construction, and a call made before `isReady` is applied once the editor has booted. `update()` and `getDirection()` are exposed on the editor instance only, not on the `api.i18n` handed to tools, which carries just `t`, `has`, `getEnglishTranslation` and `getLocale`. So a third-party tool cannot flip the host's locale. The React, Vue and Angular adapters drive it reactively: change the `i18n` prop or input and the editor follows in place. Note that `defaultLocale` is not accepted. It only decides the fallback while resolving the initial locale.",
        example: `// Host language switcher \u2014 no remount, caret and undo survive.
await editor.i18n.update({ locale: 'ru' });

// Locale plus your own overrides on top of it.
await editor.i18n.update({
  locale: 'fr',
  messages: { 'toolNames.text': 'Paragraphe' },
});

// Follow the browser again.
await editor.i18n.update({ locale: 'auto' });

editor.events.on('i18n:changed', ({ locale, direction }) => {
  document.documentElement.dir = direction;
});`,
      },
      {
        name: "normalizeLocale(tag)",
        returnType: "SupportedLocale | null",
        description:
          "From `@bloklabs/core/locales`. Normalizes an arbitrary BCP-47 language tag to a supported Blok locale, and returns `null` when the tag is unsupported. The tag can be region-tagged (`'en-US'`), script-tagged (`'zh-Hant'`) or aliased (`'nb'` to `'no'`, `'ckb'` to `'ku'`). The same normalizer runs on browser detection and on explicit `config.i18n.locale` or `i18n.update({ locale })`. So a `null` here is exactly the tag that `update()` would refuse: it keeps the current locale and warns on the console rather than throwing.",
        example: `import { normalizeLocale } from '@bloklabs/core/locales';

// 'en-US' -> 'en'; null when the tag is not supported
const code = normalizeLocale(navigator.language);

if (code !== null) {
  await editor.i18n.update({ locale: code });
}`,
      },
      {
        name: "loadLocale(code)",
        returnType: "Promise<LocaleConfig>",
        description:
          "From `@bloklabs/core/locales`. Loads one locale on demand. Only English is bundled. The other 68 are fetched when asked for.",
        example: `import { loadLocale } from '@bloklabs/core/locales';

const fr = await loadLocale('fr');`,
      },
      {
        name: "preloadLocales(codes)",
        returnType: "Promise<void>",
        description:
          "From `@bloklabs/core/locales`. Loads several locales up front, for example the ones your language switcher offers. A later switch then does not wait on a fetch.",
        example: `import { preloadLocales } from '@bloklabs/core/locales';

await preloadLocales(['fr', 'de', 'ru']);`,
      },
      {
        name: "buildRegistry(codes)",
        returnType: "Promise<LocaleRegistry>",
        description:
          "From `@bloklabs/core/locales`. Loads the given codes and returns them together as a `LocaleRegistry`.",
        example: `import { buildRegistry } from '@bloklabs/core/locales';

const registry = await buildRegistry(['en', 'ru']);`,
      },
      {
        name: "getLocaleSync(code)",
        returnType: "LocaleConfig | undefined",
        description:
          "From `@bloklabs/core/locales`. Returns an already-loaded locale synchronously, or `undefined` when it has not been loaded yet.",
        example: `import { getLocaleSync, loadLocale } from '@bloklabs/core/locales';

const ru = getLocaleSync('ru') ?? await loadLocale('ru');`,
      },
      {
        name: "getDirection(code)",
        returnType: "'ltr' | 'rtl'",
        description:
          "From `@bloklabs/core/locales`. Text direction for a locale CODE. This is not the same function as `editor.i18n.getDirection()`, which takes no argument and reports the direction the mounted editor is currently using.",
        example: `import { getDirection } from '@bloklabs/core/locales';

document.documentElement.dir = getDirection('ar'); // 'rtl'`,
      },
    ],
    properties: [
      {
        name: "DEFAULT_LOCALE",
        type: "SupportedLocale",
        description:
          "From `@bloklabs/core/locales`. The default locale code, `'en'`.",
      },
      {
        name: "ALL_LOCALE_CODES",
        type: "readonly SupportedLocale[]",
        description:
          "From `@bloklabs/core/locales`. All 69 supported locale codes. Use the list to build a language switcher, or hand it to `preloadLocales`.",
      },
      {
        name: "enLocale",
        type: "LocaleConfig",
        description:
          "From `@bloklabs/core/locales`. The English dictionary. It is the only locale bundled by default, and the fallback for missing keys.",
      },
    ],
  },
  {
    id: "ui-api",
    badge: "UI",
    title: "UI API",
    description: "Access to Blok UI elements and state.",
    properties: [
      {
        name: "nodes.wrapper",
        type: "HTMLElement",
        description: "Top-level blok instance wrapper",
      },
      {
        name: "nodes.redactor",
        type: "HTMLElement",
        description: "Element that holds all the blocks",
      },
      {
        name: "isMobile",
        type: "boolean",
        description: "Whether Blok is in mobile mode",
      },
    ],
  },
  {
    id: "listeners-api",
    badge: "Listeners",
    title: "Listeners API",
    description: "Manage custom DOM event listeners with automatic cleanup.",
    methods: [
      {
        name: "listeners.on(element, eventType, handler, useCapture?)",
        returnType: "string | undefined",
        description:
          "Subscribe to event on element. Returns listener ID for removal.",
        example: `const button = document.querySelector('button');
const listenerId = editor.listeners.on(button, 'click', (e) => {
  console.log('Button clicked');
});

// Store ID for later removal`,
      },
      {
        name: "listeners.off(element, eventType, handler, useCapture?)",
        returnType: "void",
        description: "Unsubscribe from event on element.",
        example: `const handler = (e) => console.log('Clicked');
editor.listeners.on(button, 'click', handler);
editor.listeners.off(button, 'click', handler);`,
      },
      {
        name: "listeners.offById(id)",
        returnType: "void",
        description: "Unsubscribe from event using the listener ID.",
        example: `const listenerId = editor.listeners.on(button, 'click', handler);
// Later...
editor.listeners.offById(listenerId);`,
      },
    ],
  },
  {
    id: "tools-api",
    badge: "Tools",
    title: "Tools API",
    description: "Access and manage editor tools.",
    methods: [
      {
        name: "tools.getBlockTools()",
        returnType: "BlockToolAdapter[]",
        description:
          "Get all available block tool adapters. Each adapter exposes `name` plus tool metadata, including `assetKind`. On media tools that store an uploaded asset URL at `data.url`, `assetKind` is `'image' | 'video' | 'audio' | 'file'`. On every other tool it is `undefined`. Use it to find the media-bearing tools at runtime, instead of hardcoding each tool's data shape. You can then check a saved document's `data.url`s against your CDN, for example to clean up orphaned uploads.",
        example: `const blockTools = editor.tools.getBlockTools();
blockTools.forEach(tool => {
  console.log('Available tool:', tool.name);
});

// Discover which block types hold uploaded media, then collect their URLs
const mediaTypes = new Set(
  editor.tools.getBlockTools().filter(t => t.assetKind).map(t => t.name)
);
const referenced = (await editor.save()).blocks
  .filter(b => mediaTypes.has(b.type))
  .map(b => b.data.url);`,
      },
      {
        name: "tools.getToolsConfig()",
        returnType: "ToolsConfig",
        description:
          "Returns the tools-related configuration of this instance: { tools, inlineToolbar?, tunes?, theme? }. Use it to create nested Blok editors with the same tool set.",
        example: `const nested = new Blok({ holder, ...editor.tools.getToolsConfig() });`,
      },
      {
        name: "tools.update(name, config)",
        returnType: "void",
        description:
          "Shallow-merges new configuration into an installed tool at runtime, with no editor recreation. A `toolbox` key is treated as the tool-level setting, the same as `toolbox` in the `tools` map. Pass `toolbox: false` to hide the tool from every insertion surface; existing blocks keep rendering. Pass a toolbox object to show it again. This gates permissions without rebuilding the editor. Under the React adapter it is automatic: change the `toolbox` value in the `tools` prop and `useBlok`/`BlokEditor` applies it in place.",
        example: `// Swap a config value (e.g. an uploader) at runtime
editor.tools.update('image', { uploader: { uploadByFile } });

// Permission flip: hide the tool from the + / slash / convert menus.
// Existing goodsList blocks still render; insertion is gated.
editor.tools.update('goodsList', { toolbox: false });

// Re-enable it later
editor.tools.update('goodsList', { toolbox: { title: 'Goods List' } });`,
      },
      {
        name: "tools.setInlineToolbar(config)",
        returnType: "void",
        description:
          "Runtime setter for the global `inlineToolbar` config. It re-assigns inline tools for every block tool and recomposes the memoized sanitize configs. Paste-time sanitization follows the new set immediately. The inline toolbar reflects it on the next selection. Tool-scoped `inlineToolbar` settings, both arrays and opt-outs, stay authoritative. Pass `true` for all inline tools, `false` for none, or a list of inline tool names. The list selects which tools appear, while their left-to-right order stays fixed. If you render saved content through @bloklabs/core/view, note that a viewSchema is composed from the inlineToolbar value it was defined with. After a runtime setInlineToolbar involving custom inline tools, recompose it with defineBlokSchema before calling blocksToHtml.",
        params: [
          {
            name: "config",
            type: "boolean | string[]",
            required: true,
            description:
              "`true` enables every registered inline tool. `false` disables the inline toolbar. An array restricts it to the listed inline tools, in that order.",
          },
        ],
        example: `// Restrict inline formatting to bold and italic at runtime
editor.tools.setInlineToolbar(['bold', 'italic']);

// Disable the inline toolbar entirely
editor.tools.setInlineToolbar(false);

// Back to every registered inline tool
editor.tools.setInlineToolbar(true);`,
      },
      {
        name: "tools.isInstalled(name)",
        returnType: "boolean",
        description:
          "Returns true when a tool with the given name is installed and available on this editor instance. That covers block, inline and tune tools. Use it to inspect the installed tool set, for example as a guard before `tools.update(name, config)`, which throws for unknown names.",
        params: [
          {
            name: "name",
            type: "string",
            required: true,
            description: "Registered tool name to look up.",
          },
        ],
        example: `if (editor.tools.isInstalled('image')) {
  editor.tools.update('image', { uploader: { uploadByFile } });
}`,
      },
      {
        name: "defineTool(toolClass, settings?)",
        returnType: "ExternalToolSettings",
        description:
          "A registration helper exported from `@bloklabs/core/tools`. It is not a member of the `tools` namespace. The plain `tools` map types every entry with a bare `ToolSettings` whose `Config` falls back to `Record<string, unknown>`. So a misspelled config key (`defaultLevle` for `defaultLevel`) compiles silently. `defineTool` recovers the tool's real config type from its constructor and applies it to `settings.config`, turning those typos into compile errors. The type-checking happens on the `settings` argument. The RETURN type stays the erased `ExternalToolSettings`, so the result drops straight into the `tools` map. `ExtractToolConfig<TClass>` is the type that does the recovery. It is exported alongside `defineTool`, and falls back to `Record<string, unknown>` for tool classes whose constructor declares no concrete config.",
        example: `import { Blok } from '@bloklabs/core';
import { Header, defineTool } from '@bloklabs/core/tools';

new Blok({
  tools: {
    header: defineTool(Header, { config: { levels: [1, 2, 3] } }),
    // \`defaultLevle: 2\` here would now be a compile error
  },
});`,
      },
      {
        name: "mountChildBlocks(container, children)",
        returnType: "void",
        description:
          "The child-holder reconciler for container blocks, exported from `@bloklabs/core/tools`. Call it from your tool's `rendered()` hook. The built-in toggle, callout and column tools use it, and the React/Vue/Angular block adapters run it on every commit. It is idempotent and cheap, so run it on every render. Per child it behaves like this. It leaves a holder already inside `container` alone. It RECLAIMS a holder stranded in a nested container that ENCLOSES `container`, inserting it at its model position rather than appending it last. It leaves holders sitting in any OTHER nested container alone, so two containers can never steal each other's blocks. It mounts everything else at its model position. The reclaim is what makes a container survive the insert ordering. Core anchors a newly inserted first child as the container block's DOM sibling, so without the reclaim a child of a nested container renders one level out. That is permanent when your container's child slot had not been created yet at insert time, which is what happens when a framework portal commits a render after core inserts. Mark `container` with `data-blok-nested-blocks` so the rest of the editor recognises it as a container.",
        params: [
          {
            name: "container",
            type: "HTMLElement",
            required: true,
            description:
              "The element child holders belong in. It is the element carrying `data-blok-nested-blocks`.",
          },
          {
            name: "children",
            type: "{ holder: HTMLElement }[]",
            required: true,
            description:
              "The block's children in model order, normally `api.blocks.getChildren(blockId)`.",
          },
        ],
        example: `import { mountChildBlocks } from '@bloklabs/core/tools';

class CardTool {
  constructor({ api, block }) {
    this.api = api;
    this.blockId = block.id;
  }

  render() {
    this.slot = document.createElement('div');
    this.slot.setAttribute('data-blok-nested-blocks', '');

    return this.slot;
  }

  // Runs after the holder is in the document, and on every re-render
  rendered() {
    mountChildBlocks(this.slot, this.api.blocks.getChildren(this.blockId));
  }
}`,
      },
      {
        name: "BlockToolConstructorOptions.origin",
        returnType: "BlockOrigin",
        description:
          "The create-vs-restore signal on the tool contract. Blok hands it to every block tool's constructor alongside `data`, `block` and `readOnly`. A container tool that seeds default children, such as a two-column row or a card that starts with a heading, may only do that once, at creation. Every other time the tool is constructed, the document already says what its children are. During a restore those children commonly land a tick AFTER `rendered()` runs, so an empty `api.blocks.getChildren()` there is only transient. Seeding on that read fabricates phantom children beside the real ones. CREATION values, where you may seed: `'user'` (a direct editing gesture: Enter, the plus button, the slash menu, block settings, a markdown shortcut), `'api'` (a programmatic `blocks.insert` / `insertMany` / `insertInsideParent`), `'convert'` (a turn-into). RESTORE values, where you never seed: `'load'` (a document render), `'replay'` (an undo/redo replay or a remote collaborative update), `'paste'` (pasted content that brings its own children), `'probe'` (the OFF-TREE instance `blocks.composeBlockData()` builds to read a tool's default data). The probe instance is never inserted, yet it still runs `render()` and `rendered()`, so it must not touch the block tree at all. Blok always supplies the value. Treat an absent value as `'api'`, and write the check as an allow-list of creation values, so a future origin fails closed. Pair it with `blocks.insert(..., origin)` if you drive insertion from your own UI. On the React/Vue/Angular adapters you rarely read it by hand: the block spec's `onCreated` hook already encodes this allow-list, and it fires after the adapter's first commit, the tick at which the block's DOM and its adopted child holders actually exist.",
        example: `class TwoColumnCard {
  constructor({ api, block, origin }) {
    this.api = api;
    this.blockId = block.id;
    // Allow-list, so a future origin never silently opts into seeding.
    this.isCreation = ['user', 'api', 'convert', undefined].includes(origin);
  }

  render() {
    this.slot = document.createElement('div');
    this.slot.setAttribute('data-blok-nested-blocks', '');

    return this.slot;
  }

  rendered() {
    const children = this.api.blocks.getChildren(this.blockId);

    if (children.length > 0) {
      mountChildBlocks(this.slot, children);

      return;
    }

    // Empty on a load / undo-redo replay / paste / probe means "my children
    // have not arrived yet", NOT "I am brand new". Only a creation may seed.
    if (!this.isCreation) {
      return;
    }

    this.seedColumns();
  }
}`,
      },
      {
        name: "BlockToolConstructable.keepsChildrenOnEnter",
        returnType: "boolean",
        description:
          "A static on your tool CLASS that decides where Enter goes on the container's empty LAST child. By default Blok reads that empty trailing line as the author's way out. With siblings present the line is outdented to the container's own parent. When it is the sole child, Blok inserts a fresh block after the whole container. That is Notion's callout behaviour. A layout container whose children ARE its content (a column, a card, a `steps` block) wants the opposite. Such a tool needs the declaration: without it, the escape strands the new line beside the container. Set it to `true` and the new line stays inside. That is the same rule the built-in `column`, `column_list` and `toggle` follow. It cannot be inferred from the DOM: a callout renders the very same `data-blok-nested-blocks` slot as a column and deliberately keeps the escape, so this is per-tool policy. Core reads it for the symmetric \"remove one indent level\" gesture too (Enter/Backspace on a block nested under a PLAIN parent). A declaring tool is treated as a container there as well, and its children never stepwise-outdent out of it. On the React/Vue/Angular adapters, declare it in the block spec's `statics` bag like any other class static.",
        example: `class StepsTool {
  static keepsChildrenOnEnter = true;

  render() {
    this.slot = document.createElement('div');
    this.slot.setAttribute('data-blok-nested-blocks', '');

    return this.slot;
  }

  rendered() {
    mountChildBlocks(this.slot, this.api.blocks.getChildren(this.blockId));
  }
}

// Framework adapters forward it through \`statics\`:
export const StepsTool = createReactBlock({
  type: 'steps',
  statics: { ownsChildren: true, keepsChildrenOnEnter: true },
  component: StepsCard,
});`,
      },
      {
        name: "BlockToolConstructable.childTools",
        returnType: "{ allow?: string[]; deny?: string[] }",
        description:
          "A static on your tool CLASS declaring which block tools may be DIRECT children of its block, and core enforces it everywhere for you. On INSERT a disallowed tool is demoted, never refused, because Enter must always produce a block. The target is the first entry of `allow`, so `allow: ['segment-item']` makes \"Enter at the end of a segment\" produce another segment instead of a stray paragraph. On MOVE a drag or keyboard reorder that would carry a disallowed block across the container boundary is refused. In the TOOLBOX the disallowed tools are hidden while the caret sits in a child. `deny` wins over `allow` for a tool named in both, and empty lists read as \"no restriction\". This is the selective, insert-aware counterpart to `ownsChildren`, which is all-or-nothing and clamps moves only. It is also the generic form of the Table tool's `restrictedTools`, whose enforcement is hard-wired to table cells. Without it a container tool has to defend itself downstream: filtering `child.name` in render, keeping its CSS working when a foreign child appears, and migrating strays out of stored documents. On the React/Vue/Angular adapters, declare it in the block spec's `statics` bag like any other class static.",
        example: `class Segments {
  static get childTools() {
    return { allow: ['segment-item'] };
  }

  render() {
    this.slot = document.createElement('div');
    this.slot.setAttribute('data-blok-nested-blocks', '');

    return this.slot;
  }
}

// Only forbid a few tools, accept everything else
class Callout {
  static childTools = { deny: ['table', 'column_list'] };
}

// Framework adapters forward it through \`statics\`:
export const Segments = createReactBlock({
  type: 'segments',
  statics: { childTools: { allow: ['segment-item'] } },
  component: SegmentsCard,
});`,
      },
      {
        name: "setData(newData)",
        returnType: "boolean | void | Promise<boolean | void>",
        description:
          "An optional method on your tool that applies new data to the LIVE instance. Declare it, and `blocks.update()`, undo/redo and remote collaborative edits all reuse the block you already rendered instead of recomposing it. There is no new tool instance and no new holder, so ephemeral state survives: an open menu, a scroll position, a framework component's local state. The adopted child holders and the caret survive too. Without it, core destroys the block and builds a replacement. That is why a host calling `blocks.update()` on every keystroke used to watch a component-backed block go blank. Return `false` when you cannot apply the data in place, and core falls back to the full recompose. The list tool does that for a style change, which needs a different DOM shape. Returning `true` or nothing means the data was applied. Throwing has the same effect as `false`: it is logged, then the block is recomposed. The React/Vue/Angular block factories implement it for you, so adapter blocks take the in-place path automatically.",
        example: `class CalloutTool {
  setData(newData) {
    if (newData.variant !== this.data.variant) {
      // A different variant renders a different DOM shape — let core rebuild.
      return false;
    }

    this.data = newData;
    this.box.textContent = newData.text ?? '';

    return true;
  }
}`,
        params: [
          {
            name: "newData",
            type: "BlockToolData",
            required: true,
            description:
              "The block's full data after the update. That is the existing data merged with the caller's patch, not the patch alone.",
          },
        ],
      },
    ],
  },
  {
    id: "uploader-api",
    badge: "Uploader",
    title: "Uploader API",
    description:
      "Upload an asset through the pipeline that owns its KIND, instead of whichever tool happens to be asking. Tools call this rather than reaching into their own `config.uploader`. That is why an audio block's cover art reaches your image pipeline, instead of the audio endpoint that would reject it. Resolution order for a kind: first the tool whose static `assetKind` matches (for example `tools.image.config.uploader` for `'image'`), then the editor-level `uploader` config, then a local fallback. The fallback is a `blob:` URL for files, and the URL verbatim for links. See the storage presets page for ready-made `uploader` implementations: Supabase, S3-compatible storage, Cloudinary, and IndexedDB. None of them need a backend of your own.",
    methods: [
      {
        name: "uploader.uploadByFile(file, ctx)",
        returnType: "Promise<{ url: string; fileName?: string }>",
        description:
          "Store a file and return its URL. `ctx` is `{ kind, tool?, onProgress? }`, where `kind` is the ASSET kind, not the requesting tool. The two differ whenever a tool holds an asset outside its own media family.",
        example: `// Inside a custom block tool that holds a thumbnail
const { url } = await this.api.uploader.uploadByFile(file, {
  kind: 'image',
  tool: 'my-card',
  onProgress: (percent) => this.showProgress(percent),
});`,
      },
      {
        name: "uploader.uploadByUrl(url, ctx)",
        returnType: "Promise<{ url: string; fileName?: string }>",
        description:
          "Re-host an asset the user supplied by URL, and return the stored URL. Without an uploader for the kind, the URL is stored verbatim. You should configure one if a strict `img-src`/`media-src` policy or link rot would break third-party URLs.",
        example: `const { url } = await this.api.uploader.uploadByUrl(pastedUrl, {
  kind: 'image',
  tool: 'my-card',
});`,
      },
      {
        name: "uploader.isConfigured(kind, method?)",
        returnType: "boolean",
        description:
          "Whether a host uploader handles this kind. False means the caller would get the local fallback. That helps you decide whether an asset is worth uploading at all, for example inlining small extracted artwork as a `data:` URL instead.",
        example: `if (this.api.uploader.isConfigured('image', 'uploadByFile')) {
  const { url } = await this.api.uploader.uploadByFile(artwork, { kind: 'image' });
} else {
  // no image pipeline — keep it inline rather than minting a doomed blob: URL
}`,
      },
    ],
  },
  {
    id: "output-data",
    badge: "Data",
    title: "OutputData",
    description:
      "The data structure returned by the save() method. Input positions also accept the loose wire variants `LooseOutputData` / `LooseOutputBlockData`. Those positions are the `data` config option, `render()`, `blocks.render()`, and `blocks.insertMany()`. In the loose variants a block's `data`, `id`, `parent`, `content`, and `time` may be `null`. A `null` `data` becomes `{}`. A `null` or empty `id` gets a generated one. A `null` `parent` and a `null` or empty `content` are treated as absent, so the block is root-level and childless. Saved output is always the strict shape.",
    example: `// Save editor content
const data = await editor.save();

// Result structure:
interface OutputData {
  version?: string;    // Editor version
  time?: number;       // Save timestamp
  blocks: OutputBlockData[]; // Array of block data
}

// Example output:
{
  "version": "${BLOK_VERSION}",
  "time": 1704067200000,
  "blocks": [
    {
      "id": "p6QK0Xz1Ab",
      "type": "paragraph",
      "data": { "text": "Hello, world!" }
    },
    {
      "id": "hM3lTn9RdC",
      "type": "header",
      "data": { "text": "Title", "level": 2 }
    }
  ]
}`,
    table: [
      {
        option: "version",
        type: "string (optional)",
        default: "—",
        description: "Editor version",
      },
      {
        option: "time",
        type: "number (optional)",
        default: "—",
        description: "Timestamp of save",
      },
      {
        option: "blocks",
        type: "OutputBlockData[]",
        default: "—",
        description: "Array of block data",
      },
    ],
    methods: [
      {
        name: "equalsOutputData(a, b, options?)",
        returnType: "boolean",
        description:
          "Structural equality for saved documents, exported from the main entry. It compares the `blocks` arrays deeply. The volatile `time` and `version` envelope fields are ignored, so a document round-tripped through save() compares equal to its echo. Block ids count only when BOTH sides carry one. The editor mints fresh ids for id-less content, so a legacy document (or a backend that strips ids) still compares equal to its saved echo. You need no id-stripping wrapper on the consumer side. Edit metadata (`lastEditedAt` / `lastEditedBy`) never counts either. It records who touched a block and when, not what it says, so a document whose only delta is a stamp counts as unchanged. Nullish documents and loose wire shapes are accepted: `null`/`undefined` compares equal to `{ blocks: [] }`, and a DTO's `parent: null` / `content: null` equals the saved shape that omits them. The third argument is `EqualsOutputDataOptions`, also exported from the main entry. Its `ignoreEmptyDefaultBlocks` option (default `false`) drops empty blocks of the DEFAULT block tool from both sides before comparing. A pristine editor holding one empty paragraph then equals a saved-empty baseline, which is the flag to use for dirty-vs-baseline checks. Empty NON-default blocks (a content-less divider, an empty image) are kept.",
        example: `import { equalsOutputData } from '@bloklabs/core';

const saved = await editor.save();
if (!equalsOutputData(saved, previousData)) {
  await persist(saved); // only hit the backend on real changes
}`,
      },
      {
        name: "isEmptyOutputData(data)",
        returnType: "boolean",
        description:
          "True when the document carries no user content. Exported from the main entry. That means the document is nullish, has no blocks, or every block's data holds only empty values: blank or whitespace-only strings, empty arrays and objects. Numbers and booleans (`level`, `checked`, styles) are presentation metadata. On their own they never count as content.",
        example: `import { isEmptyOutputData } from '@bloklabs/core';

const data = await editor.save();
submitButton.disabled = isEmptyOutputData(data);
// → true for a fresh editor holding one blank paragraph`,
      },
      {
        name: "normalizeOutputData(data)",
        returnType: "OutputData",
        description:
          "Normalizes a whole loose backend DTO into the strict saved OutputData shape, exported from the main entry. A nullish document becomes `{ blocks: [] }`. `null` envelope fields (`time`/`version`) are dropped. Each block is normalized too: a `null` or missing `data` becomes `{}`, a `null` or empty id is dropped so a new one is generated, and nullish or empty hierarchy references (`parent: null`, `content: null`, `content: []`) are dropped as absent. Unlike a hand-written `blocks.map(...)` mapper, it keeps every passthrough field: `tunes`, real `parent`/`content` references, `indent`, and edit metadata. So hierarchy and tunes are never silently lost. It is idempotent: a strict document passes through unchanged.",
        example: `import { normalizeOutputData } from '@bloklabs/core';

// A loose Editor.js-era DTO (data: null, id: null) from your backend
const strict = normalizeOutputData(dtoFromApi);
// → strict OutputData, safe to persist or diff — no blind \`as OutputData\` cast`,
      },
      {
        name: "normalizeOutputBlocks(blocks)",
        returnType: "OutputBlockData[]",
        description:
          "Block-level counterpart of normalizeOutputData, exported from the main entry. It normalizes an array of loose wire blocks into the strict saved shape. A `null` or missing `data` becomes `{}`, a `null` or empty `id` is dropped so a new one is generated, and nullish or empty `parent`/`content` is dropped as absent. Every other field passes through untouched. Use normalizeOutputData when you hold the whole document envelope.",
        example: `import { normalizeOutputBlocks } from '@bloklabs/core';

const blocks = normalizeOutputBlocks(looseBlocksFromApi);
// → OutputBlockData[] with tunes/parent/content/indent intact`,
      },
      {
        name: "BlokData<T>",
        returnType: "{ [K in keyof T]: T[K] }",
        description:
          "A type helper, exported from the main entry. It lets a block-data shape declared with an `interface` fit the `data` slot. A TS `interface` has no implicit index signature, so it is not assignable to `Record<string, unknown>`. That is why `OutputBlockData<'task', TaskData>` fails to compile when `TaskData` is an interface. `BlokData<T>` re-projects `T` through a homomorphic mapped type. The compiler does treat that as having an implicit index signature, and every declared key keeps its precise type. You need no rewrite: an existing interface value is assignable to `BlokData<T>`, and a `type` alias already satisfies the slot on its own.",
        example: `import type { BlokData, OutputBlockData } from '@bloklabs/core';

interface TaskData { title: string; done: boolean }

const block: OutputBlockData<'task', BlokData<TaskData>> = {
  type: 'task',
  data: { title: 'Ship it', done: false },
};`,
      },
      {
        name: "flattenTree(spec, options?)",
        returnType: "Array<OutputBlockData & { id: string }>",
        description:
          "Turns an ergonomic nested spec into the flat DFS pre-order `OutputBlockData[]` that Blok stores. It wires every `parent`/`content` link for you. Exported from the main entry, along with its `BlockTreeSpec`, `BlockRunSpec`, `BlockTreeNode` and `FlattenTreeOptions` types. A spec node is `{ type?, data?, tunes?, id?, children? }`. It is the pure counterpart of the live `blocks.insertTree()` mutation: the same DFS without an editor. So you can seed nested content (columns, tables, a whole document) without hand-authoring `parent`/`content` id arrays. Every returned block has a resolved `id`, generated when the spec omitted one, so the array is safe to reference by id. Leaves omit the empty `content` array. Content that is already flat, such as a stored Blok document a migration is splicing into a page, goes in as a run node, `{ blocks: [...] }`, at the root or as a child. The run is spliced verbatim: ids, `data`, `tunes` and existing `parent`/`content` links are kept. Only the blocks it left un-parented are re-parented onto the enclosing node. That is the same rule `blocks.insertMarkdown()` applies to a converted run. Because nothing is re-derived, ids stay stable, so a migration can run in batches without duplicating blocks it already wrote. `options` takes `parentId`, the `parent` assigned to the root node or nodes, and `generateId`, the id generator for nodes without an explicit `id`. Pass a deterministic generator for reproducible output. Reusing an explicit `id` within the spec throws, and so does passing a pre-flat block as a tree node, because its `parent`/`content` links would be dropped silently.",
        example: `import { flattenTree } from '@bloklabs/core';

// A two-column layout, written as a tree instead of parent/content id arrays
const blocks = flattenTree([
  {
    type: 'column_list',
    children: [
      { type: 'column', children: [{ type: 'paragraph', data: { text: 'Left' } }] },
      { type: 'column', children: [{ type: 'paragraph', data: { text: 'Right' } }] },
    ],
  },
]);

// Ready to hand to the \`data\` config option, render() or blocks.insertMany()
console.log(blocks); // flat, DFS pre-order, every parent/content link wired

// An already-flat saved document goes in as a run node — spliced verbatim,
// ids kept, only its top-level blocks re-parented under the column
const migrated = flattenTree({
  type: 'column',
  children: [{ blocks: legacyPage.blocks }],
});`,
      },
      {
        name: "isBlockType(block, type)",
        returnType: "block is OutputBlockData<K, BlokBlockDataMap[K]>",
        description:
          "A type guard exported from `@bloklabs/core/tools`. It narrows a saved block to a known block type, so its `data` is typed through the `BlokBlockDataMap` registry instead of `Record<string, unknown>`. It replaces the `block.type === 'header'` check plus the `data as HeaderData` cast. `BlokBlockDataMap` maps each built-in block type to its data shape and is exported from the same subpath. It is augmentable, so a custom tool registers its own shape by declaration merging and gets narrowed the same way.",
        example: `import { isBlockType } from '@bloklabs/core/tools';
import type { OutputData } from '@bloklabs/core';

function logHeadings(saved: OutputData) {
  for (const block of saved.blocks) {
    if (isBlockType(block, 'header')) {
      console.log(block.data.level); // number — no cast
    }
  }
}

// A custom tool joins the registry by declaration merging
declare module '@bloklabs/core/tools' {
  interface BlokBlockDataMap {
    'my-widget': { widgetId: string };
  }
}`,
      },
      {
        name: "blocksOfType(data, type)",
        returnType: "Array<OutputBlockData<K, BlokBlockDataMap[K]>>",
        description:
          "The collection counterpart of `isBlockType`, also exported from `@bloklabs/core/tools`. It collects every saved block of a given type from a document, and each result's `data` is typed through `BlokBlockDataMap`. It tolerates null: a `null` or `undefined` document is accepted, and so is the loose `LooseOutputData` wire shape. So it replaces the `(data?.blocks ?? []).filter(...)` plus cast that every feature re-writes.",
        example: `import { blocksOfType } from '@bloklabs/core/tools';
import type { OutputData } from '@bloklabs/core';

// \`saved\` may be null — blocksOfType tolerates it and returns []
function buildToc(saved: OutputData | null) {
  return blocksOfType(saved, 'header')
    // data.text / data.level are typed — no cast
    .map((block) => ({ text: block.data.text, level: block.data.level }));
}`,
      },
      {
        name: "EMPTY_OUTPUT_DATA",
        returnType: "OutputData",
        description:
          "A shared, deeply frozen empty document (`{ blocks: [] }`), exported from the main entry. Use it in place of a hand-written `{ blocks: [] }` literal for cleared or pristine baselines. It is frozen, blocks array included, so a shared reference can never be mutated into a stale non-empty baseline.",
        example: `import { EMPTY_OUTPUT_DATA, equalsOutputData } from '@bloklabs/core';

const saved = await editor.save();
const isPristine = equalsOutputData(saved, EMPTY_OUTPUT_DATA, {
  ignoreEmptyDefaultBlocks: true,
});`,
      },
      {
        name: "toRenderableData(data)",
        returnType: "OutputData | LooseOutputData",
        description:
          "Maps a controlled `data` value to something render()/blocks.render() accepts, exported from the main entry. A whole-document `null`, which is a controlled \"clear to empty\", becomes `{ blocks: [] }`. Any real document passes through untouched. The strict guard in render() reads `data.blocks` and would throw on `null`, so route a nullable controlled value through this first.",
        example: `import { toRenderableData } from '@bloklabs/core';

// \`draft\` may be null when the host clears the document
await editor.blocks.render(toRenderableData(draft));`,
      },
      {
        name: "createEmittedEchoWindow(capacity?)",
        returnType: "{ record; matches; clear }",
        description:
          "Creates a bounded window of recently emitted onSave payloads, so you can recognize controlled-`data` echoes. Exported from the main entry. Deduping against only the LAST emitted payload is not enough. A host that persists on save and refetches can hand back a STALE echo, an earlier save arriving after a newer one already replaced the baseline. Re-rendering that echo would clobber the caret and any content typed since. Matching is structural (equalsOutputData), so envelopes reshaped in transit (fresh `time`, stripped ids) still count as echoes.",
        example: `import { createEmittedEchoWindow } from '@bloklabs/core';

const echoes = createEmittedEchoWindow();
// in onSave: echoes.record(data)
// before re-rendering incoming props: if (echoes.matches(next)) return;`,
      },
      {
        name: "migrateLegacyBlocks(blocks, options?)",
        returnType: "OutputBlockData[]",
        description:
          "Migrate legacy or Editor.js-style blocks into Blok's hierarchical flat-with-references format, exported from the `@bloklabs/core/migrate` subpath. It is the same transform the renderer runs automatically at load. Legacy nested shapes (list items, toggle and callout children) explode into separate blocks linked by `parent`/`content`. `parent` is the saved-document field; `parentId` is the useBlocks BlockNode snapshot field. Blocks with no id are stamped with one. Already-hierarchical blocks pass through unchanged, so it is safe to run on current data and idempotent across repeated runs. `options` exposes the migration context. `generateId` makes the pass PURE: migrate the same document twice and the outputs are equal. You need that to compare a stored doc against its migration, or to re-run migration per render without minting fresh ids. `onLossyField` delivers every dropped field instead of dumping it to `console.warn`. `rules` adds your own grammar entries. `migrateLegacyOutputData(data, options?)` is the envelope-preserving variant. `needsLegacyMigration(blocks, options?)` reports whether a migration would change anything. `matchLegacyRule(block, options?)` is the per-block primitive: it returns the entry claiming a single block (or `null`) without re-scanning the table for every block. Every rules-taking entry point accepts either the options object or a bare `rules` array, so passing the array directly can't silently read as \"no rules\".",
        example: `import {
  migrateLegacyBlocks,
  migrateLegacyOutputData,
  needsLegacyMigration,
  matchLegacyRule,
} from '@bloklabs/core/migrate';

// Batch-upgrade persisted Editor.js documents
const upgraded = migrateLegacyOutputData(storedDocument);

// Or migrate just the blocks, skipping the pass when already current
const blocks = needsLegacyMigration(stored.blocks)
  ? migrateLegacyBlocks(stored.blocks)
  : stored.blocks;

// Deterministic migration: same input → equal output, every time
let n = 0;
const pure = migrateLegacyBlocks(stored.blocks, {
  generateId: () => \`blk-\${n++}\`,
  onLossyField: ({ blockType, field }) => report(blockType, field),
});

// Dispatch per block without allocating a throwaway array
const entry = matchLegacyRule(stored.blocks[0]); // → { legacyType, targetType, … } | null`,
        note:
          "Some data shapes only a specific tool understands (a columns layout, a custom media envelope), and core's built-in migration can't read them. Give that tool a static `upgradeData(data)`, a pure function that returns the tool's current data shape. Blok runs it at load, while composing each stored block, before the tool is constructed. A hook that throws is caught, and the block loads with its stored data.",
      },
      {
        name: "migrations (config) & migrateOutputData(data, migrations)",
        returnType: "OutputData",
        description:
          "Declare per-type \"old data shape → new data shape\" rules from OUTSIDE the tool class. `upgradeData` must live inside a tool you own. `migrations` is a map keyed by block type that you pass in editor config. So you can migrate a third-party tool you don't control, or your own tool without editing (and re-shipping) its class. Each rule is a pure `(data) => data` transform. Return the input unchanged, or `undefined`, when the data is already current. Blok applies the rule at load, after the tool's own `upgradeData` and BEFORE format analysis. That way `dataModel: 'auto'` sees the post-migration shape, and an 'auto' round-trip can't quietly undo the migration by saving the old shape back. A rule that throws falls back to the stored data, never a blank editor. The same map works offline: pass it to `migrateOutputData(data, migrations)` (or `migrateBlocks(blocks, migrations)`) from `@bloklabs/core/migrate` to batch-upgrade persisted records without opening an editor. All three framework adapters take it as the `migrations` prop or input.",
        example: `// 1. At load, via editor config
new Blok({
  tools: { myCard: MyCard },
  migrations: {
    // key = block type; old shape → new shape
    myCard: (data) => ('name' in data ? { ...data, title: data.name } : data),
    // \`data\` is BlockToolData (Record<string, unknown>), so narrow before reading
    image: (data) => {
      const file = data.file as { url?: string } | undefined;

      return file?.url ? { ...data, url: file.url } : data;
    },
  },
});

// 2. Offline / batch — same rules, no editor
import { migrateOutputData } from '@bloklabs/core/migrate';

const upgraded = migrateOutputData(storedDocument, {
  myCard: (data) => ({ ...data, title: data.name }),
});`,
        note:
          "Rules must be pure and idempotent. They run on every load, including on already-current data. Prefer `migrations` (config) for shapes a host decides from the outside. Prefer a tool's own `upgradeData` for shapes only that tool understands. They compose: `upgradeData` runs first, then the config `migrations` rule for that type.",
      },
      {
        name: "migrate(data, { migrations, rules, generateId, onLossyField })",
        returnType: "{ data: OutputData; report: MigrationReport }",
        description:
          "The composed entry point. It runs BOTH migration passes in the one correct order and reports what the migration cost. Data rules (`migrations`) run first. Then grammar rules (`rules`) restructure the tree. That order is load-bearing. Data rules are keyed by block TYPE, and the grammar rewrites types (`linkTool` → `bookmark`) and explodes containers into many blocks. So a rule run after the grammar never fires, and the block stays silently unmigrated. Data rules shape the grammar's input. The grammar owns the output shape for the types it rewrites. The `report` names every field the mapping could not carry over (`lossyFields`) and every data rule that threw (`errors`). So a batch upgrade of persisted records is no longer silent about its own data loss.",
        example: `import { migrate } from '@bloklabs/core/migrate';

let n = 0;
const { data, report } = migrate(storedDocument, {
  // 1. data rules — old data shape → new data shape, by block type
  migrations: {
    myCard: (d) => ('name' in d ? { ...d, title: d.name } : d),
  },
  // 2. grammar rules — structural: type changes, 1:N splits, sibling absorption
  rules: [alertRule],
  generateId: () => \`blk-\${n++}\`,
});

report.lossyFields; // [{ blockType: 'linkTool', field: 'meta.site_name', verb: 'dropped' }]
report.errors;      // [{ type: 'myCard', error }] — that block kept its stored data`,
        note:
          "`report.lossyFields` is what `console.warn` used to say and nothing could read. Log it next to a batch upgrade and you get an auditable record of exactly what the upgrade dropped, per block type.",
      },
      {
        name: "rules (custom legacy grammar entries)",
        returnType: "LegacyGrammarEntry[]",
        description:
          "Teach the migration machinery a legacy shape Blok doesn't know. A grammar entry is `{ legacyType, detect, expand, targetType, cardinality, contributesNesting, lossyFields, docNote }`. Passing entries via `rules` reuses the whole interpreter: recursion into container bodies, the orphan re-parenting invariant, 1:N splits, and id minting. You do not re-implement the dispatch loop around a data-only rule. Host entries are matched BEFORE the built-in table, so they can also override a built-in mapping. Unlike a `migrations` rule, an entry may change a block's `type` and emit several blocks. `expand(block, ctx, { siblings, index })` may also return `{ blocks, consumed }` to absorb the following `consumed` siblings. That is the shape flat-with-count legacy formats need, where a container stores its body as \"the next N blocks\". `consumed` is clamped to what remains, so a truncated document can't over-consume. Read `LEGACY_GRAMMAR` to introspect the built-in coverage.",
        example: `import { migrate, LEGACY_GRAMMAR, type LegacyGrammarEntry } from '@bloklabs/core/migrate';

// A legacy \`alert\` → callout + child paragraph (type change AND a 1:N split).
// The annotation is load-bearing: without it \`cardinality\` widens to \`string\`
// and \`detect\`/\`expand\` lose their contextual parameter types.
const alertRule: LegacyGrammarEntry = {
  legacyType: 'alert',
  targetType: 'callout',
  cardinality: '1:N',
  contributesNesting: true,
  lossyFields: [],
  docNote: '\`alert\` → \`callout\` + message paragraph.',
  detect: (block) => block.type === 'alert',
  expand: (block, ctx) => {
    const calloutId = block.id ?? ctx.generateId();
    const childId = ctx.generateId();

    return [
      { id: calloutId, type: 'callout', data: { emoji: '🚨' }, content: [childId] },
      { id: childId, type: 'paragraph', data: { text: block.data.message }, parent: calloutId },
    ];
  },
};

const { data } = migrate(storedDocument, { rules: [alertRule] });

// What does Blok migrate out of the box?
LEGACY_GRAMMAR.map((entry) => [entry.legacyType, entry.targetType, entry.lossyFields]);`,
        note:
          "A container rule whose body is stored as a COUNT of following siblings returns `{ blocks, consumed }`. The interpreter skips exactly that many siblings, so the children are re-parented once and never emitted twice.",
      },
    ],
  },
  {
    id: "block-data",
    badge: "Data",
    title: "OutputBlockData",
    description: "The structure of each block in the blocks array.",
    example: `// Individual block structure
interface OutputBlockData {
  id?: string;        // Unique identifier (auto-generated)
  type: string;       // Tool name (e.g., "paragraph", "header")
  data: object;       // Tool-specific data
  tunes?: { [name: string]: BlockTuneData }; // Optional block tunes/metadata
  parent?: string;    // Id of the parent block (flat-with-references nesting)
  content?: string[]; // Ids of child blocks (flat-with-references nesting)
  indent?: number;    // Nesting/indent level
  lastEditedAt?: number; // Timestamp (ms since epoch) of the last edit — omitted until the block is actually edited
  lastEditedBy?: string; // Id of the user who last edited this block (from user.id config)
}

// Example blocks:
const paragraphBlock: OutputBlockData = {
  id: "p6QK0Xz1Ab",
  type: "paragraph",
  data: { "text": "Hello, world!" }
};

const headerBlock: OutputBlockData = {
  id: "hM3lTn9RdC",
  type: "header",
  data: { "text": "Chapter 1", "level": 1 }
};

// Each list item is its own block — the list tool saves a single item,
// not an items[] array
const listItemBlock: OutputBlockData = {
  id: "wY7bV2sQ8e",
  type: "list",
  data: {
    "text": "Item 1",
    "style": "unordered"
  }
};`,
    table: [
      {
        option: "id",
        type: "string (optional)",
        default: "—",
        description: "Unique block identifier",
      },
      {
        option: "type",
        type: "string",
        default: "—",
        description: "Block type name",
      },
      {
        option: "data",
        type: "object",
        default: "—",
        description: "Block-specific data",
      },
      {
        option: "tunes",
        type: "{ [name: string]: BlockTuneData }",
        default: "—",
        description: "Block tunes/meta data",
      },
      {
        option: "parent",
        type: "string (optional)",
        default: "—",
        description:
          "Id of the parent block (flat-with-references nesting). On input the loose wire shape also accepts `null`. That value is treated as absent, so the block sits at root level.",
      },
      {
        option: "content",
        type: "string[] (optional)",
        default: "—",
        description:
          "Ids of child blocks (flat-with-references nesting). On input the loose wire shape also accepts `null` or `[]`. Both are treated as absent, so the block has no children.",
      },
      {
        option: "indent",
        type: "number (optional)",
        default: "—",
        description: "Nesting/indent level",
      },
      {
        option: "lastEditedAt",
        type: "number (optional)",
        default: "—",
        description:
          "Timestamp (ms since epoch) of the last edit to this block. It appears only once the block's content actually changes. Loading a document is not an edit, so a merely-rendered document saves back exactly what it loaded. equalsOutputData ignores this field.",
      },
      {
        option: "lastEditedBy",
        type: "string (optional)",
        default: "—",
        description: "Id of the user who last edited this block (from the user.id config)",
      },
    ],
  },
  {
    id: "blok-editor",
    badge: "Adapters",
    title: "BlokEditor component",
    lastUpdated: "2026-07-17",
    description:
      "The all-in-one editor component shipped by the framework adapters. It is <BlokEditor> in @bloklabs/react and @bloklabs/vue, and <blok-editor> (BlokEditorComponent) in @bloklabs/angular. React and Vue accept every editor config option as a prop. They forward unknown props and attributes to the container div. Angular works differently. It declares a fixed set of `@Input()`s: tools, data, readOnly, hideToolbar, toolbarPosition, inlineToolbar, theme, width, placeholder, styleTokens, i18n, autofocus, migrations, onBeforeRender, onBeforePaste and onError. Every other config key goes through the `[config]` escape hatch. That covers sanitizer, minHeight, defaultBlock, dataModel, link, linkPaste, tunes, user, resolveUser, uploader, server, ticket, persistence, collaboration, notifier, logLevel, onEnter, onSubmit, scrollToBlock and so on. Angular also does not forward host attributes onto the container div. You read the live Blok instance in each adapter. In React use ref/onReady. In Vue use the `instance` on a template ref or the `@ready` emit. In Angular use the `instance` signal or the `(ready)` output. The props below cover the adapter-specific surface. Everything else matches the Configuration options.",
    example: `import { useState } from 'react';
import { BlokEditor } from '@bloklabs/react';
import { Header, Paragraph, List } from '@bloklabs/core/tools';
import type { OutputData } from '@bloklabs/core';

export function Editor() {
  const [data, setData] = useState<OutputData>();

  // data + onSave form a controlled component: onSave fires (debounced)
  // with the serialized document; echoing it back is deduped and
  // caret-stable, while genuine external data changes re-render in place.
  return (
    <BlokEditor
      tools={{ paragraph: Paragraph, header: Header, list: List }}
      data={data}
      onSave={setData}
      theme="auto"
      className="my-editor"
    />
  );
}`,
    methods: [
      {
        name: "useBlok(config, deps?)",
        returnType: "Blok | null (React) | Ref<Blok | null> (Vue)",
        description:
          "The split mount path behind `<BlokEditor>`: you create the instance yourself and hand it a mount point. `useBlok` takes the SAME options as the component. Its config type is `UseBlokConfig`, which is `BlokConfig` minus `holder` (the adapter owns the mount element) plus an adapter-level `width`. `UseBlokConfig` itself documents the subset that stays reactive after mount: `readOnly`, `hideToolbar`, `toolbarPosition`, `inlineToolbar`, `autofocus`, `theme`, `width`, `placeholder`, `style.tokens`, `i18n` and `data` sync in place on the same instance. Every other option is read once at editor creation. It returns null until the editor exists (SSR, first render). React takes a `deps` dependency LIST as the second argument. Vue takes a reactive config source (ref or getter) and a SINGLE `recreateKey` as the second argument. The Angular equivalent is the `[blokContent]` directive (`BlokContentDirective`). It builds the instance into its own host element and exposes it as the `instance` signal / `(ready)` output.",
        example: `import { useBlok, BlokContent } from '@bloklabs/react';
import { Header, Paragraph } from '@bloklabs/core/tools';

export function Editor() {
  const editor = useBlok({
    tools: { paragraph: Paragraph, header: Header },
    readOnly: false,
  });

  return <BlokContent editor={editor} className="my-editor" />;
}`,
      },
      {
        name: "BlokContent",
        returnType: "React/Vue component",
        description:
          "The mount point for an instance created by `useBlok`. It renders a `<div>` and adopts the editor's detached holder into it. Its only own prop is `editor: Blok | null` (`BlokContentProps`). Pass null before the instance exists and it renders the empty container. In React it also extends `React.HTMLAttributes<HTMLDivElement>`, so `className`, `id` and the rest are forwarded to that div, and it forwards a ref to it. The Angular counterpart is the `[blokContent]` directive, which creates the instance itself instead of receiving one.",
        example: `import { useBlok, BlokContent } from '@bloklabs/react';

const editor = useBlok({ tools });

// \`editor\` is null until the instance exists — BlokContent handles that
<BlokContent editor={editor} className="prose" />`,
      },
      {
        name: "provideBlok(defaults)",
        returnType: "void | EnvironmentProviders",
        description:
          "Registers app-wide Blok defaults. Every editor beneath it then inherits a shared tools registry, theme or i18n config instead of repeating them per instance. React spells it as `<BlokProvider defaults={…}>`, with `useBlokDefaults()` to read them back. Vue spells it as `provideBlok(defaults)` called in a parent's `setup`, backed by the `BLOK_DEFAULT_CONFIG` injection key, with `useBlokDefaults()` to read. Angular spells it as `provideBlok(defaults)` returning `EnvironmentProviders` for a `providers` array, backed by the `BLOK_DEFAULT_CONFIG` injection token. The merge rule is identical in all three: a defined per-instance config value overrides the default. `tools` is the exception. There the two registries are merged, so the shared registry composes with per-instance additions instead of being replaced.",
        example: `// React
import { BlokProvider } from '@bloklabs/react';

<BlokProvider defaults={{ theme: 'dark', tools: sharedTools }}>
  <App />
</BlokProvider>

// Vue — inside a parent component's setup()
import { provideBlok } from '@bloklabs/vue';
provideBlok({ theme: 'dark', tools: sharedTools });

// Angular
import { provideBlok } from '@bloklabs/angular';
bootstrapApplication(AppComponent, {
  providers: [provideBlok({ theme: 'dark', tools: sharedTools })],
});`,
      },
    ],
    table: [
      {
        option: "tools",
        type: "Record<string, ToolConstructable | ToolSettings>",
        default: "—",
        description:
          "Block tools to register. React only: functions anywhere inside a tool's config (for example an uploader callback) are re-bound to the latest render automatically. So inline closures are safe, and only a changed tool CLASS needs a `deps` entry. Vue and Angular have no equivalent. There a closure in a tool config is captured when the editor is constructed, and then goes stale. Keep it in a stable ref/field, or force a rebuild by changing `recreateKey`.",
      },
      {
        option: "data",
        type: "OutputData | LooseOutputData | null",
        default: "—",
        description:
          "Editor content (reactive). It seeds the initial document. After mount, new content re-renders in place on the same instance and never recreates the editor. That includes transitions to and from empty content. Updates are deduped with the same structural lens as equalsOutputData, so echoing the editor's own output back never clobbers the caret. That holds even after a persistence layer strips it: a fresh `time`/`version`, dropped ids and a missing `lastEditedAt` stamp still count as unchanged. Imperative content calls stay in the same world. React's useBlokHandle().clear() / .render() and Angular's BlokEditorComponent.render() update that baseline once they land. So setting `data` back to a document the editor itself emitted re-renders it instead of being dismissed as an echo. A whole-document `null` is the controlled \"clear to empty\" value. Route it through `toRenderableData` when you call render() yourself. Loose backend DTOs are accepted as-is. Angular widens the type to `… | undefined`. Vue's prop is declared `PropType<OutputData>` and is the narrow outlier.",
      },
      {
        option: "onSave",
        type: "(data: OutputData, api: API) => void",
        default: "—",
        description:
          "The output half of the controlled component. It fires (debounced) with the full serialized document on every content change, so there is no manual save() polling. Wiring onSave={setData} is safe and recursion-free. The `(data, api)` arity is React's, where the prop is passed straight through to the core config. Vue maps it to the `save` emit and Angular to the `save` output. Both carry `OutputData` only: `@save=\"(data) => …\"` / `(save)=\"…\"`. You can also use `v-model:data` / `[(data)]`, backed by Vue's `update:data` emit and Angular's `dataChange` output.",
      },
      {
        option: "onChange",
        type: "(api: API, event: BlockMutationEvent | BlockMutationEvent[]) => void",
        default: "—",
        description:
          "Low-level mutation events (block added/changed/moved/removed). Use it when you need per-mutation granularity instead of serialized output. A batch of mutations arrives as an ARRAY, so branch on `Array.isArray(event)` before reading `event.detail`. The two positional arguments are React's arity. Vue's `change` emit and Angular's `change` output deliver ONE object instead: `@change=\"({ api, event }) => …\"` / `(change)=\"…\"` with `$event.api` and `$event.event`.",
      },
      {
        option: "onReady",
        type: "(editor: Blok) => void",
        default: "—",
        description:
          "Called with the live Blok instance, exactly once per editor instance. It fires after the forwarded ref commits, so ref.current is also populated. The editor is recreated, and onReady fires again, only when deps/recreateKey change or the component remounts. Changes to data, including to and from empty content, re-render in place and never re-fire it. Vue and Angular spell it as the `ready` emit/output (`@ready` / `(ready)`).",
      },
      {
        option: "deps / recreateKey",
        type: "DependencyList (React) | unknown (Vue, Angular)",
        default: "[] (React)",
        description:
          "Values whose identity change destroys and recreates the editor. Use it for structural config like tool classes. React takes an array, `deps`, and recreates when any entry's identity changes. Vue (`:recreate-key`) and Angular ([recreateKey]) take a SINGLE value instead. They recreate when that value's identity changes, so pass a fresh object/array literal or a bumped counter. `deps` does not exist on Vue/Angular. Keep each value referentially stable. Functions inside tool configs do NOT belong here on React. They are re-bound to the latest render automatically.",
      },
      {
        option: "readOnly",
        type: "boolean | ReadOnlyModeConfig",
        default: "false",
        description: "Read-only mode. Reactive: toggles in place after mount, without remounting.",
      },
      {
        option: "theme",
        type: "'light' | 'dark' | 'auto'",
        default: "'auto'",
        description:
          "Color theme (reactive). Don't wrap the component in styled() or any HOC that reserves the theme prop. It would never reach the editor.",
      },
      {
        option: "onThemeChange",
        type: "(resolvedTheme: 'light' | 'dark') => void",
        default: "—",
        description: "Called with the resolved theme whenever it changes, for example when 'auto' follows the OS. Vue and Angular spell it as the `theme-change` emit / `themeChange` output (`@theme-change` / `(themeChange)`).",
      },
      {
        option: "width",
        type: "'narrow' | 'full'",
        default: "'narrow'",
        description: "Content width mode (reactive). It is synced after mount via editor.width.set(). See the Width API for the imperative surface (get / set / toggle).",
      },
      {
        option: "style",
        type: "BlokConfig['style']",
        default: "—",
        description:
          "Styling config. `style.tokens` is reactive. Changed `--blok-*` overrides sync in place after mount via editor.tokens.set(), deduped by deep equality, so a host light/dark toggle needs no remount. It replaces rather than merges: pass the whole palette, because tokens dropped from it stop applying. Angular has no `style` input. It exposes only `style.tokens`, as the separate `[styleTokens]` input (`Record<string, string>`). The remaining `style` keys, `fontSize`, `contentAlign` and `nativeSelection`, must go through Angular's `[config]` escape hatch.",
      },
      {
        option: "i18n",
        type: "BlokConfig['i18n']",
        default: "—",
        description:
          "Internationalization config (reactive). A changed `locale`, `messages` or `direction` syncs in place after mount via editor.i18n.update(), deduped by deep equality. So a language switcher relabels the editor without remounting it, and caret, focus, selection and undo history survive. `defaultLocale` is the exception: it is read only at construction. Angular exposes this as the [i18n] input.",
      },
      {
        option: "locale",
        type: "string",
        default: "—",
        description:
          "React only. A library-neutral BCP-47 shorthand for `i18n.locale`. It is folded into the i18n config and applied in place via editor.i18n.update({ locale }), so a language switch keeps caret, focus and undo history. When both are given, it WINS over `i18n.locale`. Pair it with `getDirection` / `normalizeLocale`, re-exported from @bloklabs/react, to compute `dir` and validate tags yourself. Vue and Angular have no such prop. There you pass the locale inside the `i18n` prop/input.",
      },
      {
        option: "autofocus",
        type: "boolean",
        default: "false",
        description: "Focus the editor after it mounts.",
      },
      {
        option: "placeholder",
        type: "string | false",
        default: "—",
        description: "Placeholder text handed to every block of the default tool, not only the first block. With the built-in paragraph it shows while a block is empty and focused. See the Configuration table for what `false` does and does not disable. See the Placeholder API to change it at runtime via editor.placeholder.set().",
      },
      {
        option: "onBlocksRendered",
        type: "(payload: BlocksRenderedPayload) => void",
        default: "—",
        description:
          "Called after a batch render completes (the core blocks:rendered event). It is the declarative analog of editor.on('blocks:rendered', …). Vue and Angular spell it as the `blocks-rendered` emit / `blocksRendered` output.",
      },
      {
        option: "onBlockRendered",
        type: "(payload: BlockRenderedPayload) => void",
        default: "—",
        description: "Called for each block rendered into the DOM (core block:rendered event). Vue and Angular spell it as the `block-rendered` emit / `blockRendered` output.",
      },
      {
        option: "ref",
        type: "Ref<Blok | null>",
        default: "—",
        description:
          "Forwarded to the live Blok instance for imperative calls (save, render, blocks, caret, …). It is null until the editor mounts, so calls must guard on ref.current. For the common shortcuts without the guards, @bloklabs/react's useBlokHandle() returns a stable, null-safe handle. Attach it via ref={handle.ref} and call handle.focus()/save()/clear()/render()/setReadOnly() directly. Each one safely no-ops until ready, and handle.current is the escape hatch to the full instance. When you also drive content through the `data` prop, prefer the handle for clear()/render(). It updates the controlled baseline. A raw ref.current.render()/clear() changes the content behind the adapter's back, and a later `data` value equal to what the editor emitted before is then deduped away.",
      },
      {
        option: "className, id, …",
        type: "HTMLAttributes<HTMLDivElement>",
        default: "—",
        description:
          "Any prop that is not an editor config option is forwarded to the container div. Style the editor through className (style keeps its editor-config meaning).",
      },
    ],
  },
  {
    id: "use-blocks",
    badge: "Adapters",
    title: "useBlocks",
    lastUpdated: "2026-08-07",
    description:
      "A reactive snapshot of the block tree plus a full manipulation API, from the framework adapters. Use the useBlocks(editor, options?) hook in @bloklabs/react, the useBlocks(editor, options?) composable in @bloklabs/vue, or `injectBlocks(editor, options?)` in @bloklabs/angular. In Angular, pass the `instance` signal of BlokEditorComponent/BlokContentDirective, and call it from an injection context (a field initializer or the constructor). Reads re-render reactively as the document changes. Writers are atomic: one undo step. They are also safe to call before the editor is ready, where they no-op. Returned BlockNode objects ({ id, type, parentId, contentIds }) come from a fresh snapshot and go stale. Read them now, don't stash them in dep arrays. Reactivity is document-wide by default. Pass `{ within: blockId }` to re-render only for changes inside that block's subtree: the block itself or any descendant. Reach for it in a container block that renders only its own children. Unscoped, such a block re-renders on every keystroke anywhere in the document, and a page of N containers turns one keystroke into N re-renders. The scope bounds re-renders, not reads: a scoped handle still sees the whole tree, so getById/getChildren keep working on anything. In Vue the scope also accepts a ref or getter, and in Angular a signal. It is read at emit time, so changing it needs no re-subscription.",
    example: `import { useBlok, BlokContent, useBlocks } from '@bloklabs/react';

export function Outline() {
  const editor = useBlok({ tools });
  const blocks = useBlocks(editor);

  // Reactive: re-renders whenever the document changes.
  const rootBlocks = blocks.getChildren(null);

  return (
    <>
      <BlokContent editor={editor} />
      <ol>{rootBlocks.map((b) => <li key={b.id}>{b.type}</li>)}</ol>
    </>
  );
}

// Inside a container block: re-render only for its OWN subtree, so typing in an
// unrelated block elsewhere in the document costs this component nothing.
function Steps({ block }) {
  const blocks = useBlocks(useBlokInstance(), { within: block.id });
  const steps = blocks.getChildren(block.id);

  return <ol>{steps.map((s) => <li key={s.id}>{s.type}</li>)}</ol>;
}`,
    methods: [
      {
        name: "getById(id)",
        returnType: "BlockNode | null",
        description: "The block with the given id as a snapshot node, or null when unknown.",
        example: `const node = blocks.getById('x9k2f1');
// → { id: 'x9k2f1', type: 'paragraph', parentId: null, contentIds: [] }`,
      },
      {
        name: "getChildren(parentId)",
        returnType: "BlockNode[]",
        description:
          "The direct children of a parent block, in document order. Pass null for the root blocks.",
        example: `const rootBlocks = blocks.getChildren(null);
const rowBlocks = blocks.getChildren(databaseBlockId);`,
      },
      {
        name: "insert(spec?)",
        returnType: "BlockNode | null",
        description:
          "Insert one block (type, data, parentId, position, tunes, id, focus/caret, replace). Use `replace: true` with a `position` that targets an existing block to replace that block instead of inserting beside it. That is a programmatic \"turn into\". Returns the created node, or null when rejected: an unknown tool type, a dangling parentId, or a `replace` whose target is missing. An explicit id that already exists is insert-if-absent. The call is atomic: one undo step.",
        example: `const node = blocks.insert({
  type: 'header',
  data: { text: 'New section', level: 2 },
  position: 'end',
  focus: true,
});
// → node.id is the new block's id (or null if rejected)`,
      },
      {
        name: "insertMany(specs)",
        returnType: "BlockNode[]",
        description:
          "Insert several blocks atomically, in array order, as ONE undo step. Specs that fail are dropped. Returns the nodes that were created.",
        example: `const nodes = blocks.insertMany([
  { type: 'header', data: { text: 'Title' } },
  { type: 'paragraph', data: { text: 'Body' } },
]);`,
      },
      {
        name: "insertTree(spec)",
        returnType: "BlockNode | null",
        description:
          "Insert a pre-built NESTED subtree in one atomic operation. Children are inserted under their enclosing node recursively. Placement options apply to the root only. Returns the root node, or null on a rejected or colliding id.",
        example: `const root = blocks.insertTree({
  type: 'toggle',
  data: { text: 'Details' },
  children: [
    { type: 'paragraph', data: { text: 'Hidden content' } },
  ],
});`,
      },
      {
        name: "insertMarkdown(markdown, options?)",
        returnType: "Promise<BlockNode[]>",
        description:
          "Convert a Markdown string to blocks and insert them ADDITIVELY, without clearing the document. The call is async, because the converter is lazy-loaded. Returns all created nodes in document order. Empty input or a dangling parentId returns [].",
        example: `const nodes = await blocks.insertMarkdown(
  '# Title\\n\\n- one\\n- two',
  { position: 'end' },
);`,
      },
      {
        name: "exportMarkdown()",
        returnType: "Promise<string>",
        description:
          "Serialize the WHOLE document to Markdown. The call is async and the serializer is lazy-loaded. Structure Markdown can't express, such as merged table cells, is dropped.",
        example: `const md = await blocks.exportMarkdown();`,
      },
      {
        name: "markdownToBlocks(md, config?)",
        returnType: "Promise<OutputBlockData[]>",
        description:
          "Convert Markdown to blocks WITHOUT an editor instance. It is the standalone `@bloklabs/core/markdown` subpath, not a method on the hook. It needs no DOM and no mounted Blok, so it covers the server-side path that insertMarkdown/exportMarkdown cannot: import Markdown in a Node job, seed a document, or precompute `data` before the editor mounts. `config` is a `MarkdownImportConfig` (tool mapping, GFM, extensions). The result is ready for `blocks.render()` or `blocks.insertMany()`.",
        example: `import { markdownToBlocks } from '@bloklabs/core/markdown';

// No editor instance required — this also runs on the server
const parsed = await markdownToBlocks('# Title\\n\\n- one\\n- two');

// -> OutputBlockData[]; store it, or hand it to a live editor
await blocks.render({ blocks: parsed });`,
      },
      {
        name: "markdownToBlocksWithReport(md, config?)",
        returnType: "Promise<{ blocks: OutputBlockData[]; warnings: MarkdownDegradation[] }>",
        description:
          "The same blocks, plus what Markdown could not carry into them. Blok has no raw-HTML block, so markup written into the Markdown is escaped and stored as literal text. That is safe, but silent. Use this when the import is unattended (an MCP tool, an agent, a bulk migration) and something has to be told what changed. Its outbound twin is blocksToMarkdownWithReport in @bloklabs/core/view.",
        example: `import { markdownToBlocksWithReport } from '@bloklabs/core/markdown';

const { blocks: parsed, warnings } = await markdownToBlocksWithReport(source);
// warnings: [{ construct: 'html', action: 'degraded', detail: 'HTML is escaped and stored as literal text…' }]

if (warnings.length === 0) {
  await blocks.render({ blocks: parsed });
}`,
      },
      {
        name: "move(id, target)",
        returnType: "void",
        description:
          "Move a block to a flat slot: { before }, { after }, or { toIndex }. The block adopts the parent of wherever it lands. Use nest/unnest to change the parent without picking a sibling slot.",
        example: `blocks.move(nodeId, { after: otherId });
blocks.move(nodeId, { toIndex: 0 });`,
      },
      {
        name: "nest(id, parentId)",
        returnType: "void",
        description: "Make a block a child of another block.",
        example: `blocks.nest(childId, toggleId);`,
      },
      {
        name: "unnest(id)",
        returnType: "void",
        description: "Move a nested block up one level (out of its parent).",
        example: `blocks.unnest(childId);`,
      },
      {
        name: "remove(id)",
        returnType: "void",
        description: "Remove a block (and its subtree).",
        example: `blocks.remove(nodeId);`,
      },
      {
        name: "update(id, data?, tunes?)",
        returnType: "void",
        description:
          "Update a block's data and/or tunes by id. It delegates to core's async blocks.update, which is its own undo step. Unknown ids are a silent no-op.",
        example: `blocks.update(nodeId, { text: 'Edited' });`,
      },
      {
        name: "convert(id, newType, dataOverrides?, options?)",
        returnType: "void",
        description:
          "Convert a block to another type (\"turn into\"). Both tools must define conversionConfig. A block that cannot be converted is a graceful no-op. options.caret places the caret in the converted block.",
        example: `blocks.convert(nodeId, 'header', { level: 2 });`,
      },
      {
        name: "transact(fn)",
        returnType: "void",
        description:
          "Run several mutations as ONE atomic undo step.",
        example: `blocks.transact(() => {
  blocks.remove(oldId);
  blocks.insert({ type: 'paragraph', data: { text: 'Replacement' } });
});`,
      },
      {
        name: "transactWithoutCapture(fn)",
        returnType: "void",
        description:
          "Like transact, but the operation is NOT captured in undo history. Use it for silent auto-repair or normalization that CMD+Z should never step through.",
        example: `blocks.transactWithoutCapture(() => {
  blocks.update(nodeId, { text: normalized });
});`,
      },
      {
        name: "splitBlock(currentBlockId, currentBlockData, newBlockType, newBlockData, insertIndex)",
        returnType: "BlockNode | null",
        description:
          "Atomically split a block: update the current block and insert a new one at an absolute flat index, as ONE undo step.",
        example: `const newNode = blocks.splitBlock(
  nodeId, { text: 'First half' },
  'paragraph', { text: 'Second half' },
  blocks.getBlockIndex(nodeId)! + 1,
);`,
      },
      {
        name: "insertInsideParent(parentId, insertIndex, childData?)",
        returnType: "BlockNode | null",
        description:
          "Insert a single child under a parent at a flat index, atomically: creation AND parent assignment in ONE undo step. Prefer it over insert() + nest(), which takes two steps.",
        example: `const child = blocks.insertInsideParent(toggleId, 3);`,
      },
      {
        name: "insertOutputData(blocks, options?)",
        returnType: "BlockNode[]",
        description:
          "Insert a flat array of already-serialized OutputBlockData (the save() shape) directly, honoring parent/content links. One atomic undo step.",
        example: `const nodes = blocks.insertOutputData(savedFragment.blocks);`,
      },
      {
        name: "render(data)",
        returnType: "Promise<void>",
        description:
          "Replace the WHOLE document with blocks from saved OutputData. It is a document-LOAD primitive: it clears existing content first, unlike the additive inserters.",
        example: `await blocks.render(savedData);`,
      },
      {
        name: "renderFromHTML(html)",
        returnType: "Promise<void>",
        description:
          "Replace the WHOLE document with blocks parsed from an HTML string (clears existing content first).",
        example: `await blocks.renderFromHTML('<h1>Imported</h1><p>Body</p>');`,
      },
      {
        name: "clear()",
        returnType: "Promise<void>",
        description: "Remove every block from the document.",
        example: `await blocks.clear();`,
      },
      {
        name: "getBlocksCount()",
        returnType: "number",
        description: "The current block count (reactive).",
        example: `const count = blocks.getBlocksCount();`,
      },
      {
        name: "getCurrentBlockIndex()",
        returnType: "number",
        description: "The flat index of the block holding the caret, or -1 when none.",
        example: `const index = blocks.getCurrentBlockIndex();`,
      },
      {
        name: "getBlockByIndex(index)",
        returnType: "BlockNode | null",
        description: "The block at a flat index as a snapshot node, or null.",
        example: `const first = blocks.getBlockByIndex(0);`,
      },
      {
        name: "getBlockIndex(id)",
        returnType: "number | null",
        description: "The absolute flat index of a block by id, or null when unknown.",
        example: `const index = blocks.getBlockIndex(nodeId);`,
      },
      {
        name: "getBlockData(id)",
        returnType: "{ data, tunes } | null",
        description:
          "Read a block's current data and tunes by id without mutating anything. It makes a client-side duplicate composable: read a node, then insert({ type, data, tunes }).",
        example: `const saved = blocks.getBlockData(nodeId);
if (saved) {
  blocks.insert({ type: 'paragraph', data: saved.data, position: { after: nodeId } });
}`,
      },
      {
        name: "getBlockByElement(element)",
        returnType: "BlockNode | null",
        description:
          "The block whose holder contains or equals a DOM element. It maps an event target back to a block.",
        example: `const node = blocks.getBlockByElement(event.target as HTMLElement);`,
      },
      {
        name: "composeBlockData(toolName)",
        returnType: "Promise<BlockToolData>",
        description:
          "Read a tool's default empty data without inserting anything. Rejects for an unknown tool.",
        example: `const defaults = await blocks.composeBlockData('header');`,
      },
      {
        name: "isSyncingFromYjs()",
        returnType: "boolean",
        description:
          "Whether a Yjs sync (undo/redo) is in progress. Use it to skip cleanup that would fight undo state.",
        example: `if (!blocks.isSyncingFromYjs()) {
  blocks.update(nodeId, { text: cleaned });
}`,
      },
    ],
  },
  {
    id: "use-blok-ready",
    badge: "Adapters",
    title: "useBlokReady",
    lastUpdated: "2026-07-22",
    description:
      "Live readiness of the Blok editors inside a DOM subtree, as a boolean you can render from. Use the useBlokReady(options) hook in @bloklabs/react, the useBlokReady(options) composable in @bloklabs/vue, which returns a ref, or injectBlokReady(options) in @bloklabs/angular, which returns a signal. All three wrap the same core registry behind Blok.readyState() and Blok.subscribeReady(), so they cannot drift. It answers the question a comments list or a form actually has: are MY editors ready? Scope it with the ref you already hold on the container. Then an unrelated editor elsewhere on the page cannot hold your gate closed. It is a live signal, not a one-shot latch. An editor mounted later re-closes the gate, and with settleOn: 'rendered' so does every re-render from a changed data prop. A scope holding no editors is ready, so the empty-list case needs no special-casing. It starts false and takes its first real reading once the scope element is attached (React: the mount effect; Vue: onMounted; Angular: afterNextRender). A scope you asked for that has not resolved yet reports false, rather than silently falling back to the whole page. Over-waiting is safe. Under-waiting is a bug.",
    example: `import { useRef } from 'react';
import { BlokEditor, useBlokReady } from '@bloklabs/react';

export function Comments({ comments }) {
  const listRef = useRef<HTMLDivElement>(null);

  // True once every editor inside listRef has its content in the DOM.
  // Re-arms whenever a comment's data changes and it re-renders.
  const ready = useBlokReady({ within: listRef, settleOn: 'rendered' });

  return (
    <>
      <div ref={listRef}>
        {comments.map((c) => (
          <BlokEditor key={c.id} data={c.body} readOnly />
        ))}
      </div>
      {!ready && <Skeleton />}
      <Composer autoFocus={ready} />
    </>
  );
}

// Vue — a ref:
// const list = ref<HTMLElement | null>(null);
// const ready = useBlokReady({ within: list, settleOn: 'rendered' });

// Angular — a signal, from an injection context:
// @ViewChild('list', { static: true }) listRef!: ElementRef<HTMLElement>;
// readonly ready = injectBlokReady({
//   within: () => this.listRef?.nativeElement ?? null,
//   settleOn: 'rendered',
// });`,
    methods: [
      {
        name: "useBlokReady(options?)",
        returnType: "boolean",
        description:
          "True when every Blok editor in scope is settled. It re-evaluates on every readiness change (construction, boot, render-state flip, destroy) and unsubscribes on unmount.",
        params: [
          {
            name: "options.within",
            type: "RefObject<Element | null> | Element | null",
            required: false,
            description:
              "Restrict the wait to editors mounted inside this element. A ref is re-read on every readiness change, so one that attaches after the first render is picked up. Omit it to observe every editor on the page.",
          },
          {
            name: "options.settleOn",
            type: "'ready' | 'rendered'",
            required: false,
            default: "'ready'",
            description:
              "'ready' settles when each editor has finished booting. 'rendered' also waits for its content to be in the DOM, which re-arms on every post-boot re-render.",
          },
        ],
        example: `const ready = useBlokReady({ within: listRef, settleOn: 'rendered' });`,
      },
    ],
  },
  {
    id: "view-api",
    badge: "Core",
    title: "View renderer",
    lastUpdated: "2026-08-07",
    description:
      "Display saved documents without paying for an editor. The @bloklabs/core/view subpath renders OutputData to semantic HTML or plain text. It is synchronous and DOM-free, so it runs in Node, workers, and React Server Components. Display-only surfaces (published pages, previews, search indexing, emails) no longer need an editor instance, its bundle, or its async ready latch. Every inline-content field is sanitized against the composed allowlist before interpolation, and the URL scheme policy is identical to the editor's. Pair the functions with defineBlokSchema and documents are displayed under the same sanitize composition that produced them. If you later change the inline-tool set at runtime via tools.setInlineToolbar, recompose the schema so the view keeps up. For React, use <BlokView> or the wrapper-free useBlokView as the read-only path. Do not reach for <BlokEditor readOnly>, which ships the full editing runtime (toolbar, history, mutation machinery) to every viewer. Output is unstyled by default. For editor parity, opt into classes and root together with the opt-in @bloklabs/core/view.css. For the classless baseline, use toolAttributes alone with that stylesheet: it reproduces the editor's block spacing from the same --blok-block-padding-* tokens. Enable blockIds for copy-link-to-block deep links, and pass transformUrl to rewrite hrefs or CDN image URLs.",
    example: `// schema.ts — pure and module-scope-safe; share it between editor and server
import { defineBlokSchema } from '@bloklabs/core/view';
import { Header, Paragraph, List } from '@bloklabs/core/tools';

export const schema = defineBlokSchema({
  tools: { paragraph: Paragraph, header: Header, list: List },
});

// Editing side (browser)
import Blok from '@bloklabs/core';
const editor = new Blok({ holder: 'editor', ...schema.editorConfig });

// Display side — Node, a worker, an RSC, or the browser; no DOM needed
import { blocksToHtml, blocksToPlainText } from '@bloklabs/core/view';
const html = blocksToHtml(savedData, { schema: schema.viewSchema });
const preview = blocksToPlainText(savedData).slice(0, 160);`,
    methods: [
      {
        name: "blocksToHtml(data, options?)",
        returnType: "string",
        description:
          "Render a saved document to semantic HTML. It is synchronous and DOM-free, so it is safe in Node, workers, and React Server Components. Every inline-content field is sanitized against the composed allowlist before interpolation, and the URL scheme policy is identical to the editor's. Returns '' for empty or malformed documents (nullish input is tolerated).",
        params: [
          {
            name: "data",
            type: "OutputData | LooseOutputData | null | undefined",
            required: true,
            description: "Saved document, in the strict save() shape or the loose wire shape.",
          },
          {
            name: "options.schema",
            type: "BlokViewSchema",
            required: false,
            description:
              "viewSchema from defineBlokSchema. It carries a single composed baseSanitize, folded from the enabled INLINE TOOLS and TUNES, not from block tools' own static sanitize. That config is spread over the renderer's default inline allowlist, so inline content displays under the same composition that produced it. viewSchema.tools is carried for consumers, but the renderer does not read it. To control a custom block's markup, use renderers.",
          },
          {
            name: "options.renderers",
            type: "Record<string, (data, ctx) => string>",
            required: false,
            description:
              "Custom per-tool renderers. A renderer wins over the built-in emitter for its tool name. ctx provides sanitizeInline (sanitize an inline-HTML string), renderBlocks (render an arbitrary block array), plainText (plain text of an HTML string), and renderChildren (render the current block's structural children), so custom output composes safely with the rest of the document.",
          },
          {
            name: "options.inlineRenderers",
            type: "Record<string, (element) => string | undefined>",
            required: false,
            description:
              "Custom renderers for INLINE elements, keyed by lowercase tag name. They are the inline counterpart of renderers, for marks whose display is not their stored markup: an inline equation stores only its LaTeX source, a mention only an id. Each one runs after sanitization, over the elements that survived it, and REPLACES the element with what it returns. Return undefined to keep the element as sanitized, or '' to drop it. The returned markup is inserted as-is and is NOT re-sanitized. That is the same trust contract as a block renderer's output, so it may carry markup the inline allowlist would strip (KaTeX spans, for instance). element is { tag, attrs, html, text }. This affects rendered HTML only: blocksToPlainText reads a mark's stored source, not its rendering.",
          },
          {
            name: "options.onUnknownBlock",
            type: "'skip' | 'comment'",
            required: false,
            default: "'skip'",
            description:
              "What to do with a block whose tool has no renderer: drop it silently, or leave an HTML comment marker in the output.",
          },
          {
            name: "options.toolAttributes",
            type: "boolean",
            required: false,
            default: "false",
            description:
              "Stamp data-blok-tool=\"<type>\" on each block root (list runs on their <ul>/<ol>) as a styling hook. Import the opt-in @bloklabs/core/view.css to reproduce the editor's block spacing from the same --blok-block-padding-* tokens, instead of reverse-engineering it with bare-tag CSS. Only Blok's built-in markup is stamped. Custom renderers and bare containers (database) are left untouched.",
          },
          {
            name: "options.blockIds",
            type: "boolean",
            required: false,
            default: "false",
            description:
              "Stamp data-blok-id=\"<id>\" on each block root, and list items on their <li> rather than the grouped <ul>/<ol>, so \"copy link to block\" deep links resolve off the live editor. Blocks without an id are left unstamped, and so are bare containers that emit no root of their own (database).",
          },
          {
            name: "options.transformUrl",
            type: "(url, ctx) => string",
            required: false,
            description:
              "Pure URL rewrite hook. It runs on every block URL (image/video/audio src, file/bookmark/embed href) and on every inline anchor href, so you can rewrite hrefs or route CDN image URLs. ctx is { attr: 'href' | 'src', blockType?: string }, and blockType is undefined for inline anchors. The hook runs BEFORE the unsafe-scheme strip, so a rewrite can never re-introduce a javascript:/data: sink. Return '' to drop the URL.",
          },
          {
            name: "options.root",
            type: "boolean",
            required: false,
            default: "false",
            description:
              "Wrap the output in <div data-blok-interface=\"view\">. This is not cosmetic. The scoped preflight and the token/colour layers key on the bare [data-blok-interface] attribute, so emitted classes compute differently without the wrapper and @bloklabs/core/view.css cannot reproduce the editor's appearance. It is opt-in because it adds an element to existing output. <BlokView> stamps the attribute on its own wrapper, so React consumers never set this.",
          },
          {
            name: "options.classes",
            type: "boolean",
            required: false,
            default: "false",
            description:
              "Render blocks with the editor's presentational classes and the per-block holder → content scaffolding, so the result matches a read-only editor render. To actually paint, it needs @bloklabs/core/view.css plus root: true (or a [data-blok-interface] ancestor). A few tools also gain a wrapper element under this flag. <BlokView> enables it by default, the useBlokView hook does not.",
          },
        ],
        example: `import { blocksToHtml } from '@bloklabs/core/view';

const html = blocksToHtml(savedData, {
  schema: schema.viewSchema,
  onUnknownBlock: 'comment',
  renderers: {
    // Wins over the built-in paragraph emitter
    paragraph: (data, ctx) =>
      \`<p class="lead">\${ctx.sanitizeInline(String(data.text ?? ''))}</p>\`,
  },
});`,
      },
      {
        name: "blocksToPlainText(data, options?)",
        returnType: "string",
        description:
          "Extract the plain text of a saved document. Blocks are separated by \\n\\n, list items by \\n, and table cells by \\t. It is synchronous and DOM-free, with the same options as blocksToHtml plus includeHiddenText. Use it for previews, search indexing, and character counts.",
        params: [
          {
            name: "data",
            type: "OutputData | LooseOutputData | null | undefined",
            required: true,
            description: "Saved document, in the strict save() shape or the loose wire shape.",
          },
          {
            name: "options.includeHiddenText",
            type: "boolean",
            required: false,
            description:
              "Also read the media text the default output leaves out, because the editor paints it as an attribute or does not paint it at all. That covers an image's alt, a video's or file's url, an embed's source, an audio track's title, artist and url, and a bookmark's description and url. Each one is appended after the block's visible label, one per line. It is off by default, so the default output stays exactly what a reader sees on screen. Turn it on for a search index, where alt text and a pasted URL are both things people search for.",
          },
        ],
        note:
          "There is no core \"document size\" helper, because the two sizes you might mean are measured differently. `blocksToPlainText(data).length` is the visible content length, which is what a user typed. `new TextEncoder().encode(JSON.stringify(data)).length` is the transport size in bytes, which is what a save or upload limit (e.g. 500KB) should check. Use the plain-text length for content rules and the JSON byte length for storage rules.",
        example: `import { blocksToPlainText } from '@bloklabs/core/view';

// A 160-character preview for a card or meta description
const preview = blocksToPlainText(savedData).slice(0, 160);

// Content length (characters the user typed) vs transport size (bytes on the wire)
const contentLength = blocksToPlainText(savedData).length;
const transportBytes = new TextEncoder().encode(JSON.stringify(savedData)).length;
if (transportBytes > 500 * 1024) {
  throw new Error('Document exceeds the 500KB save limit');
}`,
      },
      {
        name: "blocksToMarkdown(data)",
        returnType: "string",
        description:
          "Serialize a saved document to Markdown. It is synchronous and DOM-free, the outbound twin of markdownToBlocks. Headings become #, lists -/1., to-dos - [x], and tables GFM pipe grids. Markdown has no callout, toggle, column or spacer. So a callout becomes a blockquote carrying its emoji, a toggle becomes a bold summary followed by its body, columns flatten into reading order, and a spacer is dropped. Returns '' for empty or malformed documents.",
        example: `import { blocksToMarkdown } from '@bloklabs/core/view';

// Feed an article to an LLM, or write it to a .md file
const markdown = blocksToMarkdown(savedData);`,
      },
      {
        name: "blocksToMarkdownWithReport(data)",
        returnType: "{ markdown: string; warnings: MarkdownDegradation[] }",
        description:
          "The same Markdown, plus a list of what could not be carried across. Each entry names the construct, says whether it was 'dropped' (nothing emitted) or 'degraded' (emitted lossily), and why. Use it when the result goes somewhere that cannot ask a follow-up question, such as an AI client or an export, and needs to be told what it is missing. A block that leaves no output and carries no inline text is reported too, so a custom tool with no Markdown form is named rather than vanishing.",
        example: `import { blocksToMarkdownWithReport } from '@bloklabs/core/view';

const { markdown, warnings } = blocksToMarkdownWithReport(savedData);
// warnings: [{ construct: 'callout', action: 'degraded', detail: 'callout is rendered as a blockquote; …' }]`,
      },
      {
        name: "htmlTextContent(html)",
        returnType: "string",
        description:
          "Extract the plain text of an HTML fragment. It is synchronous and DOM-free, the view renderer's replacement for element.textContent. Entities are decoded (`a &lt; b` → `a < b`) and `<br>` becomes a newline. Use it instead of hand-rolling a DOMParser strip (which needs a DOM) when reducing an inline-HTML field to text.",
        example: `import { htmlTextContent } from '@bloklabs/core/view';

htmlTextContent('<b>Intro</b> &amp; more'); // → 'Intro & more'`,
      },
      {
        name: "sanitizeHtmlFragment(html, config)",
        returnType: "string",
        description:
          "Sanitize an HTML fragment against a sanitizer config with no DOM. It is parse5-backed and matches the editor's html-janitor semantics. `config` is a tag → rule allowlist, or the `'plaintext'` sentinel to strip markup entirely. It is the DOM-free counterpart of `api.sanitizer.clean()`, so use it in Node, workers and RSC, where the editor's sanitizer cannot run.",
        example: `import { sanitizeHtmlFragment } from '@bloklabs/core/view';

sanitizeHtmlFragment('<b>bold</b><script>x()</script>', { b: {} });
// → '<b>bold</b>'`,
      },
      {
        name: "outlineFromOutputData(data)",
        returnType: "OutlineItem[]",
        description:
          "Extract the heading outline of a saved document, the source for a table of contents. It is synchronous and DOM-free. It walks the document in reading order (top-level blocks, then structural children), picks header blocks, and reduces each heading's inline HTML to plain text. Each item is { id?, level, text }. The block id drives anchor links and scroll targets, so no separate DOMParser pass is needed. Headings with empty text are skipped.",
        example: `import { outlineFromOutputData } from '@bloklabs/core/view';

const toc = outlineFromOutputData(savedData);
// → [{ id: 'h1', level: 1, text: 'Getting Started' }, ...]`,
      },
      {
        name: "restoreHeadingAnchors(data)",
        returnType: "{ data, report }",
        description:
          "Repair in-document links whose target was lost during an import. HTML addresses its own sections by an id on the heading. Google Docs writes <h2 id=\"h.2y1ok8y7pef0\"> and links its table of contents to that fragment. A converter that mints its own block ids and drops the source ones leaves those links pointing at nothing. The link's text still names the heading, so this pass hands each dead fragment to the heading that text names, as HeaderData.anchor. Because it writes content, it guesses as little as possible. It takes only headings with no anchor yet, it needs an exact text match (markup, entities and whitespace normalized away, punctuation is not), and it acts only when exactly one heading and one fragment claim each other. Anything less certain is left alone and listed in report.skipped. Running it twice changes nothing further. Call it yourself as a one-off upgrade: it is not part of the automatic load path. It is DOM-free, so it runs in a Node script over stored records. Migrate legacy data first.",
        example: `import { restoreHeadingAnchors } from '@bloklabs/core/view';

const { data, report } = restoreHeadingAnchors(savedData);
// report.restored → [{ anchor: 'h.2y1ok8y7pef0', blockId: 'header-18' }, ...]
// report.skipped  → [{ anchor: 'h.other', reason: 'ambiguous' }]
await save(data);`,
      },
      {
        name: "defineBlokSchema(config)",
        returnType: "{ editorConfig, viewSchema }",
        description:
          "Resolve a tools/inlineToolbar/tunes config into one shared schema. It is pure and module-scope-safe: call it at module scope and import the result everywhere. Spread editorConfig into new Blok(...) and pass viewSchema to the view functions. This guarantees documents are displayed under the SAME sanitize composition that produced them, instead of two configs drifting apart. The guarantee is per composition: if you change the inline-tool set at runtime with tools.setInlineToolbar, recompose the schema from the current config. Options that don't participate in schema resolution (link, i18n, data, …) pass through editorConfig untouched.",
        example: `import { defineBlokSchema, blocksToHtml } from '@bloklabs/core/view';
import { Header, Paragraph } from '@bloklabs/core/tools';

const schema = defineBlokSchema({
  tools: { paragraph: Paragraph, header: Header },
});

const editor = new Blok({ holder: 'editor', ...schema.editorConfig });
const html = blocksToHtml(savedData, { schema: schema.viewSchema });`,
      },
      {
        name: "composeBaseSanitizeConfig(configs)",
        returnType: "SanitizerConfig",
        description:
          "Fold an ordered list of sanitize configs with the editor's exact merge semantics: a later-wins Object.assign, inline tools first, then tunes. Function rules are carried by reference. Rules for the same tag are REPLACED, never deep-merged. This is the same fold defineBlokSchema uses to build viewSchema.baseSanitize, exposed for hand-built lists. It is exported from both @bloklabs/core and @bloklabs/core/view.",
        example: `import { composeBaseSanitizeConfig } from '@bloklabs/core/view';

const baseSanitize = composeBaseSanitizeConfig([
  { b: {}, i: {} },
  { a: { href: true } },
]);
// → { b: {}, i: {}, a: { href: true } }`,
      },
      {
        name: "blocksToViewNodes(data, options?)",
        returnType: "ViewNode[]",
        description:
          "Render to a framework-agnostic JSON tree instead of an HTML string. Each node is { tag, attrs, children } or { text }, with the same options and sanitization pipeline as blocksToHtml. This is what the React bindings map to real elements. It is experimental: the shape is not frozen until a second framework adapter consumes it, so it may change in a minor release.",
        example: `import { blocksToViewNodes } from '@bloklabs/core/view';

const nodes = blocksToViewNodes(savedData);
// → [{ tag: 'p', attrs: {}, children: [{ text: 'Hello' }] }]`,
      },
      {
        name: "renderLatex(latex, options?)",
        returnType: "Promise<string>",
        description:
          "Render a LaTeX string to HTML with the KaTeX build Blok already bundles (its code tool, equation inline tool and markdown importer all use it). It is hardened for untrusted input: trust: false forbids the markup-injecting commands (\\href, \\includegraphics, \\html*), maxExpand caps macro expansion, maxSize caps element sizing, and throwOnError: false renders malformed math as escaped source instead of failing the document. Use it instead of adding katex as your own dependency, which is a second copy of the library and a second, unaudited option set. KaTeX is imported lazily on the first call. With no document present (SSR, workers) the stylesheet injection is skipped and you include katex.min.css yourself, and the markup is identical. For inlineRenderers use createLatexRenderer, which is synchronous.",
        example: `import { renderLatex } from '@bloklabs/core/view';

const html = await renderLatex('c = \\\\pm\\\\sqrt{a^2 + b^2}', { displayMode: false });`,
      },
      {
        name: "createLatexRenderer()",
        returnType: "Promise<(latex: string, options?: LatexRenderOptions) => string>",
        description:
          "Load KaTeX once and get back a synchronous LaTeX renderer. That is the form inlineRenderers needs, since it replaces an element with the string it returns, and a promise there stringifies as [object Promise]. It is shaped as \"await the loader, get the renderer\", so there is no call order to get wrong: the renderer cannot exist before KaTeX is ready. It uses the same hardened options as renderLatex. This is what lets a display surface render equations through blocksToHtml/BlokView instead of booting a read-only editor for them.",
        example: `import { blocksToHtml, createLatexRenderer } from '@bloklabs/core/view';

const renderLatexSync = await createLatexRenderer();

const html = blocksToHtml(savedData, {
  inlineRenderers: {
    span: ({ attrs }) => attrs['data-latex'] === undefined
      ? undefined
      : renderLatexSync(attrs['data-latex'], { displayMode: false }),
  },
});`,
      },
      {
        name: "BlokView",
        returnType: "ReactNode",
        description:
          "The React display component from @bloklabs/react. It renders a saved document inside a single <div> wrapper: no editor instance, no chrome, no async, no effects, and never dangerouslySetInnerHTML (content is mapped from the sanitized view tree to real React elements). The wrapper always carries data-blok-interface=\"view\", which is what makes the emitted classes compute as they do in the editor. It is written BEFORE the divProps spread, so a caller can override it. Never override it to \"blok\", which carries all: initial !important and would block host typography. This is the read-only path to reach for at display-only call sites, instead of <BlokEditor readOnly>: it costs no editor bundle, has no ready latch, and renders identically under SSR. Its props API is stable. Only the raw ViewNode tree it maps from (via blocksToViewNodes) stays experimental, and using BlokView never exposes you to it.",
        params: [
          {
            name: "data",
            type: "OutputData | LooseOutputData | null | undefined",
            required: true,
            description: "Saved document to display (nullish tolerated).",
          },
          {
            name: "schema",
            type: "BlokViewSchema",
            required: false,
            description: "viewSchema from defineBlokSchema, so the document displays under the composition that produced it.",
          },
          {
            name: "renderers",
            type: "Record<string, (data, ctx) => string>",
            required: false,
            description: "Custom per-tool renderers. They win over the built-ins.",
          },
          {
            name: "onUnknownBlock",
            type: "'skip' | 'comment'",
            required: false,
            default: "'skip'",
            description: "Unknown-tool policy ('comment' markers are dropped in the React tree).",
          },
          {
            name: "toolAttributes",
            type: "boolean",
            required: false,
            default: "false",
            description: "Stamp data-blok-tool on each block root (pairs with @bloklabs/core/view.css). Forwards to blocksToHtml.",
          },
          {
            name: "blockIds",
            type: "boolean",
            required: false,
            default: "false",
            description: "Stamp data-blok-id on each block root (list items on their <li>) for copy-link-to-block deep links.",
          },
          {
            name: "transformUrl",
            type: "(url, ctx) => string",
            required: false,
            description: "URL rewrite hook for block URLs and inline anchors, run before the unsafe-scheme strip. Forwards to blocksToHtml.",
          },
          {
            name: "inlineRenderers",
            type: "Record<string, (element) => string | undefined>",
            required: false,
            description: "Per-tag renderers for INLINE elements. Use them to render an equation's LaTeX with KaTeX on the server, or to turn a mention span into a chip. Forwards to blocksToHtml.",
          },
          {
            name: "classes",
            type: "boolean",
            required: false,
            default: "true",
            description: "Render with the editor's presentational classes and the per-block holder → content scaffolding, so the output matches a read-only editor render. It is on by default here, because this component owns a wrapper and its job is to look like the editor. It needs @bloklabs/core/view.css imported to paint. Pass classes={false} for unstyled semantic markup.",
          },
          {
            name: "...divProps",
            type: "HTMLAttributes<HTMLDivElement>",
            required: false,
            description: "Any standard <div> attribute (className, id, style, data-*, aria-*, event handlers, …) is forwarded onto the single wrapper element.",
          },
        ],
        example: `import { BlokView } from '@bloklabs/react';
import { schema } from './schema';
import '@bloklabs/core/view.css'; // opt-in block-spacing baseline

export function Article({ saved }: { saved: OutputData }) {
  return (
    <BlokView
      data={saved}
      schema={schema.viewSchema}
      toolAttributes
      blockIds
      id="article-body"
      className="prose"
    />
  );
}`,
      },
      {
        name: "useBlokView(data, options?)",
        returnType: "ReactNode",
        description:
          "The wrapper-free form of BlokView. It returns a Fragment of the block elements with no extra <div>, for slots where a wrapper is invalid or unwanted: checkbox labels, table cells, headings. It is synchronous and effect-free (SSR-safe), memoized on the data reference and the individual option values. It takes the same options as blocksToHtml, with two exceptions. root is ignored, since emitting no wrapper is the hook's contract. classes defaults to false here, while it defaults to true in <BlokView>, which owns a wrapper. Passing root: true type-checks and silently does nothing. When you need view.css to paint, wrap the returned Fragment yourself in an element carrying data-blok-interface=\"view\".",
        example: `import { useBlokView } from '@bloklabs/react';

function RowLabel({ saved }: { saved: OutputData }) {
  const content = useBlokView(saved, { schema: schema.viewSchema });
  return <label>{content}</label>;
}`,
      },
    ],
  },
  {
    id: "dev-override-seam",
    badge: "Security",
    title: "Dev override seam",
    description:
      "A development seam every published entry ships with: how it works, why it's safe, and how to remove it from your bundle.",
    lastUpdated: "2026-08-20",
    customType: "dev-override-seam",
  },
];

export interface SidebarSection {
  title: string;
  links: { id: string; label: string }[];
}

import { SIDEBAR_GROUPS, GROUP_TITLES_EN, MODULE_LABELS_EN } from './api-nav';

export const SIDEBAR_SECTIONS: SidebarSection[] = SIDEBAR_GROUPS.map((group) => ({
  title: GROUP_TITLES_EN[group.key],
  links: group.moduleIds.map((id) => ({ id, label: MODULE_LABELS_EN[id] })),
}));
