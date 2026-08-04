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
    message: string;
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
  customType?: "quick-start" | "tutorial" | "concepts" | "how-to-custom-tool";
  example?: string;
}

export const API_SECTIONS: ApiSection[] = [
  {
    id: "quick-start",
    badge: "Guide",
    title: "Quick Start",
    description: "Get up and running with Blok in just a few simple steps.",
    lastUpdated: "2026-06-30",
    customType: "quick-start",
  },
  {
    id: "tutorial",
    badge: "Tutorial",
    title: "Build your first editor",
    description:
      "Mount Blok, capture some content, and save it as JSON you can store and load back — the full round-trip in five steps.",
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
      "Build a block tool from scratch — a callout box that renders, edits, and saves like any built-in block.",
    lastUpdated: "2026-06-30",
    customType: "how-to-custom-tool",
  },
  {
    id: "core",
    badge: "Core",
    lastUpdated: "2026-06-30",
    title: "Blok Class",
    description:
      "The main editor class that initializes and manages the Blok editor instance. Every namespace a tool reaches through `api.*` is also reachable on the instance as `editor.*` — the properties below are that same surface, plus the `width`, `placeholder`, `tokens` and `i18n` namespaces the class declares itself.",
    methods: [
      {
        name: "save()",
        returnType: "Promise<OutputData>",
        description:
          "Extracts the current editor content as structured JSON data. This is the primary method for persisting editor content.",
        example: `// Save editor content
const data = await editor.save();
console.log(data.blocks); // Array of block data`,
        errors: [
          {
            condition: "The editor is in read-only mode when save() is called.",
            message: "Blok's content can not be saved in read-only mode",
            resolution: "Call `readOnly.set(false)` before saving, or persist from the last `onSave` payload / your own mirrored state.",
          },
        ],
      },
      {
        name: "render(data)",
        returnType: "Promise<void>",
        description:
          "Renders editor content from previously saved JSON data. Accepts the loose wire shape (`LooseOutputData`) — `null` values for block `data`, `id`, or `time` from backend DTOs are normalized at the boundary.",
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
          "Sets focus to the editor. Optionally positions cursor at the end of content.",
        example: `// Focus at start
editor.focus();

// Focus at end
editor.focus(true);`,
      },
      {
        name: "clear()",
        returnType: "Promise<void>",
        description:
          "Removes all content from the editor. One empty block of the default tool is left behind, so the editor is never block-less — a subsequent save() still returns `blocks: []`, because the blank default block does not validate and is dropped from the output.",
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
        name: "whenAllReady(options?)",
        returnType: "Promise<void>",
        description:
          "Static method — resolves once every Blok instance in scope has finished booting (each instance's `isReady` has settled; rejections count as settled). A collective-readiness signal for pages hosting several instances, replacing hand-aggregated per-instance `onReady` callbacks. Pass `within` (an Element) to count only instances mounted inside a subtree you own, so an unrelated editor elsewhere on the page cannot hold your gate closed. Pass `settleOn: 'rendered'` to extend readiness from construction to content-in-the-DOM, which also covers post-boot re-renders from `render(data)`. An empty scope resolves immediately. Instances that appear while the promise is pending extend the wait; instances constructed after it resolves are not covered — call again, or use `subscribeReady()` for a live signal.",
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
          "Static method — synchronous readiness snapshot for a scope: how many instances match `within`, how many are still pending at the requested `settleOn` depth, and whether the scope is settled. An empty scope reports `ready: true`, so no \"nothing to wait for\" special case is needed.",
        example: `const { pending, ready } = Blok.readyState({ within: listElement });

if (!ready) {
  showSkeleton(pending);
}`,
      },
      {
        name: "subscribeReady(listener)",
        returnType: "() => void",
        description:
          "Static method — subscribes to readiness changes across all instances (construction, boot, render-state flip, destroy) and returns an unsubscribe function. The listener takes no arguments: re-read `Blok.readyState(scope)` when it fires. Pairs with `useSyncExternalStore` and other store adapters, giving a live signal instead of a one-shot latch.",
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
          "Named export of the package root (not a member of the Blok class) — builds a CSS selector from a `DATA_ATTR` value. With no `value` it produces a presence selector; with one it produces an equality selector. Use it together with `Blok.DATA_ATTR` instead of matching Blok's internal class names, which are not part of the public surface.",
        example: `import { DATA_ATTR, createSelector } from '@bloklabs/core';

createSelector(DATA_ATTR.element); // '[data-blok-element]'
document.querySelectorAll(createSelector(DATA_ATTR.selected, true));`,
      },
      {
        name: "icons",
        returnType: "string",
        description:
          "Named exports of the `@bloklabs/core/icons` subpath (not members of the Blok class) — Blok's own glyphs as SVG strings, one `Icon*` constant per glyph (`IconBold`, `IconPlus`, `IconTrash`, `IconWarning`, …). Because they are plain strings they drop straight into the places a tool must supply markup: a tool's `static get toolbox()` icon and the entries returned by `renderSettings()`. The subpath ships a generated, self-contained declaration file (`types/icons.d.ts`) listing every constant, so editor autocomplete is the reference for the full set.",
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
          "Named export of the package root (`import { DATA_ATTR } from '@bloklabs/core'`), not a property of the editor instance — the stable `data-blok-*` attribute names Blok writes on its DOM. This is the supported way to query editor DOM and write host tests, instead of matching internal class names. The `DataAttrKey` / `DataAttrValue` types and the `createSelector()` helper are exported alongside it.",
      },
      {
        name: "version",
        type: "string",
        description:
          "Named export of the package root (`import { version } from '@bloklabs/core'`), not a property of the editor instance — the running editor version, the same value stamped into `OutputData.version`.",
      },
      {
        name: "PendingBlok",
        type: "{ isReady; isRendered; destroy(); theme; width; placeholder; tokens; i18n }",
        description:
          "A type exported from the package root (`import type { PendingBlok } from '@bloklabs/core'`), not a property of the editor instance — the surface guaranteed to exist synchronously between `new Blok(config)` and `isReady` resolving. Blok builds its module APIs (`blocks`, `caret`, `history`, `readOnly`, …) asynchronously, so reading them earlier returns `undefined`. `PendingBlok` declares only the eight members listed here, which turns that window into a compile error instead of an `undefined` at runtime: `const pending: PendingBlok = new Blok(config); const editor = await pending.isReady;`.",
      },
      {
        name: "isReady",
        type: "Promise<Blok>",
        description:
          "Promise that resolves with the ready editor instance. The API namespaces below (`blocks`, `caret`, `history`, `readOnly`, …) are built asynchronously and are `undefined` until it resolves — type the reference you hold during that window as `PendingBlok`.",
      },
      {
        name: "isRendered",
        type: "boolean",
        description:
          "Synchronous render-readiness flag — true once the current render batch has landed in the DOM (mirrors the `data-blok-rendered` wrapper attribute); false before the first render and while a re-render is in flight. Complements the async `isReady`/`onReady`: no await or callback needed, so mount state can be polled synchronously.",
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
        description: "Uploader API module — asset uploads routed by asset kind",
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
        description: "Marks API module — range-aware inline-mark operations",
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
          "I18n API module — everything a tool gets through `api.i18n`, widened with `update()`",
      },
      {
        name: "config",
        type: "Readonly<Pick<BlokConfig, 'linkPaste' | 'link'>>",
        description:
          "Read-only view of selected editor configuration: the `link` and `linkPaste` options this instance was constructed with. A custom inline or link tool reads the host's link policy from here (as `api.config`) instead of re-deriving it.",
      },
      {
        name: "rectangleSelection",
        type: "{ cancelActiveSelection(): void; isRectActivated(): boolean; clearSelection(): void; startSelection(pageX: number, pageY: number, shiftKey?: boolean): void; endSelection(): void }",
        description:
          "Drag-select (rubber-band) control, also reachable inside a tool as `api.rectangleSelection`. `startSelection(pageX, pageY, shiftKey?)` begins a rubber-band from page coordinates; `endSelection()` resets the drag state and hides the overlay; `isRectActivated()` reports whether a rubber-band is currently active; `clearSelection()` drops the active flag; `cancelActiveSelection()` aborts a selection in progress (clear + end) — what another selection system, e.g. table cell selection, calls when it takes priority.",
      },
    ],
  },
  {
    id: "config",
    title: "Configuration",
    description:
      "The configuration object passed to the Blok constructor. It is formally split into two types: `BlokMountOptions` — options fixed for the instance's life (holder, tools, i18n, callbacks, …) — and `BlokState`, the LIVE fields: `readOnly` (including `hideControls`), `hideToolbar`, and `inlineToolbar`. Every `BlokState` field maps to a documented runtime setter (`readOnly.set`, `toolbar.setHidden`, `tools.setInlineToolbar`), so changing it never requires recreating the editor — and the React, Vue and Angular adapters react to these props/inputs in place. `BlokConfig = BlokMountOptions & BlokState`, so existing code compiles unchanged.",
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
          "Available block and inline tools. Nothing is registered by default: the `{}` default leaves only Blok's internal tools (`stub`, `delete`, `copyLink`, `convertTo`), so a bare `new Blok({ holder })` cannot render even a paragraph. Two ready-made bundles are exported from `@bloklabs/core/full` — `defaultTools` (paragraph, header and list, all with `inlineToolbar: true`) and `allTools` (`defaultTools` plus quote, callout, code, toggle and every inline tool). Per-tool `toolbox: false` keeps a tool registered (existing blocks still render, blocks.insert() still works) while removing it from every user-insertion path — the + / slash menu, the convert menu, and its keyboard shortcut. Useful for permission gating — and flippable at runtime via `tools.update(name, { toolbox })` (the React adapter applies changes to the `tools` prop's `toolbox` values automatically), so a permission change never requires recreating the editor.",
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
          "Placeholder text handed to every block of the default tool — not only the first block, and not only while the document is empty. With the built-in paragraph it is visible whenever a block is empty and focused. Note that `false` (also the default) does not remove the placeholder: the paragraph tool then falls back to its own built-in localized text (\"Write something or press / to select a tool\"). To blank it, give the default tool an empty placeholder of its own — `tools: { paragraph: { class: Paragraph, placeholder: '' } }`.",
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
          "Opt-in: clicks on the host page below the editor append a block, with zero layout footprint. Pair with `minHeight: 0` to remove the bottom zone entirely. Only clicks landing on the empty background of an element that contains the editor count — clicks on your own content rendered below are ignored, and propagation is never stopped, so host click handlers keep working alongside.",
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
          "Initial data to render. The loose wire shape is accepted: `null` values for block `data`, `id`, or `time` (common in backend DTOs) are normalized at the boundary. A whole-document `null` is also accepted and normalized to an empty document, so nullable controlled state can be passed straight through without a `value ?? { blocks: [] }` guard.",
      },
      {
        option: "dataModel",
        type: "'legacy' | 'hierarchical' | 'auto'",
        default: "'auto'",
        description:
          "Input/output data model. 'auto' detects the format of the data you render and preserves it on save; 'legacy' always uses the nested `items[]` structure; 'hierarchical' always uses flat blocks with `parent`/`content` references.",
      },
      {
        option: "sanitizer",
        type: "SanitizerConfig",
        default: "{}",
        description:
          "Editor-wide default sanitizer allowlist. Composed with each tool's own `sanitize` rules and applied on save, on render, on paste and on copy of selected blocks.",
      },
      {
        option: "readOnly",
        type: "boolean | { hideControls?: boolean }",
        default: "false",
        description:
          "Enable read-only mode. Pass `{ hideControls: true }` to also hide the hover toolbar, block settings, and inline toolbar. Live: change at runtime via `readOnly.set(state, { hideControls })` — the same instance flips modes in place, preserving caret, undo history and scroll.",
      },
      {
        option: "onChange",
        type: "(api: API, event: BlockMutationEvent | BlockMutationEvent[]) => void",
        default: "undefined",
        description:
          "Change callback function; the event argument carries the mutation(s) that occurred (batched into an array when several fire at once)",
      },
      {
        option: "onSave",
        type: "(data: OutputData, api: API) => void",
        default: "undefined",
        description:
          "Reactive save callback — fires automatically with the full serialized content on every debounced content change, so you don't have to call save() by hand.",
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
          "Fires when Enter is pressed in a block, before Blok splits it or creates a new one. Return true to mark it handled — Blok suppresses its default block split/create (the native newline is still prevented). Never fires for tools with enableLineBreaks or while a popover/toolbar owns Enter, and not for a soft-line-break Shift+Enter — except on iOS, where Safari reports Shift+Enter for a sentence-ending '. ' and Blok creates a block, so the hook fires there too. Ideal for chat inputs (\"Enter sends\") — pair with the paragraph tool's preserveBlank config instead of subclassing Paragraph.",
      },
      {
        option: "onSubmit",
        type: "(data: OutputData, api: API) => void",
        default: "undefined",
        description:
          "Fires with the full serialized OutputData on the Enter that would otherwise create or split a block — the \"Enter sends\" gesture. Blok serializes the document and suppresses the default split, so you don't wire save() into onEnter by hand. It inherits every onEnter escape; when both are set, an onEnter that returns true takes precedence and suppresses onSubmit.",
      },
      {
        option: "onError",
        type: "(error: Error, context: { source: 'save' }) => void",
        default: "undefined",
        description:
          "Fires when an editor operation fails that Blok would otherwise only log; today the sole source is serialization. Both the debounced auto-save and an explicit save() route through it. A failed save() rejects with the underlying error — it never resolves with undefined — so wrap explicit saves in try/catch; onError additionally surfaces failures of the debounced auto-save, which has no promise of its own.",
      },
      {
        option: "onBeforePaste",
        type: "(html: string) => string | null",
        default: "undefined",
        description:
          "Transforms the raw `text/html` clipboard payload before any Blok preprocessing or sanitization, so a capture-phase paste interceptor is no longer needed. Return the HTML to feed into the rest of the paste pipeline, or null to skip the HTML path and fall through to plain text.",
      },
      {
        option: "onBeforeRender",
        type: "(blocks: OutputBlockData[]) => OutputBlockData[]",
        default: "undefined",
        description:
          "Transforms the blocks array just before it is rendered — on the initial render, on every `blocks.render()` call, and on the repaints Blok performs itself (a runtime `i18n.update()`, and the read-only fallback re-render). Receives the raw saved blocks (before format analysis or hierarchical expansion) and returns the blocks to render, so app-specific data migrations run inside Blok instead of ahead of it. It must therefore be idempotent: those repaints feed it blocks it has already transformed.",
      },
      {
        option: "onAfterRender",
        type: "(api: API) => void",
        default: "undefined",
        description:
          "Fires after each render batch lands in the DOM: the initial render, every `blocks.render()`, and the repaints Blok performs itself — a runtime `i18n.update()` locale/messages change, and a `readOnly.set()` toggle that falls back to a full re-render because a mounted tool does not support in-place read-only. Use it for post-render side effects (scroll restoration, attaching observers), keeping in mind those extra triggers if you count renders. Distinct from onReady, which fires once when the editor first becomes ready.",
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
          "Blok always smooth-scrolls to the block whose id matches the page URL hash (`#<blockId>`) once blocks are rendered — including blocks rendered later via `blocks.render()`. This option only tunes that behavior: `topOffset` (default 0) reserves space above the block for a sticky header.",
      },
      {
        option: "inlineToolbar",
        type: "string[] | boolean",
        default: "true",
        description:
          "Default inline toolbar for all tools; an array restricts it to the listed inline tools, false disables it. Live: reconfigure at runtime via `tools.setInlineToolbar(config)`.",
      },
      {
        option: "hideToolbar",
        type: "boolean",
        default: "false",
        description:
          "Hide the hover block toolbar (plus button / drag handle) and collapse the editor gutter reserved for it; the keyboard \"/\" menu keeps working. Live: flip at runtime via `toolbar.setHidden(hidden)`.",
      },
      {
        option: "i18n",
        type: "I18nConfig",
        default: "undefined",
        description:
          "Internationalization config (locale + message dictionary). Live: switch language at runtime via `i18n.update({ locale, messages })` \u2014 the editor relabels in place, so caret and undo history survive a language switch (`defaultLocale` is the exception and stays mount-only). Custom tool titles are localizable by registration name — e.g. a `fileLink` tool via `messages: { 'toolNames.fileLink': '…' }` — or via a `titleKey` in the tool's toolbox entry.",
      },
      {
        option: "uploader",
        type: "BlokUploader",
        default: "undefined",
        description:
          "Editor-level uploader for every media asset, routed by asset KIND rather than by tool. `uploadByFile(file, { kind, tool })` and `uploadByUrl(url, { kind, tool })` receive `kind: 'image' | 'video' | 'audio' | 'file'`, so one implementation serves the image, video, audio and file blocks \u2014 including assets a tool owns outside its own media family, such as the audio block's cover art (`kind: 'image'`, `tool: 'audio'`), which has no tool-level uploader of its own. A tool-level uploader (`tools.image.config.uploader`) stays authoritative for its own kind and takes precedence; this is the fallback. Without either, assets become `blob:` URLs that do not survive a reload.",
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
          "Fires with the RESOLVED theme ('light' or 'dark') whenever it changes — both when the OS preference flips while `theme` is 'auto', and when `theme.set()` changes what the theme resolves to. It does not fire on initialization, and it does not fire when a `theme.set()` leaves the resolved theme unchanged. A core config option, not an adapter-only prop; the framework adapters expose the same callback as the `onThemeChange` prop / `theme-change` emit / `themeChange` output.",
      },
      {
        option: "link",
        type: "{ target?: string; rel?: string; transformHref?: (href: string) => string; transform?: (context: LinkTransformContext) => LinkTransformResult | void }",
        default: "undefined",
        description:
          "Controls the anchors Blok creates, instead of post-processing the rendered DOM. Applies on every path that produces an `<a>`: the Link inline tool, `blocks.render()` (anchors coming from stored block HTML) and paste. `target` defaults to '_blank' and `rel` to 'nofollow'. `transform` is the superset and supersedes `transformHref` (which is then ignored) — it receives the href, text and element and may return `href`, `target`, `rel` and extra `attributes`; omitted fields fall back to the shorthand defaults, including the same-page `_self` rule. Both must be idempotent: on the render and paste paths they re-run against already-transformed anchors on every render.",
      },
      {
        option: "linkPaste",
        type: "{ allowGenericEmbed?: boolean; allowedEmbedOrigins?: string[] }",
        default: "undefined",
        description:
          "Notion-style link-paste behavior. Set `allowGenericEmbed: true` to also offer \"Create embed\" (framed in a sandboxed iframe) for URLs that match no registered embed provider; the default keeps Blok's registry-only embed guarantee. `allowedEmbedOrigins` is the fine-grained middle ground: hostnames (`dashboards.example.com`) or wildcard subdomain patterns (`*.internal.example.dev`) that may be framed as generic embeds. A stored generic embed matching neither renders as a safe clickable link card instead of an iframe, so the URL stays visible without being framed.",
      },
      {
        option: "user",
        type: "{ id: string }",
        default: "undefined",
        description:
          "Identity of the current editor. Blok stamps `user.id` onto the `lastEditedBy` of every block this user edits — without it `lastEditedBy` stays null. Pair it with `resolveUser` to render a name in the block settings footer.",
      },
      {
        option: "resolveUser",
        type: "(id: string) => UserInfo | Promise<UserInfo | null> | null",
        default: "undefined",
        description:
          "Resolves the `lastEditedBy` user id Blok shows in the block settings footer. May return synchronously or asynchronously; return null for an unknown user and Blok falls back to showing the date only.",
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
          "Replaces the built-in toast entirely — Blok calls your handler with the same options object instead of rendering its own DOM notification.",
      },
      {
        option: "logLevel",
        type: "LogLevels",
        default: "LogLevels.VERBOSE",
        description:
          "How much Blok logs to the console. Values are `VERBOSE`, `INFO`, `WARN` and `ERROR` — there is no \"silent\" level, so `LogLevels.ERROR` is the quietest. `LogLevels` is a named export of the package root.",
      },
    ],
  },
  {
    id: "blocks-api",
    badge: "Blocks",
    title: "Blocks API",
    description:
      "Manage blocks in the editor — create, delete, update, and reorder content.",
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
          "Render passed JSON data as blocks, replacing the current document. Echo-safe: when the incoming document is structurally equal to the current saved content (`time`/`version` ignored), the call is a caret-preserving no-op — the `data → render → onSave → setState → data` round-trip needs no consumer-side dedupe. Accepts the loose wire shape (`LooseOutputData`); the editor deep-clones the data, so the passed object is never mutated or retained — frozen store state (Redux, Immer) can be passed directly.",
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
          "Convert a Markdown string to blocks and render them, REPLACING the current document — it calls `blocks.render()` internally. The converter is lazy-loaded on first call, and the resolved OutputData is the document that was rendered. `options` is a `MarkdownImportConfig` (tool mapping, GFM toggle, micromark/mdast extensions). For additive insertion, use `markdownToBlocks()` from the standalone `@bloklabs/core/markdown` subpath together with `blocks.insertMany()`.",
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
          "Serialize the current document to Markdown — the outbound twin of `importMarkdown`. Blocks are read through the Saver, so the output reflects the saved (validated) document rather than raw DOM, and the promise resolves to '' when there is nothing to save. Blocks owned by a table cell are serialized inside the pipe table instead of being repeated as loose lines. What Markdown cannot express is degraded: table `colspan`/`rowspan` and heading columns are dropped, and a table with no heading row gets an empty header row, since GFM requires one.",
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
              "Whether to move the caret to the surviving block after deletion; pass false to avoid stealing the user's caret during programmatic deletion.",
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
          "Scroll a block into view, select it, pulse the arrival highlight and announce the navigation to assistive tech — the public counterpart of the boot-time URL-hash scroll. No-op when no block with that id is in the document. Framework adapters that mount into a detached holder (React/Vue/Angular) render seeded content before it joins the page, so the boot hash scroll defers; @bloklabs/react drains it automatically once the holder connects — call this yourself for deep-linking after the editor is ready.",
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
          "Reparent a block: updates the block's `parentId` and the parent's `contentIds` through core's single reparent chokepoint. Pass `null` to move the block back to the root level. An unknown `blockId` is a no-op that logs a warning; a `parentId` that would make the block a descendant of itself throws.",
        example: `// Move a block into a container block
editor.blocks.setBlockParent('child-block-id', 'parent-block-id');

// Move it back to the root level
editor.blocks.setBlockParent('child-block-id', null);`,
      },
      {
        name: "blocks.insertInsideParent(parentId, insertIndex, childData?)",
        returnType: "BlockAPI",
        description:
          "Insert a block as a child of `parentId` atomically: the creation and the parent assignment are grouped into ONE undo entry, so a single Cmd+Z removes it completely (preferable to `insert()` followed by a reparent, which is two). `insertIndex` is the FLAT document index where the child should appear; `childData` defaults to an empty paragraph.",
        example: `const parentIndex = editor.blocks.getBlockIndex('parent-block-id') ?? 0;
const child = editor.blocks.insertInsideParent(
  'parent-block-id',
  parentIndex + 1,
  { text: 'Nested content' },
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
        name: "blocks.insert(type?, data?, config?, index?, needToFocus?, replace?, id?, tunes?)",
        returnType: "BlockAPI",
        description:
          "Insert a new block with full control over its properties and position.",
        example: `// Insert after the current block with the default type
const block = editor.blocks.insert();
// → BlockAPI { id: 'kP3xQ...', name: 'paragraph', ... }

// Insert paragraph with data at index 0
const block = editor.blocks.insert('paragraph', { text: 'Hello' }, undefined, 0);

// Insert with custom ID
const block = editor.blocks.insert('header', { text: 'Title' }, undefined, undefined, undefined, undefined, 'custom-id');`,
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
              "Ignored — accepted only to keep the positional signature stable. The editor binds it to `_config` and never reads it, and the block-manager insert options carry no `config` field, so the created block still uses the editor-level tool config from `config.tools`. Pass `undefined`.",
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
              "The blocks to insert. Loose wire blocks are accepted — a `null` `data` becomes `{}`, a `null`/empty `id` gets a generated one.",
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
        description: "Update a block's data and/or tunes.",
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
          "Re-arm mutation watching on a block previously silenced by `stopBlockMutationWatching`. It takes an **id**, not an index, because inserts and replacements between the two calls shift indexes; an id that no longer exists is silently skipped — a block replaced in place was constructed with its own watcher.",
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
          "Group every block operation performed inside `fn` into a single undo entry. `fn` must be SYNCHRONOUS — operations that land after an await are no longer part of the group. Use it so structural edits are not partially undoable.",
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
          "Open an undo group that stays open across async boundaries. Every block operation until `endTransaction()` lands in one undo entry. Use it for pointer gestures that mutate the document continuously (dragging a table's corner to add rows), where `transact()` cannot help because it only wraps a synchronous function. Every call must be paired with `endTransaction()`.",
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
          "Tell core that a pointer drag interaction started or ended. While it is active, DOM-mutation-triggered Yjs syncs are suppressed so browser DOM churn during the drag cannot corrupt Yjs state.",
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
          "Readonly getter — true while a Yjs sync operation (undo/redo) is in progress. Tools read it to skip cleanup that would fight undo state. Note this is a PROPERTY on `editor.blocks`, unlike the React hook's `isSyncingFromYjs()` method.",
      },
      {
        name: "isPointerDragActive",
        type: "boolean",
        description:
          "Readonly getter — true while a pointer drag interaction is active. Framework adapters read it to defer a programmatic `dispatchChange` mid-drag (core silently drops such a change) and re-dispatch it once the drag ends.",
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
          "This block's direct children as BlockAPI objects, in order. Returns an empty array when the block has no editor API attached (a virtual block).",
        example: `const block = editor.blocks.getById('toggle-123');
block?.getChildren().forEach((child) => console.log(child.id));`,
      },
      {
        name: "block.setParent(parentId)",
        returnType: "void",
        description:
          "Reparent this block under `parentId`, or back to the root level with `null`. Routes through core's universal `setBlockParent` chokepoint, so the parent's `contentIds` is updated together with this block's `parentId`.",
        example: `const block = editor.blocks.getById('block-123');
block?.setParent('parent-block-id');

// Back to the root level
block?.setParent(null);`,
      },
      {
        name: "block.insertChild(childData?, position?)",
        returnType: "BlockAPI | null",
        description:
          "Insert a child block under THIS block atomically — creation and parent assignment land in a single undo entry (it delegates to `blocks.insertInsideParent`). `position` is a `BlockChildPosition`: 'start' | 'end' | { before: childId } | { after: childId }, defaulting to 'end' (appended past the whole subtree). `childData` defaults to an empty paragraph. Returns null when the block has no editor API attached (a virtual block).",
        example: `const block = editor.blocks.getById('toggle-123');
const child = block?.insertChild({ text: 'Hidden content' });

// Place it among the existing children instead of appending
block?.insertChild({ text: 'First' }, 'start');
block?.insertChild({ text: 'After that one' }, { after: 'child-id' });`,
        params: [
          {
            name: "childData",
            type: "BlockToolData",
            required: false,
            default: "empty paragraph",
            description: "Data for the new child block.",
          },
          {
            name: "position",
            type: "BlockChildPosition",
            required: false,
            default: "'end'",
            description:
              "Where among the existing children to insert: 'start', 'end', { before: childId } or { after: childId }.",
          },
        ],
      },
      {
        name: "block.moveChild(childId, delta)",
        returnType: "void",
        description:
          "Move a direct child by `delta` positions among its siblings, clamped to the valid range. A child carrying its own subtree lands past the target sibling's descendants, not inside them. No-op when `delta` is 0, when `childId` is not a direct child, or when the clamped move would not change the position.",
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
        description: "True if block is selected with Cross-Block selection",
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
          "Ids of this block's direct children, in order — a read-only copy, so mutating it changes nothing. The block-level counterpart of parentId: it lets a container tool read its children without reaching for the editor API",
      },
      {
        name: "preservedData",
        type: "BlockToolData",
        description:
          "Last successfully extracted block tool data, synchronous — useful when async save() is not feasible, e.g. clipboard operations",
      },
      {
        name: "preservedTunes",
        type: "{ [name: string]: BlockTuneData }",
        description:
          "Last successfully extracted block tune data, synchronous — useful when async save() is not feasible, e.g. clipboard operations",
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
            description: "Absolute character offset from the start of the block's current input. Applied only when `position` is `'default'` — `'start'` and `'end'` place the caret at the boundary and ignore it.",
          },
        ],
        errors: [
          {
            condition: "blockOrIdOrIndex is a valid id or index that does not resolve to an existing block (unknown id or out-of-range index).",
            message: "(no error thrown — the call returns false)",
            resolution: "For id/index inputs, check the boolean return value — a falsy result is the only signal the target wasn't found. Passing a null BlockAPI (e.g. an unchecked getById() result) is invalid input and throws, so null-check before calling.",
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
          'Update the "after" position of the most recent caret undo entry. Use after async caret movements.',
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
          "Emit a custom event. Fire-and-forget over the listeners registered at that moment — there is no replay, so a handler subscribed after the emit never sees it.",
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
    description: "Control undo/redo functionality for editor operations.",
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
          "Alias for the main save() method. **Rejects while read-only mode is enabled** — it warns and throws `Error(\"Blok's content can not be saved in read-only mode\")` before reaching the Saver. Guard the call with `editor.readOnly.isEnabled`, or call `await editor.readOnly.set(false)` first.",
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
            message:
              "Blok's content can not be saved because collecting data failed — or the originating tool error, re-thrown when one was recorded",
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
          "Clear all fake background state - both DOM elements and internal flags.",
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
      "Range-aware inline-mark operations for building inline formatting tools. Where selection.findParentTag only inspects the selection's two boundary nodes (anchor and focus) and their ancestors, api.marks operates on the WHOLE range: has answers \"is every text node in the selection covered\", apply and remove split partially-covered wrappers at the range boundaries, update fully-covering wrappers in place, and restore the selection afterwards — and apply and remove extend the range over trailing whitespace browsers exclude from double-click selections. A mark is described declaratively by a MarkSpec (tag, aliasTags, className, attributes, style); aliasTags lets legacy tag variants (e.g. <b> next to <strong>, <em> next to <i>) match as the SAME mark while new wrappers always use the canonical tag. String values are static and participate in the mark's identity; function-form values are resolved from the state passed to apply/toggle and are deliberately EXCLUDED from identity — that is what makes a colour picker ONE mark updating in place rather than N mutually-cancelling marks. Two specs sharing tag, classNames and static attributes belong to the same family and compose on a single element — e.g. a text-colour spec and a background-colour spec both on one <mark>. Every method defaults to the live selection's first range when no range is passed. The core export markSanitizerConfig(spec) derives the sanitizer rule a mark produces — allowlist the spec's tag, strip style properties and classes the spec does not declare, keep declared attributes, with function-form values handled by property name so dynamic values are never dropped on save. The React adapter's createReactInlineTool applies the same derivation automatically when a tool declares a mark spec.",
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
          "Whether every text node in the range is inside a wrapper matching the spec — whitespace-only text nodes are ignored, and at a collapsed caret the caret's ancestors are checked. Unlike selection.findParentTag (which only checks the selection's boundary nodes and their ancestors), a selection that only partially carries the mark reports false.",
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
            description: "Range to check; defaults to the live selection's first range.",
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
          "Nearest ancestor element matching the spec, starting from the given node (or the current selection's start container). Matching respects the full spec — tag, classNames, and static attribute/style values — not just the tag name.",
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
            description: "Node to start the upward search from; defaults to the current selection's start container.",
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
          "Read the current values of the spec's declared properties from the wrapper at the range start. Returns null when the range is not inside a matching wrapper. The snapshot carries the matched element plus its declared style properties and attributes — unset and transparent-valued style properties are omitted.",
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
            description: "Range to read from; defaults to the live selection's first range.",
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
          "Wrap the range in the mark, or update matching wrappers in place. Splits partially-covered same-family wrappers at the range boundaries, extends the range over trailing whitespace browsers exclude from double-click selections, and leaves the new contents selected. Returns the created or updated wrapper elements. A collapsed range (a bare caret with nothing selected) is a no-op — apply returns an empty array without touching the DOM or the selection.",
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
            description: "Range to format; defaults to the live selection's first range.",
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
          "Remove the spec's declared properties and classes from wrappers in the range, unwrapping wrappers left bare. For a non-collapsed range, partially-covered wrappers are split so text outside the range keeps its formatting. A collapsed caret instead targets its enclosing wrapper whole — no split occurs and the spec's properties are stripped from the entire wrapper. The selection is restored either way. Returns the wrappers that survived because they still carry other properties.",
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
            description: "Range to deformat; defaults to the live selection's first range.",
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
          "remove when the range already carries the mark, apply otherwise. Returns the resulting state: true when the mark is now applied. At a collapsed caret with no existing mark this returns true without applying anything — apply is a no-op on a collapsed range. Call toggle on a non-collapsed range, or treat the return value as the intended state rather than a confirmation.",
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
            description: "Range to toggle; defaults to the live selection's first range.",
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
      "Access CSS class names for styling custom tools and UI elements, and customize the editor's layout and chrome via public CSS custom properties. The primary way to override theme tokens is `style.tokens` in the Blok constructor config — pass `--blok-*` keys and values and Blok injects a per-instance stylesheet that reaches the editor AND UI portaled to `document.body` (popovers, tooltips, top-layer elements) automatically; invalid keys are skipped with a warning, and the stylesheet is removed on destroy. Injected `style.tokens` values are static per application — they apply identically in light and dark themes and across read-only state, so state-dependent tokens like the editor gutter belong in CSS instead; `style.tokens` ignores `--blok-editor-gutter-*` keys with a warning. They are not, however, frozen at construction: `editor.tokens.set(tokens)` rewrites the injected stylesheet at runtime, which is what a host light/dark toggle needs — without it, flipping a token meant recreating the editor or hand-writing a global stylesheet targeting the portal scopes yourself. `set()` takes the complete token set (replace, not merge), mirroring `style.tokens`, so tokens omitted from the new palette stop applying and `{}` removes the stylesheet; `editor.tokens.get()` returns what is currently applied. The API is available synchronously after construction (calls before `isReady` are buffered and replayed), and the React/Vue/Angular adapters drive it reactively — pass `style={{ tokens }}` (React/Vue) or `[styleTokens]` (Angular) and changes sync in place without recreating the editor. As a CSS-only alternative, Blok's own palette is declared at zero specificity via `:where()`, so a single plain selector like `[data-blok-interface] { --blok-popover-bg: … }` wins regardless of stylesheet order — but since popovers portal to `document.body`, that global stylesheet must also target `[data-blok-popover], [data-blok-top-layer]` to reach them. `--blok-content-max-width` stays authoritative in both width modes — `width='full'` only swaps its fallback to `none`. Blok reserves 56px of gutter automatically in edit mode for the floating +/⠿ block controls, and the wrapper carries `data-blok-readonly` while read-only is active. Plain read-only KEEPS the gutter — the block-hover copy-link control lives there, and `readOnly.set()` flips modes in place, so collapsing it would shift the document sideways on every toggle. The gutter collapses to 0 automatically only when it is genuinely dead space: chromeless read-only (`readOnly: { hideControls: true }`, wrapper carries `data-blok-controls-hidden`) and `hideToolbar: true` in the constructor config — the hover toolbar never opens and the wrapper carries `data-blok-toolbar-hidden`, so no gutter space is reserved. `--blok-editor-gutter-start` is an override hook, not a required incantation — set it to any value (including `0px` to remove the gutter) to change the default. The gutter override contract is guaranteed, not incidental: Blok declares the gutter default and both state collapses at zero specificity via `:where()` (enforced by a unit contract test), so a host declaration of the gutter tokens at any positive specificity always wins the cascade. Declare them on the wrapper element itself (e.g. `[data-blok-interface] { --blok-editor-gutter-start: 16px }`), not only on an ancestor — the controls-hidden and toolbar-hidden collapses re-declare the tokens on the wrapper, and custom properties resolve from the nearest declaration, so an ancestor-level value loses to the collapse while a wrapper-level one survives it. The content column's horizontal position is also configurable at the API level via `style.contentAlign?: 'left' | 'center' | 'right'` (default `'left'`) in the Blok constructor config. Blok also repaints native text selection inside the editor with `--blok-selection-inline` — override that token to recolor it, or pass `style.nativeSelection: true` (default `false`) to opt out entirely and fall back to the browser/host-defined selection colors (a token override cannot express CSS-wide keywords like `revert`, so reverting needs this flag). With the flag on, the wrapper carries `data-blok-native-selection`, Blok's `::selection` rules skip the editor, and the fake-background highlight (shown while a menu input holds focus) follows the UA `Highlight` color; popovers keep Blok's selection color. Background surfaces are public tokens too: most hover/light UI surfaces follow `--blok-bg-light`, media empty-state cards use `--blok-bg-secondary` (bordered by `--blok-border-secondary`), and the image/file loading skeletons and upload placeholders use `--blok-bg-tertiary`, which defaults to `--blok-bg-light` so it tracks the theme — recoloring the skeleton surface means overriding `--blok-bg-tertiary` directly, not overloading `--blok-bg-light` and dragging every other surface along with it. Like all palette-backed color tokens, the surface tokens are re-declared by Blok on the editor wrapper at zero specificity, so apply overrides via `style.tokens` / `editor.tokens.set()` or a CSS selector matching the wrapper (`[data-blok-interface]`) itself — a custom-property declaration on an ancestor container is shadowed by the wrapper's own declaration and silently does nothing (layout hooks such as `--blok-content-max-width` and the list, heading, embed, block-padding and placeholder-color tokens are instead read with fallbacks and never declared by Blok, which is why those DO inherit from any ancestor; the gutter tokens and `--blok-search-input-placeholder` are wrapper-declared like the palette, so they too need a wrapper-level rule). Also note the injected token stylesheets target Blok's scope attributes globally: with several editor instances on one page, each instance's `style.tokens` / `tokens.set()` stylesheet applies to ALL Blok UI on the page, not just its own instance (each is removed when its own instance is destroyed; where sets conflict between instances the stylesheet order in `<head>` — not application recency — decides, so give every instance one shared set instead of relying on conflict order) — scope per-instance differences with a CSS rule on each editor's own wrapper instead (body-mounted popover UI always follows the page-wide sheets). The sheets are injected at the start of `<head>`, so a host stylesheet rule of equal specificity — a plain `[data-blok-interface] { … }` — still beats `style.tokens` for the tokens it declares. Block rhythm is public too: `--blok-block-padding-top`, `--blok-block-padding-bottom` and `--blok-block-padding-inline` drive the padding of every block tool wrapper (paragraph, heading, list, toggle, quote). Each tool keeps its historical value as the fallback — 7px/7px/2px for most blocks, 0.2em vertical for quotes — so one override retunes all blocks at once, which is exactly what a read-only host needs for tight inline-style rendering (previously only possible by overriding `[data-blok-tool]` internals). The callout panel is the deliberate exception: its card inset is `--blok-callout-padding-block` (default 5px), NOT the rhythm tokens, so tightening rhythm cannot collapse the callout card onto its text — while the emoji stays on the first text line because its button follows `--blok-block-padding-top` together with the child text. Note that non-default padding slightly shifts derived geometry such as the toggle-heading arrow offset, which follows `--blok-block-padding-top`. Text size is public per block AND per scenario through `style.fontSize` — the supported alternative to targeting Blok's internal class names. Every key writes one public token: `fontSize.paragraph` → `--blok-paragraph-font-size`, `fontSize.heading[1]` → `--blok-heading-1-font-size` (headings reuse the pre-existing heading tokens rather than minting parallel ones), `fontSize.list.checklist` → `--blok-checklist-font-size`, and likewise for both quote variants, callout, code, toggle, the two table densities (`compact` / `comfortable`), every media caption (image, video, audio, file, embed) and the three bookmark parts (title, description, link). Omitted keys keep Blok's built-in size, so an editor renders exactly as before everywhere it does not opt in. Per-tool size settings still outrank it: a paragraph tool configured with `styles.size`, or a list with `itemSize`, writes that size as an inline style on the block, which no token can override — so scenarios you want to drive from `style.fontSize` must not also carry a per-tool size. Values may be absolute or relative (`px`, `rem`, `em`, `%`): every ornament sitting beside sized text — list bullet, checkbox, callout emoji, toggle arrow — derives its own metrics from the same token, so it stays optically aligned at any scale with no extra CSS. Because these tokens are read with fallbacks and never declared by Blok on its own, an editor that does NOT configure `style.fontSize` also accepts them from a plain CSS rule on any ancestor or from `style.tokens` / `editor.tokens.set()` — but the channels are not interchangeable, and `style.fontSize` is the strongest of the three: configuring a scenario injects a stylesheet that lands later in `<head>` than the theme-token sheet at equal specificity, so a subsequent `editor.tokens.set({ '--blok-paragraph-font-size': … })` (or an ancestor CSS rule) for that same scenario silently loses to it. So if a size must change after mount — a density, zoom or accessibility toggle — drive it through `style.tokens` / `editor.tokens.set()` and leave that scenario out of `style.fontSize` entirely; `style.fontSize` itself is read once at construction and is not reactive. Like `style.tokens`, the injected sheet is page-global rather than per-instance: it retypes every Blok editor on the page, including instances constructed with no `style.fontSize` of their own, so per-instance differences belong in a CSS rule on each editor's own wrapper. One nesting rule is worth knowing: a callout renders its body text as a child paragraph block, so callout text follows `fontSize.callout` and falls back to `fontSize.paragraph` when that key is unset — setting only `paragraph` resizes callout bodies along with body text, and making the two differ means setting `fontSize.callout` explicitly. Finally, the view renderer (`@bloklabs/core/view`) emits semantic HTML and its stylesheet carries only the class-based scenarios: paragraph, headings, list, checklist, both quote sizes, callout, code and toggle respond in view output, while the caption, table-cell and bookmark sizes are editor-only.",
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
              "Placement overrides. `placeLeftOfAnchor` is already `true` when you pass a trigger element — set it to `false` to open the popover to the right of the trigger instead.",
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
          "Runtime setter for `config.hideToolbar`: hide or show the hover toolbar (plus button / drag handle) AND collapse or restore the editor gutter reserved for it — the wrapper's `data-blok-toolbar-hidden` attribute is kept in sync, so no dead space is left behind. The keyboard \"/\" menu keeps working while hidden.",
        params: [
          {
            name: "hidden",
            type: "boolean",
            required: true,
            description: "true to hide the hover toolbar and collapse the gutter; false to restore both.",
          },
        ],
        example: `// Hide the hover toolbar and collapse its gutter
editor.toolbar.setHidden(true);

// Restore it
editor.toolbar.setHidden(false);`,
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
      "Display notification messages to users. Rendering is pluggable: pass `notifier: (options) => …` in the constructor config and Blok calls your handler instead of rendering anything — the built-in toast is skipped entirely (including its i18n `okText`/`cancelText` defaults), and any error your handler throws propagates to the `show()` call site. `notifierPosition` places the built-in container: 'bottom-left' | 'bottom-right' | 'bottom-center' | 'top-left' | 'top-right' | 'top-center' (default 'bottom-center').",
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
            description: "Marks the notification's semantic kind. `'error'` raises the message's screen-reader live region to `assertive` (otherwise `polite`), and the value is stamped onto `data-blok-testid` as `notification-success` / `notification-error`. The built-in toast looks identical either way — there is no success/error coloring.",
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
            description: "Cancel/close callback. Invoked (when provided) before the dialog closes via the cancel button or dismiss/Escape — for both confirm and prompt types.",
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
            resolution: "The built-in notifier never throws or rejects — check the browser console, since the failure is logged rather than propagated to your call site. A custom `config.notifier` handler is a different story: it is called synchronously and its exceptions are not caught.",
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
      "Clean and sanitize HTML content to prevent XSS attacks. A tool's `static get sanitize()` may also map a data field to the string `'plaintext'` instead of a tag map, which marks that field as literal source text rather than markup.",
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
          "Clean HTML string using the provided sanitizer configuration. `'plaintext'` entries are field-level directives, not tag rules, so `clean()` filters them out of the config before parsing.",
        example: `const dirtyHtml = '<script>alert("xss")</script><p>Hello</p>';
const clean = editor.sanitizer.clean(dirtyHtml, {
  p: true,  // Allow <p> tags
  b: true   // Allow <b> tags
});
// Returns: '<p>Hello</p>' (script tag removed)`,
      },
    ],
    properties: [
      {
        name: "plaintext",
        type: "'plaintext'",
        description:
          "A field-level sanitizer rule a tool declares in `static get sanitize()`, and part of the `SanitizerRule` union exported from the package root. Sanitization is an HTML parse: it entity-encodes bare `<`/`&` and drops text shaped like a stray end tag — irrecoverable corruption for a field holding literal source text, such as a code block's `code`. A field marked `'plaintext'` skips tag sanitization, the URL-scheme pass and the editor-level global sanitizer, and round-trips byte-identical. It is declared as a plain string literal rather than a Symbol, so tool sanitize configs survive JSON and `structuredClone`.",
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
            description: "Tooltip content — a string, HTMLElement, DocumentFragment or Node.",
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
            description: "Declared as `string`; the values honored are 'top', 'bottom', 'left' and 'right'. Auto-flipped to the opposite side when the requested side lacks room in the viewport.",
          },
          {
            name: "options.delay",
            type: "number",
            required: false,
            default: "0",
            description: "Milliseconds to wait before showing. Skipped entirely when another tooltip hid within the previous 300 ms, so sweeping across adjacent triggers stays instant.",
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
        description: "Show tooltip on hover using event listeners. Takes the same `options` as `show()`, except that keyboard-focus reveals ignore `delay` so keyboard users never wait.",
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
      "Read and switch the editor color theme at runtime. The configured mode and the theme actually painted are two different questions — `get()` answers the first, `getResolved()` the second. To be notified instead of polling, pass the core config option `onThemeChange`, which fires with the resolved theme when it changes (including OS-preference flips while the mode is 'auto').",
    methods: [
      {
        name: "theme.get()",
        returnType: "'light' | 'dark' | 'auto'",
        description:
          "The configured theme mode — exactly what was passed as `config.theme` or last set via `theme.set()`. Returns 'auto' when the editor follows the OS preference, so this is not the theme currently painted.",
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
          "The theme after evaluating the OS preference when the mode is 'auto' — the theme actually being painted. Use it to match surrounding UI to the editor.",
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
      "Control the editor content width mode — 'narrow' keeps content inside the default `--max-width-content`, 'full' drops the constraint so it fills its container.",
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
          "Flip the content width mode between 'narrow' and 'full' — the one-call \"full width\" switch.",
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
          "Sets the editor placeholder; updates existing blocks in place and applies to blocks created afterward. Pass false to disable. Available synchronously after construction — pre-ready calls are buffered and replayed.",
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
      "Control the read-only state of the editor. Toggling is in-place as long as every registered block tool implements `setReadOnly(state)` on its prototype — every bundled tool does — so the same editor instance flips modes, preserving caret position, undo history and scroll, and an edit/view toggle is `readOnly.set(!isEditing)` on ONE instance instead of destroying one editor and constructing another. The check is all-or-nothing: install a single block tool without `setReadOnly` and every toggle falls back to a save → clear → re-render cycle, which recreates all block instances and does not restore the caret (scroll is restored, and the undo history is deliberately left untouched).",
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
          "Set read-only mode to the specified boolean state. The toggle happens in place — no destroy/recreate: block instances, caret position, undo history and scroll are preserved — provided every registered block tool implements `setReadOnly(state)` on its prototype. The check is all-or-nothing, and a single tool without it (every bundled tool has one; a third-party tool may not) sends EVERY toggle down the fallback path — save → clear → re-render — which recreates all block instances and does not restore the caret, while scroll and undo history still survive. Pass `{ hideControls: true }` to also hide the hover toolbar, block settings and inline toolbar while read-only is active — the option writes the object form of `config.readOnly`, so the live state reflects it. Returns the new state.",
        note:
          "The preferred way to enter/leave read-only mode — it toggles in place, preserving caret, undo history and scroll, as long as every registered block tool implements `setReadOnly()`. Returns a promise resolving to the new state once applied.",
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
              "Hide all editor controls (hover toolbar, block settings popover, inline toolbar) while read-only is active. Sticky: `set()` writes `config.readOnly` only when you pass an actual boolean, so omitting the option keeps whatever `hideControls` is currently in effect — from the constructor config or an earlier `set()` call. Pass `{ hideControls: false }` explicitly to bring the controls back; `false` is only the effective value when `config.readOnly` was never given in object form.",
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
        description: "Toggle read-only state. Without parameter, toggles current state. With parameter, sets to specified state.",
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
          "A build-level marker, hardcoded to `true`: this build of Blok implements the in place toggle path instead of always recreating the editor. It is not a capability probe — it does not report whether the currently installed tool set qualifies for that path (which needs every block tool to implement `setReadOnly`, and is not exposed anywhere). Use it only to detect a Blok build old enough to predate in-place toggling.",
      },
    ],
  },
  {
    id: "i18n-api",
    badge: "I18n",
    title: "I18n API",
    description:
      "Internationalization support for translating UI strings, plus the runtime `i18n.update()` mutator that switches language in place. The locale catalogue itself ships as a separate published entry point, `@bloklabs/core/locales`: only English is bundled, the other 68 locales load on demand, and `normalizeLocale()` is the pre-flight check for a locale you did not hard-code — `i18n.update({ locale })` with an unsupported tag keeps the current locale and warns on the console instead of throwing.",
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
          "Get the text direction currently in effect \u2014 derived from the active locale unless an explicit `direction` override was set. Editor instance only: the `api.i18n` handed to tools carries just `t`, `has`, `getEnglishTranslation` and `getLocale`, so a tool must take the direction from the host (its own config, or the `i18n:changed` event) rather than calling this.",
        example: `if (editor.i18n.getDirection() === 'rtl') {
  // mirror your own chrome next to the editor
}`,
      },
      {
        name: "i18n.update({ locale?, messages?, direction? })",
        returnType: "Promise<void>",
        description:
          "Switch language at runtime. `config.i18n` is otherwise read once during boot, so a host with a language switcher had to recreate the editor to relabel it \u2014 losing caret, focus, selection and undo history. `update()` relabels in place instead: no recreation, nothing lost. `locale` accepts any supported code or `'auto'` to re-run browser detection; `messages` merges host overrides over the locale dictionary and is re-applied automatically after every later locale change (a bare locale flip never silently drops your custom strings); `direction` overrides the direction implied by the locale, which you normally do not need. Calls are serialized internally, so lazily-loaded locale chunks cannot land out of order \u2014 the last call wins. Scope: everything. Chrome built on demand (block settings, the convert menu, notifications, screen-reader announcements) picks up the new locale the next time it opens; the eagerly-stamped chrome (toolbar and plus-button labels, tooltips, the toolbox list) is relabelled immediately; and block content \u2014 placeholders, media-toolbar labels, cell controls, anything a tool resolved while rendering \u2014 is repainted from your data, including tools that know nothing about locale changes. The repaint is invisible to you: `onChange` does not fire, scroll is kept, and the caret returns to the block that had it. Fires the `i18n:changed` event with `{ locale, direction }`. Available synchronously after construction \u2014 a call made before `isReady` is applied once the editor has booted. `update()` and `getDirection()` are exposed on the editor instance only, not on the `api.i18n` handed to tools (which carries just `t`, `has`, `getEnglishTranslation` and `getLocale`), so a third-party tool cannot flip the host's locale. The React/Vue/Angular adapters drive it reactively: change the `i18n` prop/input and the editor follows in place. Note `defaultLocale` is not accepted \u2014 it only decides the fallback while resolving the initial locale.",
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
          "From `@bloklabs/core/locales`. Normalizes an arbitrary BCP-47 language tag — region-tagged (`'en-US'`), script-tagged (`'zh-Hant'`) or aliased (`'nb'` → `'no'`, `'ckb'` → `'ku'`) — to a supported Blok locale, and returns `null` when the tag is unsupported. The same normalizer runs on browser detection and on explicit `config.i18n.locale` / `i18n.update({ locale })`, so a `null` here is exactly the tag that `update()` would refuse: it keeps the current locale and warns on the console rather than throwing.",
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
          "From `@bloklabs/core/locales`. Loads one locale on demand. Only English is bundled — the other 68 are fetched when asked for.",
        example: `import { loadLocale } from '@bloklabs/core/locales';

const fr = await loadLocale('fr');`,
      },
      {
        name: "preloadLocales(codes)",
        returnType: "Promise<void>",
        description:
          "From `@bloklabs/core/locales`. Loads several locales up front — e.g. the ones your language switcher offers — so a later switch does not wait on a fetch.",
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
          "From `@bloklabs/core/locales`. Text direction for a locale CODE. Not the same function as `editor.i18n.getDirection()`, which takes no argument and reports the direction the mounted editor is currently using.",
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
          "From `@bloklabs/core/locales`. All 69 supported locale codes — the list to build a language switcher from, or to hand to `preloadLocales`.",
      },
      {
        name: "enLocale",
        type: "LocaleConfig",
        description:
          "From `@bloklabs/core/locales`. The English dictionary, the only locale bundled by default and the fallback for missing keys.",
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
          "Get all available block tool adapters. Each adapter exposes `name` plus tool metadata, including `assetKind` — set to `'image' | 'video' | 'audio' | 'file'` on media tools that store an uploaded asset URL at `data.url`, and `undefined` otherwise. Use it to discover the media-bearing tool set at runtime (instead of hardcoding each tool's data shape) and reconcile a saved document's `data.url`s against your CDN — e.g. to garbage-collect orphaned uploads.",
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
          "Returns the tools-related configuration of this instance — { tools, inlineToolbar?, tunes?, theme? } — for creating nested Blok editors with the same tool set.",
        example: `const nested = new Blok({ holder, ...editor.tools.getToolsConfig() });`,
      },
      {
        name: "tools.update(name, config)",
        returnType: "void",
        description:
          "Shallow-merge new configuration into an installed tool at runtime — no editor recreation. A `toolbox` key is treated as the tool-level setting (same as `toolbox` in the `tools` map): pass `toolbox: false` to hide the tool from every insertion surface (existing blocks keep rendering) or a toolbox object to (re)show it — permission gating without rebuilding the editor. Under the React adapter this is automatic: change the `toolbox` value in the `tools` prop and `useBlok`/`BlokEditor` applies it in place.",
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
          "Runtime setter for the global `inlineToolbar` config. Re-assigns inline tools for every block tool and recomposes the memoized sanitize configs — so paste-time sanitization follows the new set immediately, and the inline toolbar reflects it on the next selection. Tool-scoped `inlineToolbar` settings (arrays and opt-outs) stay authoritative. Pass `true` for all inline tools, `false` for none, or an ordered list of inline tool names. If you render saved content through @bloklabs/core/view, note that a viewSchema is composed from the inlineToolbar value it was defined with — after a runtime setInlineToolbar involving custom inline tools, recompose it with defineBlokSchema before calling blocksToHtml.",
        params: [
          {
            name: "config",
            type: "boolean | string[]",
            required: true,
            description:
              "`true` enables every registered inline tool, `false` disables the inline toolbar, an array restricts it to the listed inline tools in that order.",
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
          "Returns true when a tool with the given name is installed and available on this editor instance — block, inline or tune. Public introspection over the installed tool set, e.g. as a guard before `tools.update(name, config)`, which throws for unknown names.",
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
          "A registration helper exported from `@bloklabs/core/tools`, not a member of the `tools` namespace. The plain `tools` map types every entry with a bare `ToolSettings` whose `Config` falls back to `Record<string, unknown>`, so a misspelled config key (`defaultLevle` for `defaultLevel`) compiles silently. `defineTool` recovers the tool's real config type from its constructor and applies it to `settings.config`, turning those typos into compile errors. The type-checking happens on the `settings` argument; the RETURN type stays the erased `ExternalToolSettings`, so the result drops straight into the `tools` map. `ExtractToolConfig<TClass>` — the type that does the recovery — is exported alongside it, and falls back to `Record<string, unknown>` for tool classes whose constructor declares no concrete config.",
        example: `import { Blok } from '@bloklabs/core';
import { Header, defineTool } from '@bloklabs/core/tools';

new Blok({
  tools: {
    header: defineTool(Header, { config: { levels: [1, 2, 3] } }),
    // \`defaultLevle: 2\` here would now be a compile error
  },
});`,
      },
    ],
  },
  {
    id: "uploader-api",
    badge: "Uploader",
    title: "Uploader API",
    description:
      "Upload an asset through the pipeline that owns its KIND, instead of whichever tool happens to be asking. Tools call this rather than reaching into their own `config.uploader`, which is why an audio block's cover art reaches your image pipeline instead of the audio endpoint that would reject it. Resolution order for a kind: the tool whose static `assetKind` matches (e.g. `tools.image.config.uploader` for `'image'`), then the editor-level `uploader` config, then a local fallback \u2014 a `blob:` URL for files, the URL verbatim for links.",
    methods: [
      {
        name: "uploader.uploadByFile(file, ctx)",
        returnType: "Promise<{ url: string; fileName?: string }>",
        description:
          "Store a file and return its URL. `ctx` is `{ kind, tool?, onProgress? }` where `kind` is the ASSET kind, not the requesting tool \u2014 they differ whenever a tool holds an asset outside its own media family.",
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
          "Re-host an asset the user supplied by URL and return the stored URL. Without an uploader for the kind, the URL is stored verbatim \u2014 configure one if a strict `img-src`/`media-src` policy or link rot would break third-party URLs.",
        example: `const { url } = await this.api.uploader.uploadByUrl(pastedUrl, {
  kind: 'image',
  tool: 'my-card',
});`,
      },
      {
        name: "uploader.isConfigured(kind, method?)",
        returnType: "boolean",
        description:
          "Whether a host uploader handles this kind. False means the caller would get the local fallback \u2014 useful for deciding whether an asset is worth uploading at all, e.g. inlining small extracted artwork as a `data:` URL instead.",
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
      "The data structure returned by the save() method. Input positions — the `data` config option, `render()`, `blocks.render()`, and `blocks.insertMany()` — also accept the loose wire variants `LooseOutputData` / `LooseOutputBlockData`, where block `data`, `id`, and `time` may be `null`: a `null` `data` becomes `{}`, a `null`/empty `id` gets a generated one. Saved output is always the strict shape.",
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
          "Structural equality for saved documents, exported from the main entry. Compares the `blocks` arrays deeply; the volatile `time` and `version` envelope fields are ignored, so a document round-tripped through save() compares equal to its echo. Block ids participate only when BOTH sides carry one: the editor mints fresh ids for id-less content, so a legacy document (or a backend that strips ids) still compares equal to its saved echo — no id-stripping wrapper needed on the consumer side. Nullish documents and loose wire shapes are accepted — `null`/`undefined` compares equal to `{ blocks: [] }`. The third argument is `EqualsOutputDataOptions` (also exported from the main entry): `ignoreEmptyDefaultBlocks` (default `false`) drops empty blocks of the DEFAULT block tool from both sides before comparing, so a pristine editor holding one empty paragraph equals a saved-empty baseline — the flag to use for dirty-vs-baseline checks. Empty NON-default blocks (a content-less divider, an empty image) are kept.",
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
          "True when the document carries no user content, exported from the main entry: it is nullish, has no blocks, or every block's data holds only empty values (blank/whitespace-only strings, empty arrays/objects). Numbers and booleans (`level`, `checked`, styles) are presentation metadata and never count as content on their own.",
        example: `import { isEmptyOutputData } from '@bloklabs/core';

const data = await editor.save();
submitButton.disabled = isEmptyOutputData(data);
// → true for a fresh editor holding one blank paragraph`,
      },
      {
        name: "normalizeOutputData(data)",
        returnType: "OutputData",
        description:
          "Normalizes a whole loose backend DTO into the strict saved OutputData shape, exported from the main entry. A nullish document becomes `{ blocks: [] }`; `null` envelope fields (`time`/`version`) are dropped; each block is normalized so `null`/missing `data` becomes `{}` and `null`/empty ids are dropped for regeneration. Unlike a hand-written `blocks.map(...)` mapper it preserves every passthrough field — `tunes`, `parent`, `content`, `indent`, edit metadata — so hierarchy and tunes are never silently lost. Idempotent: a strict document passes through unchanged.",
        example: `import { normalizeOutputData } from '@bloklabs/core';

// A loose Editor.js-era DTO (data: null, id: null) from your backend
const strict = normalizeOutputData(dtoFromApi);
// → strict OutputData, safe to persist or diff — no blind \`as OutputData\` cast`,
      },
      {
        name: "normalizeOutputBlocks(blocks)",
        returnType: "OutputBlockData[]",
        description:
          "Block-level counterpart of normalizeOutputData, exported from the main entry: normalizes an array of loose wire blocks into the strict saved shape (`null`/missing `data` → `{}`, `null`/empty `id` dropped for regeneration) while passing every other field through untouched. Use normalizeOutputData when you hold the whole document envelope.",
        example: `import { normalizeOutputBlocks } from '@bloklabs/core';

const blocks = normalizeOutputBlocks(looseBlocksFromApi);
// → OutputBlockData[] with tunes/parent/content/indent intact`,
      },
      {
        name: "BlokData<T>",
        returnType: "{ [K in keyof T]: T[K] }",
        description:
          "A type helper, exported from the main entry, that lets an `interface` block-data shape fit the `data` slot. A TS `interface` has no implicit index signature and is therefore not assignable to `Record<string, unknown>`, so `OutputBlockData<'task', TaskData>` fails to compile when `TaskData` is an interface. `BlokData<T>` re-projects `T` through a homomorphic mapped type, which the compiler does treat as having an implicit index signature, while every declared key keeps its precise type. No rewrite is needed: an existing interface value is assignable to `BlokData<T>`, and a `type` alias already satisfies the slot on its own.",
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
          "Turns an ergonomic nested spec into the flat DFS pre-order `OutputBlockData[]` Blok stores, wiring every `parent`/`content` link for you, exported from the main entry alongside its `BlockTreeSpec` and `FlattenTreeOptions` types. A spec node is `{ type?, data?, tunes?, id?, children? }`; the pure counterpart of the live `blocks.insertTree()` mutation — the same DFS without an editor — so nested content (columns, tables, a whole document) can be seeded without hand-authoring `parent`/`content` id arrays. Every returned block has a resolved `id` (generated when the spec omitted one), so the array is safe to reference by id; leaves omit the empty `content` array. `options` takes `parentId` (the `parent` assigned to the root node(s)) and `generateId` (id generator for nodes without an explicit `id` — pass a deterministic one for reproducible output). Reusing an explicit `id` within the spec throws.",
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
console.log(blocks); // flat, DFS pre-order, every parent/content link wired`,
      },
      {
        name: "isBlockType(block, type)",
        returnType: "block is OutputBlockData<K, BlokBlockDataMap[K]>",
        description:
          "A type guard exported from `@bloklabs/core/tools` that narrows a saved block to a known block type, so its `data` is typed through the `BlokBlockDataMap` registry instead of `Record<string, unknown>` — it replaces the `block.type === 'header'` check plus `data as HeaderData` cast. `BlokBlockDataMap` maps each built-in block type to its data shape and is exported from the same subpath; it is augmentable, so a custom tool registers its own shape by declaration merging and gets narrowed the same way.",
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
          "The collection counterpart of `isBlockType`, also exported from `@bloklabs/core/tools`: collects every saved block of a given type from a document with each result's `data` typed through `BlokBlockDataMap`. Null-tolerant — a `null`/`undefined` document, and the loose `LooseOutputData` wire shape, are accepted — so it replaces the `(data?.blocks ?? []).filter(...)` plus cast that every feature re-writes.",
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
          "A shared, deeply frozen empty document (`{ blocks: [] }`), exported from the main entry. Use it in place of a hand-written `{ blocks: [] }` literal for cleared/pristine baselines. Frozen (blocks array included) so a shared reference can never be mutated into a stale non-empty baseline.",
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
          "Maps a controlled `data` value to something render()/blocks.render() accepts, exported from the main entry: a whole-document `null` (a controlled \"clear to empty\") becomes `{ blocks: [] }`; any real document passes through untouched. render()'s strict guard reads `data.blocks` and would throw on `null`, so route a nullable controlled value through this first.",
        example: `import { toRenderableData } from '@bloklabs/core';

// \`draft\` may be null when the host clears the document
await editor.blocks.render(toRenderableData(draft));`,
      },
      {
        name: "createEmittedEchoWindow(capacity?)",
        returnType: "{ record; matches; clear }",
        description:
          "Creates a bounded window of recently emitted onSave payloads for recognizing controlled-`data` echoes, exported from the main entry. Deduping against only the LAST emitted payload is not enough: a host that persists on save and refetches can hand back a STALE echo (an earlier save arriving after a newer one already replaced the baseline), and re-rendering it would clobber the caret and any content typed since. Matching is structural (equalsOutputData), so envelopes reshaped in transit (fresh `time`, stripped ids) still count as echoes.",
        example: `import { createEmittedEchoWindow } from '@bloklabs/core';

const echoes = createEmittedEchoWindow();
// in onSave: echoes.record(data)
// before re-rendering incoming props: if (echoes.matches(next)) return;`,
      },
      {
        name: "migrateLegacyBlocks(blocks, options?)",
        returnType: "OutputBlockData[]",
        description:
          "Migrate legacy / Editor.js-style blocks into Blok's hierarchical flat-with-references format, exported from the `@bloklabs/core/migrate` subpath — the same transform the renderer runs automatically at load. Legacy nested shapes (list items, toggle/callout children) explode into separate blocks linked by `parent`/`content` (`parent` is the saved-document field; `parentId` is the useBlocks BlockNode snapshot field), and id-less blocks are stamped with an id. Already-hierarchical blocks pass through unchanged, so it is safe to run on current data and idempotent across repeated runs. `options` exposes the migration context: `generateId` makes the pass PURE (migrate the same document twice and the outputs are equal — needed to compare a stored doc against its migration, or to re-run migration per render without minting fresh ids), `onLossyField` delivers every dropped field instead of dumping it to `console.warn`, and `rules` adds your own grammar entries. `migrateLegacyOutputData(data, options?)` is the envelope-preserving variant; `needsLegacyMigration(blocks, options?)` reports whether a migration would change anything; `matchLegacyRule(block, options?)` is the per-block primitive that returns the entry claiming a single block (or `null`) without re-scanning the table for every block. Every rules-taking entry point accepts either the options object or a bare `rules` array, so passing the array directly can't silently read as \"no rules\".",
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
          "For a data shape only a specific tool understands (a columns layout, a custom media envelope) that core's built-in migration can't read, give that tool a static `upgradeData(data)` — a pure function returning the tool's current data shape. Blok runs it at load, while composing each stored block, before the tool is constructed; a hook that throws is caught and the block loads with its stored data.",
      },
      {
        name: "migrations (config) & migrateOutputData(data, migrations)",
        returnType: "OutputData",
        description:
          "Declare per-type \"old data shape → new data shape\" rules from OUTSIDE the tool class. Where `upgradeData` must live inside a tool you own, `migrations` is a map keyed by block type you pass in editor config — so you can migrate a third-party tool you don't control, or your own tool without editing (and re-shipping) its class. Each rule is a pure `(data) => data` transform (return the input unchanged, or `undefined`, when already current). Blok applies it at load, after the tool's own `upgradeData` and BEFORE format analysis — so `dataModel: 'auto'` sees the post-migration shape and an 'auto' round-trip can't quietly undo the migration by saving the old shape back. A throwing rule falls back to the stored data (never a blank editor). The same map works offline: pass it to `migrateOutputData(data, migrations)` (or `migrateBlocks(blocks, migrations)`) from `@bloklabs/core/migrate` to batch-upgrade persisted records without opening an editor. Available on all three framework adapters as the `migrations` prop/input.",
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
          "Rules must be pure and idempotent — they run on every load, including on already-current data. Prefer `migrations` (config) for shapes a host decides from the outside; prefer a tool's own `upgradeData` for shapes only that tool understands. They compose: `upgradeData` runs first, then the config `migrations` rule for that type.",
      },
      {
        name: "migrate(data, { migrations, rules, generateId, onLossyField })",
        returnType: "{ data: OutputData; report: MigrationReport }",
        description:
          "The composed entry point: runs BOTH migration passes in the one correct order and reports what the migration cost. Data rules (`migrations`) run first, then grammar rules (`rules`) restructure the tree. That order is load-bearing: data rules are keyed by block TYPE, and the grammar rewrites types (`linkTool` → `bookmark`) and explodes containers into many blocks — so a rule run after the grammar never fires, and the block stays silently unmigrated. Data rules shape the grammar's input; the grammar owns the output shape for the types it rewrites. The `report` names every field the mapping could not carry over (`lossyFields`) and every data rule that threw (`errors`), so a batch upgrade of persisted records is no longer silent about its own data loss.",
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
          "Teach the migration machinery a legacy shape Blok doesn't know. A grammar entry is `{ legacyType, detect, expand, targetType, cardinality, contributesNesting, lossyFields, docNote }`; passing entries via `rules` reuses the whole interpreter — recursion into container bodies, the orphan re-parenting invariant, 1:N splits, id minting — instead of re-implementing the dispatch loop around a data-only rule. Host entries are matched BEFORE the built-in table, so they can also override a built-in mapping. Unlike a `migrations` rule, an entry may change a block's `type` and emit several blocks. `expand(block, ctx, { siblings, index })` may also return `{ blocks, consumed }` to absorb the following `consumed` siblings — the shape flat-with-count legacy formats need (a container storing its body as \"the next N blocks\"); `consumed` is clamped to what remains, so a truncated document can't over-consume. Read `LEGACY_GRAMMAR` to introspect the built-in coverage.",
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
          "A container rule whose body is stored as a COUNT of following siblings returns `{ blocks, consumed }` — the interpreter skips exactly that many siblings, so the children are re-parented once and never emitted twice.",
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
  lastEditedAt?: number; // Timestamp (ms since epoch) of the last edit to this block
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
        description: "Id of the parent block (flat-with-references nesting)",
      },
      {
        option: "content",
        type: "string[] (optional)",
        default: "—",
        description: "Ids of child blocks (flat-with-references nesting)",
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
        description: "Timestamp (ms since epoch) of the last edit to this block",
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
      "The all-in-one editor component shipped by the framework adapters — <BlokEditor> in @bloklabs/react and @bloklabs/vue, <blok-editor> (BlokEditorComponent) in @bloklabs/angular. React and Vue accept every editor config option as a prop and forward unknown props/attributes to the container div. Angular is different: it declares a curated set of `@Input()`s — tools, data, readOnly, hideToolbar, inlineToolbar, theme, width, placeholder, styleTokens, i18n, autofocus, migrations, onBeforeRender, onBeforePaste, onError — plus a `[config]` escape hatch for every other config key (sanitizer, minHeight, defaultBlock, dataModel, link, linkPaste, tunes, user, resolveUser, uploader, notifier, logLevel, onEnter, onSubmit, scrollToBlock, …), and it does not forward host attributes onto the container div. The live Blok instance is read via ref/onReady (React), the `instance` on a template ref or the `@ready` emit (Vue), and the `instance` signal or the `(ready)` output (Angular). The props below cover the adapter-specific surface; everything else matches the Configuration options.",
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
          "The split mount path behind `<BlokEditor>`: create the instance yourself and hand it a mount point. `useBlok` takes the SAME options as the component — its config type is `UseBlokConfig`, which is `BlokConfig` minus `holder` (the adapter owns the mount element) plus an adapter-level `width`. The reactive-after-mount subset is documented on `UseBlokConfig` itself: `readOnly`, `hideToolbar`, `inlineToolbar`, `autofocus`, `theme`, `width`, `placeholder`, `style.tokens`, `i18n` and `data` sync in place on the same instance; every other option is consumed once at editor creation. It returns null until the editor exists (SSR, first render). React takes a `deps` dependency LIST as the second argument; Vue takes a reactive config source (ref or getter) and a SINGLE `recreateKey` as the second argument. Angular's equivalent is the `[blokContent]` directive (`BlokContentDirective`), which builds the instance into its own host element and exposes it as the `instance` signal / `(ready)` output.",
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
          "The mount point for an instance created by `useBlok`. Renders a `<div>` and adopts the editor's detached holder into it. Its only own prop is `editor: Blok | null` (`BlokContentProps`) — pass null before the instance exists and it simply renders the empty container. In React it also extends `React.HTMLAttributes<HTMLDivElement>`, so `className`, `id` and the rest are forwarded to that div, and it forwards a ref to it. Angular's counterpart is the `[blokContent]` directive, which creates the instance itself rather than receiving one.",
        example: `import { useBlok, BlokContent } from '@bloklabs/react';

const editor = useBlok({ tools });

// \`editor\` is null until the instance exists — BlokContent handles that
<BlokContent editor={editor} className="prose" />`,
      },
      {
        name: "provideBlok(defaults)",
        returnType: "void | EnvironmentProviders",
        description:
          "Registers app-wide Blok defaults so every editor beneath it inherits a shared tools registry, theme or i18n config instead of repeating them per instance. React spells it as `<BlokProvider defaults={…}>` (with `useBlokDefaults()` to read them back), Vue as `provideBlok(defaults)` called in a parent's `setup` (backed by the `BLOK_DEFAULT_CONFIG` injection key, with `useBlokDefaults()` to read), and Angular as `provideBlok(defaults)` returning `EnvironmentProviders` for a `providers` array (backed by the `BLOK_DEFAULT_CONFIG` injection token). Merge rule, identical in all three: a defined per-instance config value overrides the default, EXCEPT `tools`, where the two registries are merged — the shared registry composes with per-instance additions rather than being replaced.",
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
          "Block tools to register. React only: functions anywhere inside a tool's config (e.g. an uploader callback) are re-bound to the latest render automatically, so inline closures are safe and only a changed tool CLASS needs a `deps` entry. Vue and Angular have no equivalent — a closure in a tool config is captured when the editor is constructed and goes stale, so keep it in a stable ref/field, or force a rebuild by changing `recreateKey`.",
      },
      {
        option: "data",
        type: "OutputData | LooseOutputData | null",
        default: "—",
        description:
          "Editor content (reactive). Seeds the initial document; after mount, new content — including transitions to and from empty content — re-renders in place on the same instance (never recreates the editor). Updates are deep-equal–deduped, so echoing the editor's own output back never clobbers the caret. A whole-document `null` is the controlled \"clear to empty\" value (route it through `toRenderableData` when you call render() yourself), and loose backend DTOs are accepted as-is. Angular widens it to `… | undefined`; Vue's prop is declared `PropType<OutputData>` and is the narrow outlier.",
      },
      {
        option: "onSave",
        type: "(data: OutputData, api: API) => void",
        default: "—",
        description:
          "The output half of the controlled component: fires (debounced) with the full serialized document on every content change — no manual save() polling. Wiring onSave={setData} is safe and recursion-free. The `(data, api)` arity is React's, where the prop is passed straight through to the core config. Vue maps it to the `save` emit and Angular to the `save` output, both carrying `OutputData` only: `@save=\"(data) => …\"` / `(save)=\"…\"` — or use `v-model:data` / `[(data)]`, backed by Vue's `update:data` emit and Angular's `dataChange` output.",
      },
      {
        option: "onChange",
        type: "(api: API, event: BlockMutationEvent | BlockMutationEvent[]) => void",
        default: "—",
        description:
          "Low-level mutation events (block added/changed/moved/removed), for when you need per-mutation granularity instead of serialized output. A batch of mutations arrives as an ARRAY, so branch on `Array.isArray(event)` before reading `event.detail`. Two positional arguments is React's arity; Vue's `change` emit and Angular's `change` output deliver ONE object instead — `@change=\"({ api, event }) => …\"` / `(change)=\"…\"` with `$event.api` and `$event.event`.",
      },
      {
        option: "onReady",
        type: "(editor: Blok) => void",
        default: "—",
        description:
          "Called with the live Blok instance, exactly once per editor instance. Fires after the forwarded ref commits, so ref.current is also populated. The editor is recreated (and onReady re-fired) only when deps/recreateKey change or the component remounts — data changes, including to/from empty content, re-render in place and never re-fire it. Vue and Angular spell it as the `ready` emit/output (`@ready` / `(ready)`).",
      },
      {
        option: "deps / recreateKey",
        type: "DependencyList (React) | unknown (Vue, Angular)",
        default: "[] (React)",
        description:
          "Values whose identity change destroys and recreates the editor (for structural config like tool classes). React takes an array — `deps` — and recreates when any entry's identity changes. Vue (`:recreate-key`) and Angular ([recreateKey]) take a SINGLE value instead and recreate when that value's identity changes; pass a fresh object/array literal or a bumped counter. `deps` does not exist on Vue/Angular. Keep each value referentially stable. Functions inside tool configs do NOT belong here on React — they are re-bound to the latest render automatically.",
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
          "Color theme (reactive). Don't wrap the component in styled() or any HOC that reserves the theme prop — it would never reach the editor.",
      },
      {
        option: "onThemeChange",
        type: "(resolvedTheme: 'light' | 'dark') => void",
        default: "—",
        description: "Called with the resolved theme whenever it changes (e.g. when 'auto' follows the OS). Vue and Angular spell it as the `theme-change` emit / `themeChange` output (`@theme-change` / `(themeChange)`).",
      },
      {
        option: "width",
        type: "'narrow' | 'full'",
        default: "'narrow'",
        description: "Content width mode (reactive). Synced after mount via editor.width.set() — see the Width API for the imperative surface (get / set / toggle).",
      },
      {
        option: "style",
        type: "BlokConfig['style']",
        default: "—",
        description:
          "Styling config. `style.tokens` is reactive: changed `--blok-*` overrides sync in place after mount via editor.tokens.set() (deep-equal deduped), so a host light/dark toggle needs no remount. Replace semantics — pass the whole palette; tokens dropped from it stop applying. Angular has no `style` input: it exposes only `style.tokens`, as the separate `[styleTokens]` input (`Record<string, string>`). The remaining `style` keys — `fontSize`, `contentAlign`, `nativeSelection` — must go through Angular's `[config]` escape hatch.",
      },
      {
        option: "i18n",
        type: "BlokConfig['i18n']",
        default: "—",
        description:
          "Internationalization config (reactive). A changed `locale`, `messages` or `direction` syncs in place after mount via editor.i18n.update() (deep-equal deduped), so a language switcher relabels the editor without remounting it \u2014 caret, focus, selection and undo history survive. `defaultLocale` is the exception and is read only at construction. Angular exposes this as the [i18n] input.",
      },
      {
        option: "locale",
        type: "string",
        default: "—",
        description:
          "React only. A library-neutral BCP-47 shorthand for `i18n.locale`: it is folded into the i18n config and applied in place via editor.i18n.update({ locale }), so a language switch keeps caret, focus and undo history. It WINS over `i18n.locale` when both are given. Pair it with `getDirection` / `normalizeLocale`, re-exported from @bloklabs/react, to compute `dir` and validate tags yourself. Vue and Angular have no such prop — pass the locale inside the `i18n` prop/input.",
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
        description: "Placeholder text handed to every block of the default tool — not only the first block; with the built-in paragraph it shows while a block is empty and focused. See the Configuration table for what `false` does (and does not) disable, and the Placeholder API to change it at runtime via editor.placeholder.set().",
      },
      {
        option: "onBlocksRendered",
        type: "(payload: BlocksRenderedPayload) => void",
        default: "—",
        description:
          "Called after a batch render completes (core blocks:rendered event) — the declarative analog of editor.on('blocks:rendered', …). Vue and Angular spell it as the `blocks-rendered` emit / `blocksRendered` output.",
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
          "Forwarded to the live Blok instance for imperative calls (save, render, blocks, caret, …). Null until the editor mounts, so calls must guard on ref.current. For the common shortcuts without the guards, @bloklabs/react's useBlokHandle() returns a stable, null-safe handle — attach it via ref={handle.ref} and call handle.focus()/save()/clear()/render()/setReadOnly() directly (each safely no-ops until ready); handle.current is the escape hatch to the full instance.",
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
    lastUpdated: "2026-07-17",
    description:
      "A reactive snapshot of the block tree plus a full manipulation API, from the framework adapters: the useBlocks(editor) hook in @bloklabs/react, the useBlocks(editor) composable in @bloklabs/vue, and `injectBlocks(editor)` in @bloklabs/angular — pass the `instance` signal of BlokEditorComponent/BlokContentDirective, and call it from an injection context (a field initializer or the constructor). Reads re-render reactively as the document changes; writers are atomic (one undo step) and safe to call before the editor is ready (they no-op). Returned BlockNode objects ({ id, type, parentId, contentIds }) are fresh-snapshot volatile — read them now, don't stash them in dep arrays.",
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
          "Insert one block (type, data, parentId, position, tunes, id, focus/caret, replace). `replace: true` combined with a `position` that targets an existing block replaces that block instead of inserting beside it — a programmatic \"turn into\". Returns the created node, or null when rejected (unknown tool type, dangling parentId, or a `replace` whose target is missing). An explicit id that already exists is insert-if-absent. Atomic — one undo step.",
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
          "Insert several blocks atomically, in array order, as ONE undo step. Specs that fail are dropped; returns the successfully created nodes.",
        example: `const nodes = blocks.insertMany([
  { type: 'header', data: { text: 'Title' } },
  { type: 'paragraph', data: { text: 'Body' } },
]);`,
      },
      {
        name: "insertTree(spec)",
        returnType: "BlockNode | null",
        description:
          "Insert a pre-built NESTED subtree in one atomic operation. Children are inserted under their enclosing node recursively; placement options apply to the root only. Returns the root node, or null on a rejected/colliding id.",
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
          "Convert a Markdown string to blocks and insert them ADDITIVELY (without clearing the document). Async — the converter is lazy-loaded. Returns all created nodes in document order; empty input or a dangling parentId returns [].",
        example: `const nodes = await blocks.insertMarkdown(
  '# Title\\n\\n- one\\n- two',
  { position: 'end' },
);`,
      },
      {
        name: "exportMarkdown()",
        returnType: "Promise<string>",
        description:
          "Serialize the WHOLE document to Markdown (async, lazy-loaded serializer). Structure Markdown can't express (e.g. merged table cells) is dropped.",
        example: `const md = await blocks.exportMarkdown();`,
      },
      {
        name: "markdownToBlocks(md, config?)",
        returnType: "Promise<OutputBlockData[]>",
        description:
          "Convert Markdown to blocks WITHOUT an editor instance — the standalone `@bloklabs/core/markdown` subpath, not a method on the hook. It needs no DOM and no mounted Blok, so it is the server-side path insertMarkdown/exportMarkdown cannot cover: import Markdown in a Node job, seed a document, or precompute `data` before the editor mounts. `config` is a `MarkdownImportConfig` (tool mapping, GFM, extensions). The result is ready for `blocks.render()` or `blocks.insertMany()`.",
        example: `import { markdownToBlocks } from '@bloklabs/core/markdown';

// No editor instance required — this also runs on the server
const parsed = await markdownToBlocks('# Title\\n\\n- one\\n- two');

// -> OutputBlockData[]; store it, or hand it to a live editor
await blocks.render({ blocks: parsed });`,
      },
      {
        name: "move(id, target)",
        returnType: "void",
        description:
          "Move a block to a flat slot: { before }, { after }, or { toIndex }. The block adopts the parent of wherever it lands — use nest/unnest to change the parent without picking a sibling slot.",
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
          "Update a block's data and/or tunes by id. Delegates to core's async blocks.update (its own undo step); unknown ids are a silent no-op.",
        example: `blocks.update(nodeId, { text: 'Edited' });`,
      },
      {
        name: "convert(id, newType, dataOverrides?, options?)",
        returnType: "void",
        description:
          "Convert a block to another type (\"turn into\"). Both tools must define conversionConfig; a non-convertible block is a graceful no-op. options.caret places the caret in the converted block.",
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
          "Like transact, but the operation is NOT captured in undo history — for silent auto-repair/normalization that CMD+Z should never step through.",
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
          "Insert a single child under a parent at a flat index, atomically (creation AND parent assignment in ONE undo step) — prefer over insert() + nest(), which is two steps.",
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
          "Replace the WHOLE document with blocks from saved OutputData — a document-LOAD primitive that clears existing content first (unlike the additive inserters).",
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
          "Read a block's current data and tunes by id without mutating anything — makes a client-side duplicate composable: read a node, then insert({ type, data, tunes }).",
        example: `const saved = blocks.getBlockData(nodeId);
if (saved) {
  blocks.insert({ type: 'paragraph', data: saved.data, position: { after: nodeId } });
}`,
      },
      {
        name: "getBlockByElement(element)",
        returnType: "BlockNode | null",
        description:
          "The block whose holder contains/equals a DOM element — maps an event target back to a block.",
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
          "Whether a Yjs sync (undo/redo) is in progress — use it to skip cleanup that would fight undo state.",
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
      "Live readiness of the Blok editors inside a DOM subtree, as a boolean you can render from — the useBlokReady(options) hook in @bloklabs/react, the useBlokReady(options) composable in @bloklabs/vue (returns a ref), and injectBlokReady(options) in @bloklabs/angular (returns a signal). All three wrap the same core registry behind Blok.readyState() and Blok.subscribeReady(), so they cannot drift. It answers the question a comments list or a form actually has: are MY editors ready? Scope it with the ref you already hold on the container, so an unrelated editor elsewhere on the page cannot hold your gate closed. It is a live signal, not a one-shot latch: an editor mounted later re-closes the gate, and with settleOn: 'rendered' so does every re-render from a changed data prop. A scope holding no editors is ready, so the empty-list case needs no special-casing. It starts false and takes its first real reading once the scope element is attached (React: the mount effect; Vue: onMounted; Angular: afterNextRender), and a scope you asked for that has not resolved yet reports false rather than silently falling back to the whole page — over-waiting is safe, under-waiting is a bug.",
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
          "True when every Blok editor in scope is settled. Re-evaluates on every readiness change (construction, boot, render-state flip, destroy) and unsubscribes on unmount.",
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
    lastUpdated: "2026-07-24",
    description:
      "Display saved documents without paying for an editor. The @bloklabs/core/view subpath renders OutputData to semantic HTML or plain text synchronously and DOM-free — it runs in Node, workers, and React Server Components — so display-only surfaces (published pages, previews, search indexing, emails) no longer need an editor instance, its bundle, or its async ready latch. Every inline-content field is sanitized against the composed allowlist before interpolation, with a URL scheme policy identical to the editor's; pair the functions with defineBlokSchema and documents are displayed under the same sanitize composition that produced them (if you later change the inline-tool set at runtime via tools.setInlineToolbar, recompose the schema so the view keeps up). For React, <BlokView> (and the wrapper-free useBlokView) is the obvious read-only path — reach for it instead of <BlokEditor readOnly>, which ships the full editing runtime (toolbar, history, mutation machinery) to every viewer. Output is unstyled by default: opt into classes + root together with the opt-in @bloklabs/core/view.css for editor parity, or toolAttributes alone with that stylesheet for the classless baseline that reproduces the editor's block spacing from the same --blok-block-padding-* tokens; enable blockIds for copy-link-to-block deep links, and pass transformUrl to rewrite hrefs / CDN image URLs.",
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
          "Render a saved document to semantic HTML — synchronous and DOM-free, so it is safe in Node, workers, and React Server Components. Every inline-content field is sanitized against the composed allowlist before interpolation, and the URL scheme policy is identical to the editor's. Returns '' for empty or malformed documents (nullish input is tolerated).",
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
              "viewSchema from defineBlokSchema. Its single composed baseSanitize — folded from the enabled INLINE TOOLS and TUNES, not from block tools' own static sanitize — is spread over the renderer's default inline allowlist, so inline content displays under the same composition that produced it. viewSchema.tools is carried for consumers; the renderer does not read it. To control a custom block's markup, use renderers.",
          },
          {
            name: "options.renderers",
            type: "Record<string, (data, ctx) => string>",
            required: false,
            description:
              "Custom per-tool renderers; a renderer wins over the built-in emitter for its tool name. ctx provides sanitizeInline (sanitize an inline-HTML string), renderBlocks (render an arbitrary block array), plainText (plain text of an HTML string), and renderChildren (render the current block's structural children) so custom output composes safely with the rest of the document.",
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
              "Stamp data-blok-tool=\"<type>\" on each block root (list runs on their <ul>/<ol>) as a styling hook. Import the opt-in @bloklabs/core/view.css to reproduce the editor's block spacing from the same --blok-block-padding-* tokens, instead of reverse-engineering it with bare-tag CSS. Only Blok's built-in markup is stamped; custom renderers and bare containers (database) are left untouched.",
          },
          {
            name: "options.blockIds",
            type: "boolean",
            required: false,
            default: "false",
            description:
              "Stamp data-blok-id=\"<id>\" on each block root (list items on their <li>, not the grouped <ul>/<ol>), so \"copy link to block\" deep links resolve off the live editor. Blocks without an id and bare containers that emit no root of their own (database) are left unstamped.",
          },
          {
            name: "options.transformUrl",
            type: "(url, ctx) => string",
            required: false,
            description:
              "Pure URL rewrite hook applied to every block URL (image/video/audio src, file/bookmark/embed href) and every inline anchor href — for rewriting hrefs or routing CDN image URLs. ctx is { attr: 'href' | 'src', blockType?: string } (blockType is undefined for inline anchors). It runs BEFORE the unsafe-scheme strip, so a rewrite can never re-introduce a javascript:/data: sink; returning '' drops the URL.",
          },
          {
            name: "options.root",
            type: "boolean",
            required: false,
            default: "false",
            description:
              "Wrap the output in <div data-blok-interface=\"view\">. Not cosmetic: the scoped preflight and the token/colour layers key on the bare [data-blok-interface] attribute, so emitted classes compute differently without the wrapper and @bloklabs/core/view.css cannot reproduce the editor's appearance. Opt-in because it adds an element to existing output. <BlokView> stamps the attribute on its own wrapper, so React consumers never set this.",
          },
          {
            name: "options.classes",
            type: "boolean",
            required: false,
            default: "false",
            description:
              "Render blocks with the editor's presentational classes and the per-block holder → content scaffolding, so the result matches a read-only editor render. Requires @bloklabs/core/view.css plus root: true (or an [data-blok-interface] ancestor) to actually paint; a few tools also gain a wrapper element under this flag. <BlokView> enables it by default; the useBlokView hook does not.",
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
          "Extract the plain text of a saved document — blocks are separated by \\n\\n, list items by \\n, table cells by \\t. Synchronous and DOM-free, same options as blocksToHtml. Ideal for previews, search indexing, and character counts.",
        note:
          "There is no core \"document size\" helper because the two sizes you might mean are measured differently: `blocksToPlainText(data).length` is the visible content length (what a user typed), while `new TextEncoder().encode(JSON.stringify(data)).length` is the transport size in bytes (what a save/upload limit — e.g. 500KB — should check). Use the plain-text length for content rules and the JSON byte length for storage rules.",
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
        name: "htmlTextContent(html)",
        returnType: "string",
        description:
          "Extract the plain text of an HTML fragment — synchronous and DOM-free, the view renderer's replacement for element.textContent. Entities are decoded (`a &lt; b` → `a < b`) and `<br>` becomes a newline. Use it instead of hand-rolling a DOMParser strip (which needs a DOM) when reducing an inline-HTML field to text.",
        example: `import { htmlTextContent } from '@bloklabs/core/view';

htmlTextContent('<b>Intro</b> &amp; more'); // → 'Intro & more'`,
      },
      {
        name: "sanitizeHtmlFragment(html, config)",
        returnType: "string",
        description:
          "Sanitize an HTML fragment against a sanitizer config with no DOM (parse5-backed, matching the editor's html-janitor semantics). `config` is a tag → rule allowlist, or the `'plaintext'` sentinel to strip markup entirely. The DOM-free counterpart of `api.sanitizer.clean()` — use it in Node, workers and RSC, where the editor's sanitizer cannot run.",
        example: `import { sanitizeHtmlFragment } from '@bloklabs/core/view';

sanitizeHtmlFragment('<b>bold</b><script>x()</script>', { b: {} });
// → '<b>bold</b>'`,
      },
      {
        name: "outlineFromOutputData(data)",
        returnType: "OutlineItem[]",
        description:
          "Extract the heading outline of a saved document — the source for a table of contents. Synchronous and DOM-free: walks the document in reading order (top-level blocks, then structural children), picks header blocks, and reduces each heading's inline HTML to plain text. Each item is { id?, level, text } — the block id drives anchor links / scroll targets, so no separate DOMParser pass is needed. Headings with empty text are skipped.",
        example: `import { outlineFromOutputData } from '@bloklabs/core/view';

const toc = outlineFromOutputData(savedData);
// → [{ id: 'h1', level: 1, text: 'Getting Started' }, ...]`,
      },
      {
        name: "defineBlokSchema(config)",
        returnType: "{ editorConfig, viewSchema }",
        description:
          "Resolve a tools/inlineToolbar/tunes config into one shared schema. Pure and module-scope-safe: call it at module scope and import the result everywhere. Spread editorConfig into new Blok(...) and pass viewSchema to the view functions — this guarantees documents are displayed under the SAME sanitize composition that produced them, instead of two configs drifting apart. The guarantee is per composition: if you change the inline-tool set at runtime with tools.setInlineToolbar, recompose the schema from the current config. Options that don't participate in schema resolution (link, i18n, data, …) pass through editorConfig untouched.",
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
          "Fold an ordered list of sanitize configs with the editor's exact merge semantics — a later-wins Object.assign (inline tools first, then tunes). Function rules are carried by reference, and rules for the same tag are REPLACED, never deep-merged. This is the same fold defineBlokSchema uses to build viewSchema.baseSanitize, exposed for hand-built lists. Exported from both @bloklabs/core and @bloklabs/core/view.",
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
          "Render to a framework-agnostic JSON tree instead of an HTML string: each node is { tag, attrs, children } or { text }, with the same options and sanitization pipeline as blocksToHtml. This is what the React bindings map to real elements. Experimental — the shape is not frozen until a second framework adapter consumes it, so it may change in a minor release.",
        example: `import { blocksToViewNodes } from '@bloklabs/core/view';

const nodes = blocksToViewNodes(savedData);
// → [{ tag: 'p', attrs: {}, children: [{ text: 'Hello' }] }]`,
      },
      {
        name: "BlokView",
        returnType: "ReactNode",
        description:
          "The React display component from @bloklabs/react: renders a saved document inside a single <div> wrapper — no editor instance, no chrome, no async, no effects, and never dangerouslySetInnerHTML (content is mapped from the sanitized view tree to real React elements). The wrapper always carries data-blok-interface=\"view\", which is what makes the emitted classes compute as they do in the editor; it is written BEFORE the divProps spread, so a caller can override it — never to \"blok\", which carries all: initial !important and would block host typography. This is the obvious read-only path — reach for it instead of <BlokEditor readOnly> at display-only call sites: it costs no editor bundle, has no ready latch, and renders identically under SSR. Its props API is stable; only the raw ViewNode tree it maps from (via blocksToViewNodes) stays experimental, and using BlokView never exposes you to it.",
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
            description: "viewSchema from defineBlokSchema — display under the composition that produced the document.",
          },
          {
            name: "renderers",
            type: "Record<string, (data, ctx) => string>",
            required: false,
            description: "Custom per-tool renderers; win over the built-ins.",
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
            description: "URL rewrite hook for block URLs + inline anchors, run before the unsafe-scheme strip. Forwards to blocksToHtml.",
          },
          {
            name: "classes",
            type: "boolean",
            required: false,
            default: "true",
            description: "Render with the editor's presentational classes and the per-block holder → content scaffolding, so the output matches a read-only editor render. On by default here — this component owns a wrapper and its job is to look like the editor — and it needs @bloklabs/core/view.css imported to paint. Pass classes={false} for unstyled semantic markup.",
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
          "The wrapper-free form of BlokView: returns a Fragment of the block elements with no extra <div>, for slots where a wrapper is invalid or unwanted — checkbox labels, table cells, headings. Synchronous and effect-free (SSR-safe), memoized on the data reference and the individual option values. Same options as blocksToHtml, except root — which the hook ignores, since emitting no wrapper is its contract — and classes, which defaults to false here (it defaults to true in <BlokView>, which owns a wrapper). Passing root: true type-checks and silently does nothing; wrap the returned Fragment yourself in an element carrying data-blok-interface=\"view\" when you need view.css to paint.",
        example: `import { useBlokView } from '@bloklabs/react';

function RowLabel({ saved }: { saved: OutputData }) {
  const content = useBlokView(saved, { schema: schema.viewSchema });
  return <label>{content}</label>;
}`,
      },
    ],
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
