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
      "The main editor class that initializes and manages the Blok editor instance.",
    methods: [
      {
        name: "save()",
        returnType: "Promise<OutputData>",
        description:
          "Extracts the current editor content as structured JSON data. This is the primary method for persisting editor content.",
        example: `// Save editor content
const data = await editor.save();
console.log(data.blocks); // Array of block data`,
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
        description: "Removes all blocks from the editor.",
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
    ],
    properties: [
      {
        name: "isReady",
        type: "Promise<Blok>",
        description: "Promise that resolves with the ready editor instance",
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
          "Available block and inline tools. Per-tool `toolbox: false` keeps a tool registered (existing blocks still render, blocks.insert() still works) while removing it from every user-insertion path — the + / slash menu, the convert menu, and its keyboard shortcut. Useful for permission gating — and flippable at runtime via `tools.update(name, { toolbox })` (the React adapter applies changes to the `tools` prop's `toolbox` values automatically), so a permission change never requires recreating the editor.",
      },
      {
        option: "placeholder",
        type: "string | false",
        default: "false",
        description:
          "Placeholder text shown in the first block when the editor is empty; false disables it",
      },
      {
        option: "minHeight",
        type: "number",
        default: "300",
        description:
          "Height in px of the editor's bottom clickable zone",
      },
      {
        option: "defaultBlock",
        type: "string",
        default: "'paragraph'",
        description: "Default block type",
      },
      {
        option: "data",
        type: "OutputData | LooseOutputData",
        default: "undefined",
        description:
          "Initial data to render. The loose wire shape is accepted: `null` values for block `data`, `id`, or `time` (common in backend DTOs) are normalized at the boundary.",
      },
      {
        option: "readOnly",
        type: "boolean | { hideControls: boolean }",
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
          "Fires when Enter is pressed in a block, before Blok splits it or creates a new one. Return true to mark it handled — Blok suppresses its default block split/create (the native newline is still prevented). Never fires for Shift+Enter, tools with enableLineBreaks, or while a popover/toolbar owns Enter. Ideal for chat inputs (\"Enter sends\") — pair with the paragraph tool's preserveBlank config instead of subclassing Paragraph.",
      },
      {
        option: "autofocus",
        type: "boolean",
        default: "false",
        description:
          "If true, sets the caret in the first block once the editor is ready",
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
        option: "theme",
        type: "'auto' | 'light' | 'dark'",
        default: "'auto'",
        description:
          "Color theme; 'auto' follows the OS preference via prefers-color-scheme",
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
        name: "blocks.getChildren(parentId)",
        returnType: "BlockAPI[]",
        description: "Get all child blocks of a parent container block.",
        example: `const children = editor.blocks.getChildren('parent-block-id');
children.forEach(child => {
  console.log('Child:', child.id);
});`,
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
            description: "Tool config for this block instance.",
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

// Set to end of first block with offset
editor.caret.setToFirstBlock('end', 5);`,
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
            description: "Character offset from position within the target input.",
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
        description: "Emit a custom event.",
        example: `editor.emit('custom-event', { message: 'Hello', data: 123 });

// Listen to custom events
editor.on('custom-event', (data) => {
  console.log(data.message); // 'Hello'
});`,
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
        example: `// Clear history when loading new content
editor.blocks.render(newData);
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
        description: "Alias for the main save() method.",
        example: `const data = await editor.saver.save();
// Returns: { version, time, blocks }`,
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
      "Range-aware inline-mark operations for building inline formatting tools. Where selection.findParentTag only inspects the selection's anchor node, api.marks operates on the WHOLE range: has answers \"is every text node in the selection covered\", apply and remove split partially-covered wrappers at the range boundaries, update fully-covering wrappers in place, and restore the selection afterwards — and apply and remove extend the range over trailing whitespace browsers exclude from double-click selections. A mark is described declaratively by a MarkSpec (tag, aliasTags, className, attributes, style); aliasTags lets legacy tag variants (e.g. <b> next to <strong>, <em> next to <i>) match as the SAME mark while new wrappers always use the canonical tag. String values are static and participate in the mark's identity; function-form values are resolved from the state passed to apply/toggle and are deliberately EXCLUDED from identity — that is what makes a colour picker ONE mark updating in place rather than N mutually-cancelling marks. Two specs sharing tag, classNames and static attributes belong to the same family and compose on a single element — e.g. a text-colour spec and a background-colour spec both on one <mark>. Every method defaults to the live selection's first range when no range is passed. The core export markSanitizerConfig(spec) derives the sanitizer rule a mark produces — allowlist the spec's tag, strip style properties and classes the spec does not declare, keep declared attributes, with function-form values handled by property name so dynamic values are never dropped on save. The React adapter's createReactInlineTool applies the same derivation automatically when a tool declares a mark spec.",
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
          "Whether every text node in the range is inside a wrapper matching the spec — whitespace-only text nodes are ignored, and at a collapsed caret the caret's ancestors are checked. Unlike selection.findParentTag (anchor node only), a selection that only partially carries the mark reports false.",
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
          "Wrap the range in the mark, or update matching wrappers in place. Splits partially-covered same-family wrappers at the range boundaries, extends the range over trailing whitespace browsers exclude from double-click selections, and leaves the new contents selected. Returns the created or updated wrapper elements.",
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
          "Remove the spec's declared properties and classes from wrappers in the range, unwrapping wrappers left bare. Partially-covered wrappers are split so text outside the range keeps its formatting, and the selection is restored. Returns the wrappers that survived because they still carry other properties.",
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
          "remove when the range already carries the mark, apply otherwise. Returns the resulting state: true when the mark is now applied.",
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
      "Access CSS class names for styling custom tools and UI elements, and customize the editor's layout and chrome via public CSS custom properties. The primary way to override theme tokens is `style.tokens` in the Blok constructor config — pass `--blok-*` keys and values and Blok injects a per-instance stylesheet that reaches the editor AND UI portaled to `document.body` (popovers, tooltips, top-layer elements) automatically; invalid keys are skipped with a warning, and the stylesheet is removed on destroy. Injected `style.tokens` values are static per application — they apply identically in light and dark themes and across read-only state, so state-dependent tokens like the editor gutter belong in CSS instead; `style.tokens` ignores `--blok-editor-gutter-*` keys with a warning. They are not, however, frozen at construction: `editor.tokens.set(tokens)` rewrites the injected stylesheet at runtime, which is what a host light/dark toggle needs — without it, flipping a token meant recreating the editor or hand-writing a global stylesheet targeting the portal scopes yourself. `set()` takes the complete token set (replace, not merge), mirroring `style.tokens`, so tokens omitted from the new palette stop applying and `{}` removes the stylesheet; `editor.tokens.get()` returns what is currently applied. The API is available synchronously after construction (calls before `isReady` are buffered and replayed), and the React/Vue/Angular adapters drive it reactively — pass `style={{ tokens }}` (React/Vue) or `[styleTokens]` (Angular) and changes sync in place without recreating the editor. As a CSS-only alternative, Blok's own palette is declared at zero specificity via `:where()`, so a single plain selector like `[data-blok-interface] { --blok-popover-bg: … }` wins regardless of stylesheet order — but since popovers portal to `document.body`, that global stylesheet must also target `[data-blok-popover], [data-blok-top-layer]` to reach them. `--blok-content-max-width` stays authoritative in both width modes — `width='full'` only swaps its fallback to `none`. Blok reserves 56px of gutter automatically in edit mode for the floating +/⠿ block controls, and the wrapper carries `data-blok-readonly` while read-only is active. Plain read-only KEEPS the gutter — the block-hover copy-link control lives there, and `readOnly.set()` flips modes in place, so collapsing it would shift the document sideways on every toggle. The gutter collapses to 0 automatically only when it is genuinely dead space: chromeless read-only (`readOnly: { hideControls: true }`, wrapper carries `data-blok-controls-hidden`) and `hideToolbar: true` in the constructor config — the hover toolbar never opens and the wrapper carries `data-blok-toolbar-hidden`, so no gutter space is reserved. `--blok-editor-gutter-start` is an override hook, not a required incantation — set it to any value (including `0px` to remove the gutter) to change the default. The gutter override contract is guaranteed, not incidental: Blok declares the gutter default and both state collapses at zero specificity via `:where()` (enforced by a unit contract test), so a host declaration of the gutter tokens at any positive specificity always wins the cascade. Declare them on the wrapper element itself (e.g. `[data-blok-interface] { --blok-editor-gutter-start: 16px }`), not only on an ancestor — the controls-hidden and toolbar-hidden collapses re-declare the tokens on the wrapper, and custom properties resolve from the nearest declaration, so an ancestor-level value loses to the collapse while a wrapper-level one survives it. The content column's horizontal position is also configurable at the API level via `style.contentAlign?: 'left' | 'center' | 'right'` (default `'left'`) in the Blok constructor config. Blok also repaints native text selection inside the editor with `--blok-selection-inline` — override that token to recolor it, or pass `style.nativeSelection: true` (default `false`) to opt out entirely and fall back to the browser/host-defined selection colors (a token override cannot express CSS-wide keywords like `revert`, so reverting needs this flag). With the flag on, the wrapper carries `data-blok-native-selection`, Blok's `::selection` rules skip the editor, and the fake-background highlight (shown while a menu input holds focus) follows the UA `Highlight` color; popovers keep Blok's selection color. Background surfaces are public tokens too: most hover/light UI surfaces follow `--blok-bg-light`, media empty-state cards use `--blok-bg-secondary` (bordered by `--blok-border-secondary`), and the image/file loading skeletons and upload placeholders use `--blok-bg-tertiary`, which defaults to `--blok-bg-light` so it tracks the theme — recoloring the skeleton surface means overriding `--blok-bg-tertiary` directly, not overloading `--blok-bg-light` and dragging every other surface along with it. Like all palette-backed color tokens, the surface tokens are re-declared by Blok on the editor wrapper at zero specificity, so apply overrides via `style.tokens` / `editor.tokens.set()` or a CSS selector matching the wrapper (`[data-blok-interface]`) itself — a custom-property declaration on an ancestor container is shadowed by the wrapper's own declaration and silently does nothing (layout hooks such as `--blok-content-max-width` and the list, heading, embed, block-padding and placeholder-color tokens are instead read with fallbacks and never declared by Blok, which is why those DO inherit from any ancestor; the gutter tokens and `--blok-search-input-placeholder` are wrapper-declared like the palette, so they too need a wrapper-level rule). Also note the injected token stylesheets target Blok's scope attributes globally: with several editor instances on one page, each instance's `style.tokens` / `tokens.set()` stylesheet applies to ALL Blok UI on the page, not just its own instance (each is removed when its own instance is destroyed; where sets conflict between instances the stylesheet order in `<head>` — not application recency — decides, so give every instance one shared set instead of relying on conflict order) — scope per-instance differences with a CSS rule on each editor's own wrapper instead (body-mounted popover UI always follows the page-wide sheets). The sheets are injected at the start of `<head>`, so a host stylesheet rule of equal specificity — a plain `[data-blok-interface] { … }` — still beats `style.tokens` for the tokens it declares. Block rhythm is public too: `--blok-block-padding-top`, `--blok-block-padding-bottom` and `--blok-block-padding-inline` drive the padding of every block tool wrapper (paragraph, heading, list, toggle, quote, callout). Each tool keeps its historical value as the fallback — 7px/7px/2px for most blocks, 0.2em vertical for quotes, 5px vertical for callouts — so one override retunes all blocks at once, which is exactly what a read-only host needs for tight inline-style rendering (previously only possible by overriding `[data-blok-tool]` internals). Note that non-default padding slightly shifts derived geometry such as the toggle-heading arrow offset, which follows `--blok-block-padding-top`.",
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
     vertical, callouts to 5px). Tighten all three for compact read-only
     inline rendering — no need to override [data-blok-tool]: */
  --blok-block-padding-top: 0;
  --blok-block-padding-bottom: 0.2em;
  --blok-block-padding-inline: 0;

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
        example: `// Standard close (prevents hover reopen — default)
editor.toolbar.close();

// Close but allow the toolbar to reopen on hover
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

// Anchor the settings popover to a custom trigger element,
// placed to the left of the anchor
editor.toolbar.toggleBlockSettings(true, triggerEl, { placeLeftOfAnchor: true });`,
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
              "Placement overrides — `placeLeftOfAnchor` positions the popover to the left of the anchor.",
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
    description: "Display notification messages to users.",
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
// → renders a toast in the corner of the editor; returns nothing to await

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
            description: "Built-in visual style for alert notifications.",
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
            default: "'Confirm' / 'Ok'",
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
            default: "'Cancel'",
            description: "Label for the cancel button (confirm type only).",
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
            resolution: "show() never throws or rejects — check the browser console, since the failure is logged rather than propagated to your call site.",
          },
        ],
      },
    ],
  },
  {
    id: "sanitizer-api",
    badge: "Sanitizer",
    title: "Sanitizer API",
    description: "Clean and sanitize HTML content to prevent XSS attacks.",
    methods: [
      {
        name: "sanitizer.clean(taintString, config)",
        returnType: "string",
        description:
          "Clean HTML string using the provided sanitizer configuration.",
        example: `const dirtyHtml = '<script>alert("xss")</script><p>Hello</p>';
const clean = editor.sanitizer.clean(dirtyHtml, {
  p: true,  // Allow <p> tags
  b: true   // Allow <b> tags
});
// Returns: '<p>Hello</p>' (script tag removed)`,
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
        description: "Show tooltip on hover using event listeners.",
        example: `const button = document.querySelector('button');
editor.tooltip.onHover(button, 'Click me', {
  placement: 'bottom'
});`,
      },
    ],
  },
  {
    id: "readonly-api",
    badge: "ReadOnly",
    title: "ReadOnly API",
    description:
      "Control the read-only state of the editor. Toggling is in-place: the same editor instance flips modes, preserving caret position, undo history and scroll — so an edit/view toggle is `readOnly.set(!isEditing)` on ONE instance instead of destroying one editor and constructing another.",
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
          "Set read-only mode to the specified boolean state. The toggle happens in place — no destroy/recreate: block instances, caret position, undo history and scroll are preserved. Pass `{ hideControls: true }` to also hide the hover toolbar, block settings and inline toolbar while read-only is active — the option writes the object form of `config.readOnly`, so the live state reflects it. Returns the new state.",
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
            default: "false",
            description:
              "Hide all editor controls (hover toolbar, block settings popover, inline toolbar) while read-only is active.",
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
          "Observability constant: always true — `readOnly.set()` flips the mode in place, preserving block instances, caret, undo history and scroll, instead of recreating the editor. Assert on it before relying on in-place toggle semantics.",
      },
    ],
  },
  {
    id: "i18n-api",
    badge: "I18n",
    title: "I18n API",
    description:
      "Internationalization support for translating UI strings, plus the runtime `i18n.update()` mutator that switches language in place.",
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
          "Get the text direction currently in effect \u2014 derived from the active locale unless an explicit `direction` override was set.",
        example: `if (editor.i18n.getDirection() === 'rtl') {
  // mirror your own chrome next to the editor
}`,
      },
      {
        name: "i18n.update({ locale?, messages?, direction? })",
        returnType: "Promise<void>",
        description:
          "Switch language at runtime. `config.i18n` is otherwise read once during boot, so a host with a language switcher had to recreate the editor to relabel it \u2014 losing caret, focus, selection and undo history. `update()` relabels in place instead: no recreation, nothing lost. `locale` accepts any supported code or `'auto'` to re-run browser detection; `messages` merges host overrides over the locale dictionary and is re-applied automatically after every later locale change (a bare locale flip never silently drops your custom strings); `direction` overrides the direction implied by the locale, which you normally do not need. Calls are serialized internally, so lazily-loaded locale chunks cannot land out of order \u2014 the last call wins. Scope: everything. Chrome built on demand (block settings, the convert menu, notifications, screen-reader announcements) picks up the new locale the next time it opens; the eagerly-stamped chrome (toolbar and plus-button labels, tooltips, the toolbox list) is relabelled immediately; and block content \u2014 placeholders, media-toolbar labels, cell controls, anything a tool resolved while rendering \u2014 is repainted from your data, including tools that know nothing about locale changes. The repaint is invisible to you: `onChange` does not fire, scroll is kept, and the caret returns to the block that had it. Fires the `i18n:changed` event with `{ locale, direction }`. Available synchronously after construction \u2014 a call made before `isReady` is applied once the editor has booted. `update()` is exposed on the editor instance only, not on the `api.i18n` handed to tools, so a third-party tool cannot flip the host's locale. The React/Vue/Angular adapters drive it reactively: change the `i18n` prop/input and the editor follows in place. Note `defaultLocale` is not accepted \u2014 it only decides the fallback while resolving the initial locale.",
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
        description: "Get all available block tool instances.",
        example: `const blockTools = editor.tools.getBlockTools();
blockTools.forEach(tool => {
  console.log('Available tool:', tool.name);
});`,
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
        name: "equalsOutputData(a, b)",
        returnType: "boolean",
        description:
          "Structural equality for saved documents, exported from the main entry. Compares the `blocks` arrays deeply; the volatile `time` and `version` envelope fields are ignored, so a document round-tripped through save() compares equal to its echo. Block ids participate only when BOTH sides carry one: the editor mints fresh ids for id-less content, so a legacy document (or a backend that strips ids) still compares equal to its saved echo — no id-stripping wrapper needed on the consumer side. Nullish documents and loose wire shapes are accepted — `null`/`undefined` compares equal to `{ blocks: [] }`.",
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
      "The all-in-one editor component shipped by the framework adapters — <BlokEditor> in @bloklabs/react and @bloklabs/vue, <blok-editor> (BlokEditorComponent) in @bloklabs/angular. It accepts every editor config option as a prop, forwards unknown props to the container div, and exposes the live Blok instance via ref/onReady. The props below cover the adapter-specific surface; everything else matches the Configuration options.",
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
    table: [
      {
        option: "tools",
        type: "Record<string, ToolConstructable | ToolSettings>",
        default: "—",
        description:
          "Block tools to register. Functions anywhere inside a tool's config (e.g. an uploader callback) are re-bound to the latest render automatically — pass inline closures freely; only tool classes changing requires a deps entry.",
      },
      {
        option: "data",
        type: "OutputData",
        default: "—",
        description:
          "Editor content (reactive). Seeds the initial document; after mount, new content — including transitions to and from empty content — re-renders in place on the same instance (never recreates the editor). Updates are deep-equal–deduped, so echoing the editor's own output back never clobbers the caret.",
      },
      {
        option: "onSave",
        type: "(data: OutputData, api: API) => void",
        default: "—",
        description:
          "The output half of the controlled component: fires (debounced) with the full serialized document on every content change — no manual save() polling. Wiring onSave={setData} is safe and recursion-free.",
      },
      {
        option: "onChange",
        type: "(api: API, event: CustomEvent) => void",
        default: "—",
        description:
          "Low-level mutation events (block added/changed/moved/removed), for when you need per-mutation granularity instead of serialized output.",
      },
      {
        option: "onReady",
        type: "(editor: Blok) => void",
        default: "—",
        description:
          "Called with the live Blok instance, exactly once per editor instance. Fires after the forwarded ref commits, so ref.current is also populated. The editor is recreated (and onReady re-fired) only when deps change or the component remounts — data changes, including to/from empty content, re-render in place and never re-fire it.",
      },
      {
        option: "deps",
        type: "DependencyList",
        default: "[]",
        description:
          "Values that destroy and recreate the editor when their identity changes (for structural config like tool classes). Keep each value referentially stable. Functions inside tool configs do NOT belong here — they are re-bound to the latest render automatically.",
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
        description: "Called with the resolved theme whenever it changes (e.g. when 'auto' follows the OS).",
      },
      {
        option: "width",
        type: "'narrow' | 'full'",
        default: "'narrow'",
        description: "Content width mode (reactive). Synced after mount via editor.width.set().",
      },
      {
        option: "style",
        type: "BlokConfig['style']",
        default: "—",
        description:
          "Styling config. `style.tokens` is reactive: changed `--blok-*` overrides sync in place after mount via editor.tokens.set() (deep-equal deduped), so a host light/dark toggle needs no remount. Replace semantics — pass the whole palette; tokens dropped from it stop applying. Angular exposes this as the separate [styleTokens] input.",
      },
      {
        option: "i18n",
        type: "BlokConfig['i18n']",
        default: "—",
        description:
          "Internationalization config (reactive). A changed `locale`, `messages` or `direction` syncs in place after mount via editor.i18n.update() (deep-equal deduped), so a language switcher relabels the editor without remounting it \u2014 caret, focus, selection and undo history survive. `defaultLocale` is the exception and is read only at construction. Angular exposes this as the [i18n] input.",
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
        description: "Placeholder shown in the first empty block.",
      },
      {
        option: "onBlocksRendered",
        type: "(payload: BlocksRenderedPayload) => void",
        default: "—",
        description:
          "Called after a batch render completes (core blocks:rendered event) — the declarative analog of editor.on('blocks:rendered', …).",
      },
      {
        option: "onBlockRendered",
        type: "(payload: BlockRenderedPayload) => void",
        default: "—",
        description: "Called for each block rendered into the DOM (core block:rendered event).",
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
      "A reactive snapshot of the block tree plus a full manipulation API, from the framework adapters: the useBlocks(editor) hook in @bloklabs/react, the useBlocks(editor) composable in @bloklabs/vue, and injectBlocks() in @bloklabs/angular. Reads re-render reactively as the document changes; writers are atomic (one undo step) and safe to call before the editor is ready (they no-op). Returned BlockNode objects ({ id, type, parentId, contentIds }) are fresh-snapshot volatile — read them now, don't stash them in dep arrays.",
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
          "Insert one block (type, data, parentId, position, focus/caret). Returns the created node, or null when rejected (unknown tool, dangling parentId). An explicit id that already exists is insert-if-absent. Atomic — one undo step.",
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
        name: "scrollToBlock(id)",
        returnType: "void",
        description:
          "Scroll a block into view, select it, pulse the arrival highlight and announce the navigation to assistive tech — the public counterpart of the boot-time URL-hash scroll. No-op when no block with that id is in the document. Framework adapters that mount into a detached holder (React/Vue/Angular) render seeded content before it joins the page, so the boot hash scroll defers; @bloklabs/react drains it automatically once the holder connects — call this yourself for deep-linking after the editor is ready.",
        example: `blocks.scrollToBlock(nodeId);`,
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
    lastUpdated: "2026-07-22",
    description:
      "Display saved documents without paying for an editor. The @bloklabs/core/view subpath renders OutputData to semantic HTML or plain text synchronously and DOM-free — it runs in Node, workers, and React Server Components — so display-only surfaces (published pages, previews, search indexing, emails) no longer need an editor instance, its bundle, or its async ready latch. Every inline-content field is sanitized against the composed allowlist before interpolation, with a URL scheme policy identical to the editor's; pair the functions with defineBlokSchema and documents are displayed under the same sanitize composition that produced them (if you later change the inline-tool set at runtime via tools.setInlineToolbar, recompose the schema so the view keeps up). For React, @bloklabs/react ships <BlokView> and useBlokView, which replace <BlokEditor readOnly> at display-only call sites.",
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
              "viewSchema from defineBlokSchema. Its per-tool sanitize allowlist merges over the default inline allowlist, so documents display under the composition that produced them.",
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
        example: `import { blocksToPlainText } from '@bloklabs/core/view';

// A 160-character preview for a card or meta description
const preview = blocksToPlainText(savedData).slice(0, 160);`,
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
          "The React display component from @bloklabs/react: renders a saved document inside a single <div> wrapper — no editor instance, no chrome, no async, no effects, and never dangerouslySetInnerHTML (content is mapped from the sanitized view tree to real React elements). Use it instead of <BlokEditor readOnly> at display-only call sites: it costs no editor bundle, has no ready latch, and renders identically under SSR.",
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
            name: "className",
            type: "string",
            required: false,
            description: "Class for the single wrapper div.",
          },
        ],
        example: `import { BlokView } from '@bloklabs/react';
import { schema } from './schema';

export function Article({ saved }: { saved: OutputData }) {
  return <BlokView data={saved} schema={schema.viewSchema} className="prose" />;
}`,
      },
      {
        name: "useBlokView(data, options?)",
        returnType: "ReactNode",
        description:
          "The wrapper-free form of BlokView: returns a Fragment of the block elements with no extra <div>, for slots where a wrapper is invalid or unwanted — checkbox labels, table cells, headings. Synchronous and effect-free (SSR-safe), memoized on the data reference and the individual option values. Same options as blocksToHtml.",
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
