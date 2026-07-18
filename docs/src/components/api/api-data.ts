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
        description: "Renders editor content from previously saved JSON data.",
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
    ],
    properties: [
      {
        name: "isReady",
        type: "Promise<Blok>",
        description: "Promise that resolves with the ready editor instance",
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
    description: "The configuration object passed to the Blok constructor.",
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
          "Available block and inline tools. Per-tool `toolbox: false` keeps a tool registered (existing blocks still render, blocks.insert() still works) while removing it from every user-insertion path — the + / slash menu, the convert menu, and its keyboard shortcut. Useful for permission gating.",
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
        type: "OutputData",
        default: "undefined",
        description: "Initial data to render",
      },
      {
        option: "readOnly",
        type: "boolean | { hideControls: boolean }",
        default: "false",
        description:
          "Enable read-only mode. Pass `{ hideControls: true }` to also hide the hover toolbar, block settings, and inline toolbar.",
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
          "Default inline toolbar for all tools; an array restricts it to the listed inline tools, false disables it",
      },
      {
        option: "i18n",
        type: "I18nConfig",
        default: "undefined",
        description:
          "Internationalization config (locale + message dictionary). Custom tool titles are localizable by registration name — e.g. a `fileLink` tool via `messages: { 'toolNames.fileLink': '…' }` — or via a `titleKey` in the tool's toolbox entry.",
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
        description: "Render passed JSON data as blocks.",
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
            type: "OutputBlockData[]",
            required: true,
            description: "The blocks to insert.",
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
    id: "styles-api",
    badge: "Styles",
    title: "Styles API",
    description:
      "Access CSS class names for styling custom tools and UI elements, and customize the editor's layout and chrome via public CSS custom properties. Theme overrides need only a single plain selector — Blok's own palette is declared at zero specificity via `:where()`, so `[data-blok-interface] { --blok-popover-bg: … }` wins regardless of stylesheet order; popovers portal to `document.body`, so put theme overrides in a global stylesheet targeting `[data-blok-interface], [data-blok-popover], [data-blok-top-layer]`. `--blok-content-max-width` stays authoritative in both width modes — `width='full'` only swaps its fallback to `none`. The wrapper carries `data-blok-readonly` while read-only is active and the gutter collapses automatically, so set `--blok-editor-gutter-start` once and never toggle it from JS. The content column's horizontal position is also configurable at the API level via `style.contentAlign?: 'left' | 'center' | 'right'` (default `'left'`) in the Blok constructor config.",
    example: `// Customize the editor from your host app via CSS custom properties —
// no need to target Blok's internal test IDs or data attributes.
.my-editor-container {
  /* Cap the content column at a custom width (default: 720px) */
  --blok-content-max-width: 650px;

  /* Reserve space inside the editor for the floating +/⠿ block
     controls so they never overflow your container (default: 0px) */
  --blok-editor-gutter-start: 56px;
  --blok-editor-gutter-end: 16px;

  /* Extra start padding on list blocks (default: 0px) */
  --blok-list-padding-start: 18px;

  /* Gap between a list marker/checkbox and its content (default: 0px) */
  --blok-list-gap: 6px;

  /* Placeholder color of popover search inputs */
  --blok-search-input-placeholder: rgba(112, 118, 132, 0.8);

  /* Heading typography (defaults mirror the built-in scale) */
  --blok-heading-1-font-size: 32px;
  --blok-heading-font-weight: 600;
  --blok-heading-margin-top: 16px;
  --blok-heading-margin-bottom: 16px;

  /* Space above embed blocks (default: 0px) */
  --blok-embed-margin-top: 16px;
}

// Theme overrides only need a plain host selector — Blok's palette is
// declared at zero specificity via :where(), so this always wins.
// Popovers/menus portal to document.body, so target them explicitly too.
[data-blok-interface],
[data-blok-popover],
[data-blok-top-layer] {
  --blok-popover-bg: #1a1a1a;
}

// The wrapper carries data-blok-readonly while read-only is active, and
// the gutter collapses automatically — no JS toggling needed.
[data-blok-readonly] {
  --blok-editor-gutter-start: 0px;
}

// Center the content column instead of left-aligning it (default: 'left')
const editor = new Blok({
  holder: 'editor',
  style: { contentAlign: 'center' },
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
    description: "Control the read-only state of the editor.",
    methods: [
      {
        name: "readOnly.set(state)",
        returnType: "Promise<boolean>",
        description: "Set read-only mode to the specified boolean state. Returns the new state.",
        example: `// Enable read-only
await editor.readOnly.set(true);

// Disable read-only
await editor.readOnly.set(false);

// Check state
console.log(editor.readOnly.isEnabled); // true or false`,
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
    ],
  },
  {
    id: "i18n-api",
    badge: "I18n",
    title: "I18n API",
    description: "Internationalization support for translating UI strings.",
    methods: [
      {
        name: "i18n.t(dictKey)",
        returnType: "string",
        description: "Translate a key from the global dictionary.",
        example: `const text = editor.i18n.t('toolNames.text');
console.log(text); // 'Text' (or translated string)

const deleteText = editor.i18n.t('blockSettings.delete');`,
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
    ],
  },
  {
    id: "output-data",
    badge: "Data",
    title: "OutputData",
    description: "The data structure returned by the save() method.",
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
          "Editor content (reactive). Seeds the initial document; after mount, new content re-renders in place. Updates are deep-equal–deduped, so echoing the editor's own output back never clobbers the caret.",
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
          "Called once with the live Blok instance. Fires after the forwarded ref commits, so ref.current is also populated at this point.",
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
          "Forwarded to the live Blok instance for imperative calls (save, render, blocks, caret, …). Null until the editor mounts.",
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
