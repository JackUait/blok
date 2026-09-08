// docs/src/components/tools/tools-data.ts

export type ToolType = 'block' | 'inline';

export interface ToolConfigOption {
  option: string;
  type: string;
  default: string;
  description: string;
}

export interface ToolSection {
  id: string;          // e.g. 'paragraph' — used as anchor and testid
  exportName: string;  // exact export name in src/tools/index.ts
  type: ToolType;
  title: string;
  description: string;
  importExample: string;
  configOptions: ToolConfigOption[];
  saveDataShape: string;   // TypeScript interface as code string
  saveDataExample: string; // JSON example as code string
  usageExample: string;
}

export const TOOL_SECTIONS: ToolSection[] = [
  // ── Block Tools ───────────────────────────────────────────────────────────
  {
    id: 'paragraph',
    exportName: 'Paragraph',
    type: 'block',
    title: 'Paragraph',
    description:
      'The default text block. It supports rich inline formatting: bold, italic, links and colour. Empty top-level paragraphs are left out of the saved output unless `preserveBlank` is enabled. Empty paragraphs nested inside another block (callout, toggle, column, …) are always kept.',
    importExample: `import { Paragraph } from '@bloklabs/core/tools';`,
    configOptions: [
      {
        option: 'placeholder',
        type: 'string',
        default: '"Write something or press / to select a tool" (localised)',
        description: 'Placeholder text shown when the block is empty and focused.',
      },
      {
        option: 'preserveBlank',
        type: 'boolean',
        default: 'false',
        description:
          'When true, empty paragraph blocks are kept in the saved output. There is one exception. A document that holds a single empty block of the default tool always saves as `blocks: []`, whatever this option says.',
      },
      {
        option: 'styles.size',
        type: 'string',
        default: 'undefined',
        description: 'Custom CSS font-size override (e.g. "18px", "1.25rem").',
      },
      {
        option: 'styles.lineHeight',
        type: 'string',
        default: 'undefined',
        description: 'Custom CSS line-height override (e.g. "1.8", "28px").',
      },
      {
        option: 'styles.marginTop',
        type: 'string',
        default: 'undefined',
        description: 'Custom CSS margin-top override (e.g. "12px", "0.75rem").',
      },
      {
        option: 'styles.marginBottom',
        type: 'string',
        default: 'undefined',
        description: 'Custom CSS margin-bottom override.',
      },
    ],
    saveDataShape: `interface ParagraphData {
  text: string;             // HTML string (may include <b>, <i>, <a>, <mark>)
  textColor?: string;       // Block colour preset, present when set
  backgroundColor?: string; // Block background colour preset, present when set
}`,
    saveDataExample: `{
  "id": "abc123",
  "type": "paragraph",
  "data": {
    "text": "Hello <b>world</b>"
  }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Paragraph } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    paragraph: {
      class: Paragraph,
      placeholder: 'Start writing…',
      preserveBlank: false,
    },
  },
});`,
  },
  {
    id: 'header',
    exportName: 'Header',
    type: 'block',
    title: 'Header',
    description:
      'Heading blocks from H1 to H6. It supports several toolbox entries, one per heading level, and keyboard shortcuts (# ## ### etc.).\n\nEvery level also has an optional toggle that collapses and expands its children. The toolbox lists "Toggle heading 1" through "Toggle heading 6", reachable with the markdown shortcuts `>#` through `>######`.\n\nConverting an existing block into a toggle heading adopts its section: use "Turn into" or `blocks.convert` with `isToggleable: true`. Every following sibling becomes a child of the new toggle, up to the next heading of the same or higher rank. This matches Notion.',
    importExample: `import { Header } from '@bloklabs/core/tools';`,
    configOptions: [
      {
        option: 'placeholder',
        type: 'string',
        default: 'level name (e.g. "Heading 2", localised)',
        description: 'Placeholder text shown in an empty heading block.',
      },
      {
        option: 'levels',
        type: 'number[]',
        default: '[1,2,3,4,5,6]',
        description: 'Restrict which heading levels are available.',
      },
      {
        option: 'defaultLevel',
        type: 'number',
        default: '2',
        description: 'The heading level used when inserting a new header block.',
      },
      {
        option: 'levelOverrides',
        type: 'Record<number, { tag?, name?, size?, marginTop?, marginBottom? }>',
        default: '{}',
        description: 'Per-level overrides for HTML tag, display name, or CSS values.',
      },
      {
        option: 'shortcuts',
        type: 'Record<number, string>',
        default: 'undefined',
        description:
          'Custom markdown prefixes per heading level. If omitted, the default markdown prefixes (#, ## …) are used. Pass an empty object {} to disable the plain heading prefixes.\n\nThe toggle-heading prefixes (`>#` … `>######`) are matched separately and are always active. You cannot configure or disable them here, and they still respect `levels`.',
      },
      {
        option: 'anchorIds',
        type: 'boolean | (text: string, blockId: string) => string',
        default: 'undefined',
        description:
          'Opt-in text-derived anchor ids on rendered headings.\n\n- true uses the built-in slugifier.\n  - It keeps Unicode letters/digits and letter case, strips punctuation and zero-width chars, and joins words with hyphens, e.g. «Обучайте команду» → id "Обучайте-команду".\n- A function lets you generate ids yourself (empty string = no id).\n\nIds stay in sync on text edits and survive level changes. A heading that carries its own data.anchor keeps that instead. Cross-block duplicate dedup is out of scope, so consumers dedup themselves.',
      },
    ],
    saveDataShape: `interface HeaderData {
  text: string;             // Heading HTML content
  level: number;            // 1–6
  isToggleable?: boolean;   // true when the heading has toggle (collapse/expand)
  isOpen?: boolean;         // Persisted toggle state, present when toggleable
  textColor?: string;       // Block colour preset, present when set
  backgroundColor?: string; // Block background colour preset, present when set
  anchor?: string;          // Anchor id for in-document links, present when set
}`,
    saveDataExample: `{
  "id": "def456",
  "type": "header",
  "data": {
    "text": "Getting Started",
    "level": 2
  }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Header } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    header: {
      class: Header,
      levels: [1, 2, 3],
      defaultLevel: 2,
      placeholder: 'Enter a heading',
    },
  },
});`,
  },
  {
    id: 'list',
    exportName: 'List',
    type: 'block',
    title: 'List',
    description:
      'Bulleted, numbered, and to-do (checklist) lists with unlimited nesting. Each list item is a separate block. The toolbox shows three entries by default, one for each style. You can convert items between styles from the block settings menu.',
    importExample: `import { List } from '@bloklabs/core/tools';`,
    configOptions: [
      {
        option: 'defaultStyle',
        type: '"unordered" | "ordered" | "checklist"',
        default: '"unordered"',
        description: 'The list style used when inserting a new list block.',
      },
      {
        option: 'styles',
        type: 'ListStyle[]',
        default: '["unordered","ordered","checklist"]',
        description: 'Restrict which styles are available in the block settings conversion menu.',
      },
      {
        option: 'toolboxStyles',
        type: 'ListStyle[]',
        default: 'all styles',
        description: 'Restrict which list styles appear as separate toolbox entries.',
      },
      {
        option: 'itemColor',
        type: 'string',
        default: 'undefined',
        description: 'Custom CSS color for list item text (e.g. "#3b82f6").',
      },
      {
        option: 'itemSize',
        type: 'string',
        default: 'undefined',
        description: 'Custom CSS font-size for list items (e.g. "18px", "1.25rem").',
      },
    ],
    saveDataShape: `interface ListData {
  text: string;                                    // Item HTML content
  style: 'unordered' | 'ordered' | 'checklist'; // List type
  checked?: boolean;  // Checklist check state
  start?: number;     // First number for ordered lists (root items only); omitted when 1
  depth?: number;     // Nesting depth; omitted for root items (depth 0)
}`,
    saveDataExample: `{
  "id": "ghi789",
  "type": "list",
  "data": {
    "text": "First item",
    "style": "unordered"
  }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { List } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    list: {
      class: List,
      defaultStyle: 'unordered',
    },
  },
});`,
  },
  {
    id: 'table',
    exportName: 'Table',
    type: 'block',
    title: 'Table',
    description:
      'A full-featured table block. Each cell contains its own block editor. A cell accepts any block type except `header`, `table` and `column_list`, which are always restricted inside cells.\n\nThe tool supports merging and splitting cells. That uses `colspan`/`rowspan`, and covered cells are recorded as `mergedInto`.\n- You also get heading rows, heading columns and column resizing.\n- Cell background and text colours are supported too.\n- So are row and column add and delete controls, and copy and paste.\n\nThe block settings menu holds a text density switch, either compact or comfortable.',
    importExample: `import { Table } from '@bloklabs/core/tools';`,
    configOptions: [
      {
        option: 'rows',
        type: 'number',
        default: '3',
        description: 'Initial number of rows when a new table is inserted.',
      },
      {
        option: 'cols',
        type: 'number',
        default: '3',
        description: 'Initial number of columns when a new table is inserted.',
      },
      {
        option: 'withHeadings',
        type: 'boolean',
        default: 'false',
        description: 'Whether the first row is styled as a heading row by default.',
      },
      {
        option: 'withHeadingColumn',
        type: 'boolean',
        default: 'false',
        description: 'Whether the first column is styled as a heading column by default.',
      },
      {
        option: 'stretched',
        type: 'boolean',
        default: 'false',
        description: 'When true, the table spans the full editor width by default.',
      },
      {
        option: 'restrictedTools',
        type: 'string[]',
        default: '[]',
        description: 'Additional tool names to prevent from being inserted into table cells.',
      },
    ],
    saveDataShape: `interface TableData {
  withHeadings: boolean;       // First row is a heading row
  withHeadingColumn: boolean;  // First column is a heading column
  stretched?: boolean;
  content: CellContent[][];    // 2D array of cell content
  colWidths?: number[];        // Column widths in pixels
  initialColWidth?: number;    // Per-column width in px captured at creation; new columns get initialColWidth / 2
  textSize?: 'compact' | 'comfortable'; // Cell text density; omitted = 'compact' (small text)
}

// Each cell:
interface CellContent {
  blocks: string[];    // IDs of child blocks in this cell
  color?: string;      // Cell background colour
  textColor?: string;  // Cell text colour
  placement?: CellPlacement; // 9-way vertical+horizontal alignment (e.g. 'top-left', 'middle-center')
  colspan?: number;    // Columns this cell spans (origin cells only)
  rowspan?: number;    // Rows this cell spans (origin cells only)
  mergedInto?: [number, number]; // Set when covered by a merge; origin cell at [row, col]
}`,
    saveDataExample: `{
  "id": "jkl012",
  "type": "table",
  "data": {
    "withHeadings": true,
    "withHeadingColumn": false,
    "content": [
      [{ "blocks": ["block1"] }, { "blocks": ["block2"] }],
      [{ "blocks": ["block3"] }, { "blocks": ["block4"] }]
    ]
  }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Table } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    table: {
      class: Table,
      rows: 3,
      cols: 3,
      withHeadings: true,
    },
  },
});`,
  },
  {
    id: 'toggle',
    exportName: 'Toggle',
    type: 'block',
    title: 'Toggle',
    description:
      'A collapsible toggle block with a clickable arrow. Child blocks are nested inside the toggle and hidden when it is collapsed.\n\nYou toggle it by clicking the arrow icon, or programmatically through the public Block API: `api.blocks.getById(id)?.call("expand")` / `.call("collapse")`. Toggle headings (Header blocks with `isToggleable: true`) accept the same two commands. These are string-addressed commands routed through `BlockAPI.call()`. They are not declared as methods on the exported tool classes.\n\nThe open or collapsed state is saved in `isOpen` and restored on reload. Toggles default to open.',
    importExample: `import { Toggle } from '@bloklabs/core/tools';`,
    configOptions: [
      {
        option: 'placeholder',
        type: 'string',
        default: '"Toggle"',
        description: 'Placeholder text shown in an empty toggle block.',
      },
    ],
    saveDataShape: `interface ToggleData {
  text: string;     // Toggle title HTML content
  isOpen?: boolean; // Whether the toggle is expanded — persisted and restored on reload
}`,
    saveDataExample: `{
  "id": "mno345",
  "type": "toggle",
  "data": {
    "text": "Click to expand"
  }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Toggle } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    toggle: {
      class: Toggle,
      placeholder: 'Toggle heading…',
    },
  },
});`,
  },

  {
    id: 'callout',
    exportName: 'Callout',
    type: 'block',
    title: 'Callout',
    description:
      'A container block for highlighted content with an emoji icon. It supports customisable text and background colours via a colour picker. In the emoji picker, category buttons show their names after a brief hover or on keyboard focus.\n\nChild blocks are nested inside the callout. It is useful for tips, warnings, notes, and other call-to-action content.\n\nEnter adds a line inside the panel. Pressing it again on the empty last line leaves the callout, so the blank line becomes the paragraph below instead of padding the panel out.',
    importExample: `import { Callout } from '@bloklabs/core/tools';`,
    configOptions: [
      {
        option: 'emojiPicker',
        type: '(onSelect: (emoji: string) => void) => void',
        default: 'undefined',
        description:
          'Custom emoji picker handler that replaces the built-in picker. Call `onSelect` with the chosen emoji, or "" to clear.',
      },
    ],
    saveDataShape: `interface CalloutData {
  emoji: string;             // Emoji character (e.g. "💡")
  textColor: string | null;  // Colour preset name, or null for default
  backgroundColor: string | null; // Colour preset name, or null for default
}`,
    saveDataExample: `{
  "id": "pqr678",
  "type": "callout",
  "data": {
    "emoji": "💡",
    "textColor": null,
    "backgroundColor": "yellow"
  }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Callout } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    callout: {
      class: Callout,
    },
  },
});`,
  },

  {
    id: 'database',
    exportName: 'Database',
    type: 'block',
    title: 'Database',
    description:
      'A multi-view database block supporting board (Kanban) and list views. It stores a schema of typed properties (text, select, multiSelect, date, checkbox, etc.) and view configurations. Rows are stored as child `database-row` blocks.\n\nIt supports grouping, drag-and-drop reordering, inline editing, and an optional backend sync adapter. (`sorts` and `filters` are persisted in the view config but are not applied yet.)',
    importExample: `import { Database } from '@bloklabs/core/tools';`,
    configOptions: [
      {
        option: 'adapter',
        type: 'DatabaseAdapter',
        default: 'undefined',
        description:
          'Optional backend sync adapter for persisting schema, row, and view changes to an external data source.',
      },
    ],
    saveDataShape: `interface DatabaseData {
  title?: string;                      // Database title
  schema: PropertyDefinition[];        // Column definitions (id, name, type, position, config)
  views: DatabaseViewConfig[];         // View configs — only 'board' and 'list' are rendered
                                       // ('table' and 'gallery' exist in the ViewType union
                                       // but fall back to the board renderer)
  activeViewId: string;                // Currently active view ID
}
// Rows are NOT stored here — they are child database-row blocks.`,
    saveDataExample: `{
  "id": "db001",
  "type": "database",
  "data": {
    "title": "Tasks",
    "schema": [
      { "id": "prop1", "name": "Name", "type": "title", "position": "a0" },
      { "id": "prop2", "name": "Status", "type": "select", "position": "a1" }
    ],
    "views": [
      {
        "id": "v1",
        "name": "Board",
        "type": "board",
        "position": "a0",
        "sorts": [],
        "filters": [],
        "visibleProperties": ["prop1", "prop2"]
      }
    ],
    "activeViewId": "v1"
  }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Database, DatabaseRow } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    database: {
      class: Database,
    },
    // Required: the Database tool inserts \`database-row\` blocks for its rows.
    'database-row': {
      class: DatabaseRow,
    },
  },
});`,
  },
  {
    id: 'database-row',
    exportName: 'DatabaseRow',
    type: 'block',
    title: 'Database Row',
    description:
      'An internal block tool that stores a single database row. It is not user-insertable: rows are created and managed by the parent Database block. Each row stores property values that conform to the parent database schema, plus a position string for ordering.',
    importExample: `import { DatabaseRow } from '@bloklabs/core/tools';`,
    configOptions: [],
    saveDataShape: `interface DatabaseRowData {
  properties: Record<string, PropertyValue>; // Column values keyed by property ID
  position: string;                          // Fractional index for ordering
}
// PropertyValue = string | number | boolean | string[] | OutputData | null`,
    saveDataExample: `{
  "id": "row001",
  "type": "database-row",
  "data": {
    "properties": {
      "prop1": "My Task",
      "prop2": "In Progress"
    },
    "position": "a0"
  }
}`,
    usageExample: `// DatabaseRow is not inserted directly — it is created by the Database tool.
// Access row data via the saved output:
import { Database, DatabaseRow } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    database: { class: Database },
    'database-row': { class: DatabaseRow },
  },
});`,
  },

  {
    id: 'divider',
    exportName: 'Divider',
    type: 'block',
    title: 'Divider',
    description:
      'A horizontal line separator. Renders a semantic `<hr>` element. It has no editable content or settings. You can insert it from the toolbox, or by typing `---` in an empty paragraph.',
    importExample: `import { Divider } from '@bloklabs/core/tools';`,
    configOptions: [],
    saveDataShape: `interface DividerData {
  // Empty — dividers have no configurable properties.
}`,
    saveDataExample: `{
  "id": "div001",
  "type": "divider",
  "data": {}
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Divider } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    divider: {
      class: Divider,
    },
  },
});`,
  },

  {
    id: 'spacer',
    exportName: 'Spacer',
    type: 'block',
    title: 'Spacer',
    description:
      'An adjustable vertical gap. To resize it, drag either edge grip, or focus one and press ArrowUp/ArrowDown. Its main job is lining up content across sibling columns of unequal length, so it replaces piles of empty paragraphs. It is invisible in read-only mode.',
    importExample: `import { Spacer } from '@bloklabs/core/tools';`,
    configOptions: [],
    saveDataShape: `interface SpacerData {
  height?: number; // Gap height in px, clamped to 38–600 (default 38)
}`,
    saveDataExample: `{
  "id": "spc001",
  "type": "spacer",
  "data": {
    "height": 120
  }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Spacer } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    spacer: {
      class: Spacer,
    },
  },
});`,
  },

  {
    id: 'quote',
    exportName: 'Quote',
    type: 'block',
    title: 'Quote',
    description:
      'A blockquote with a left border accent. It supports two sizes, default and large. You switch between them in the block settings menu. Pasting a `<blockquote>` element automatically creates a quote block.',
    importExample: `import { Quote } from '@bloklabs/core/tools';`,
    configOptions: [],
    saveDataShape: `interface QuoteData {
  text: string;                  // Quote HTML content
  size: 'default' | 'large';    // Text size variant
}`,
    saveDataExample: `{
  "id": "qot001",
  "type": "quote",
  "data": {
    "text": "The only way to do great work is to love what you do.",
    "size": "default"
  }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Quote } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    quote: {
      class: Quote,
    },
  },
});`,
  },

  {
    id: 'code',
    exportName: 'Code',
    type: 'block',
    title: 'Code',
    description:
      'A syntax-highlighted code block with a language picker, an optional line-number gutter, and a copy-to-clipboard button. It supports 30+ languages via Prism. The LaTeX and Mermaid languages include a live preview tab.\n\nPasting markdown fenced code blocks (```) or `<pre>` elements automatically creates a code block. The language comes across whenever the pasted source names it: a fence that opens with ```sql, or a labelled code block copied out of an app such as Gemini.',
    importExample: `import { Code } from '@bloklabs/core/tools';`,
    configOptions: [],
    saveDataShape: `interface CodeData {
  code: string;          // Raw code text (not HTML)
  language: string;      // Language identifier, e.g. "javascript", "plain text"
  lineNumbers?: boolean; // Whether to show line numbers in the gutter
}`,
    saveDataExample: `{
  "id": "cod001",
  "type": "code",
  "data": {
    "code": "const greeting = 'hello';\\nconsole.log(greeting);",
    "language": "javascript",
    "lineNumbers": true
  }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Code } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    code: {
      class: Code,
      inlineToolbar: false,
    },
  },
});`,
  },

  {
    id: 'image',
    exportName: 'Image',
    type: 'block',
    title: 'Image',
    description: 'Embed an image by URL, by upload, or by pasting a file.',
    importExample: "import { Image } from '@bloklabs/core/tools';",
    configOptions: [
      {
        option: 'uploader',
        type: 'ImageUploader',
        default: 'undefined',
        description:
          'Consumer-supplied uploader with optional `uploadByFile(file, ctx)` and `uploadByUrl(url, ctx)` methods, each resolving to `{ url, fileName? }`. When omitted, images fall back to a local blob URL (uploadByFile) or the pasted URL (uploadByUrl).',
      },
      {
        option: 'types',
        type: 'string[]',
        default: "['image/*']",
        description:
          'Accepted MIME allowlist. Entries may be exact (`image/png`) or family wildcards (`image/*`). Defaults to any image type.',
      },
      {
        option: 'maxSize',
        type: 'MaxSizeConfig',
        default: '30 MiB',
        description:
          'Max upload size. A number caps every type, in bytes. An object caps each MIME type, with `\'*\'` as the fallback. Pass Infinity for unlimited.',
      },
      {
        option: 'sources',
        type: "'upload' | 'url' | 'both'",
        default: "'both'",
        description: 'Restrict how an image may be added: file upload only, URL only, or both.',
      },
      {
        option: 'convertGifToVideo',
        type: 'boolean',
        default: 'true',
        description: 'Auto-convert animated GIFs to a looping WebM video block on insert. It only applies when a video tool is registered. GIFs stay image blocks without one. Set false to always keep GIFs as image blocks.',
      },
      {
        option: 'captionPlaceholder',
        type: 'string',
        default: '"Write a caption…"',
        description: 'Placeholder text shown in the caption field.',
      },
      {
        option: 'compress',
        type: 'boolean | ImageCompressionConfig',
        default: 'true',
        description:
          'Re-encode uploaded images before they reach the uploader. It is on by default in a deliberately safe mode: the same format, quality 0.92, and the original dimensions. The result is only used when it saves at least 10%, otherwise the original bytes are uploaded untouched.\n\nPass an object to opt into smaller output. The keys are `format`, `fallbackFormat`, `quality`, `maxWidth` / `maxHeight`, `minSize`, `minSavings` and `transform(file)`.\n\n- `format` takes `\'original\'` | `\'jpeg\'` | `\'webp\'` | `\'avif\'` | `\'auto\'`.\n- `fallbackFormat` is the format to try when the browser cannot encode `format`, before falling back to the source format.\n  - So `{ format: \'avif\', fallbackFormat: \'webp\' }` uploads AVIF where the browser can produce it, and WebP everywhere else.\n- `quality` runs from 0 to 1.\n- `minSize` skips files below it, and defaults to 100 KiB.\n- `minSavings` defaults to 0.1.\n- `transform(file)` plugs in your own encoder.\n\nSet `false` to upload the exact original bytes. Compression never breaks an upload. When it cannot help, the original is used.',
      },
      {
        option: 'reloadAttempts',
        type: 'number',
        default: '5',
        description:
          'How many times a rendered image silently re-fetches its `src` after a load error before showing the broken-image state. Set 0 to disable auto-retry.',
      },
    ],
    saveDataShape: `interface ImageData {
  url: string;             // Image source URL — http(s) or blob:
  caption?: string;        // Plain-text caption
  width?: number;          // Width as percent of container, 10–100 (default 100)
  alignment?: 'left' | 'center' | 'right';
  size?: 'sm' | 'md' | 'lg' | 'full'; // Discrete size preset; overrides width when set
  frame?: 'none' | 'border' | 'shadow'; // Decorative frame treatment (default 'none')
  rounded?: boolean;       // Rounded corners (default true)
  captionVisible?: boolean; // Caption visible in the rendered state (default true)
  crop?: ImageCrop;        // Non-destructive crop rectangle
  alt?: string;            // Alt text for screen readers
  fileName?: string;       // Original filename, when known
  naturalWidth?: number;   // Intrinsic pixel width of the source (cached)
  naturalHeight?: number;  // Intrinsic pixel height of the source (cached)
}`,
    saveDataExample: `{
  "id": "img001",
  "type": "image",
  "data": {
    "url": "https://example.com/image.png",
    "caption": "A cat",
    "alt": "A cat",
    "alignment": "center"
  }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Image } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    image: {
      class: Image,
      config: {
        uploader: {
          async uploadByFile(file) {
            const url = await myUpload(file);
            return { url, fileName: file.name };
          },
        },
      },
    },
  },
});`,
  },

  {
    id: 'column_list',
    exportName: 'ColumnList',
    type: 'block',
    title: 'Columns',
    description:
      'A layout block that arranges its children into side-by-side columns. The column list itself holds no content. Each column is a child `column` block, and the blocks you write live inside those columns (via `contentIds`).\n\nYou can create columns three ways:\n- from the toolbox\n- by dragging a block beside another\n- by selecting several blocks and choosing "Turn into columns"\n\nColumn widths are resizable via the separators between columns. You can register both tools at once with the `Columns` group handle: `tools: { columns: Columns }` expands to the `column_list` and `column` tools. The saved JSON still contains `column_list` and `column` blocks.',
    importExample: `import { ColumnList } from '@bloklabs/core/tools';
// …or register both column tools at once with the group handle:
import { Columns } from '@bloklabs/core/tools';`,
    configOptions: [],
    saveDataShape: `interface ColumnListData {
  // No persisted fields. The structure lives in the block's saved \`content\`
  // array (exposed as \`contentIds\` on the in-memory Block), which references
  // the child column blocks.
  // (columnCount and noSeed are transient seed hints, never saved.)
}`,
    saveDataExample: `{
  "id": "col001",
  "type": "column_list",
  "data": {},
  "content": ["column1", "column2"]
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { ColumnList, Column } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    column_list: {
      class: ColumnList,
    },
    column: {
      class: Column,
    },
  },
});`,
  },
  {
    id: 'column',
    exportName: 'Column',
    type: 'block',
    title: 'Column',
    description:
      'A single column inside a column list. It is not user-insertable on its own. The parent `column_list` block creates and manages the columns.\n\nChild blocks are nested inside the column via `contentIds`. The optional `widthRatio` sets the column\'s width relative to its siblings, applied as flex-grow. Omit it for equal width.',
    importExample: `import { Column } from '@bloklabs/core/tools';`,
    configOptions: [],
    saveDataShape: `interface ColumnData {
  widthRatio?: number; // Width relative to siblings (flex-grow). Omitted = equal width.
}
// Child blocks are referenced via the block's saved \`content\` array
// (the in-memory \`contentIds\`), not stored here.`,
    saveDataExample: `{
  "id": "column1",
  "type": "column",
  "data": {
    "widthRatio": 1.5
  },
  "content": ["block1", "block2"]
}`,
    usageExample: `// Column is not inserted directly — it is created by the ColumnList tool.
import { ColumnList, Column } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    column_list: { class: ColumnList },
    column: { class: Column },
  },
});`,
  },

  {
    id: 'embed',
    exportName: 'Embed',
    type: 'block',
    title: 'Embed',
    description:
      'A live interactive iframe for a pasted provider URL (YouTube, Vimeo, Figma, CodePen, and 100+ other services), like Notion\'s "Create embed". It works purely on the client: the URL is matched against a built-in embed registry and resolved into a provider-sanctioned iframe URL.\n\nBy default only registry-matched URLs are embedded. Set the editor-level `linkPaste.allowGenericEmbed: true` to also embed unmatched https URLs in a generic sandboxed iframe (saved with an empty `service`).\n\nIt supports resizing, alignment (left/center/right), and an optional caption. A document-style provider such as Google Docs, Sheets, Slides, Forms or Drive also gets a bottom handle for adjusting the embed height.',
    importExample: `import { Embed } from '@bloklabs/core/tools';`,
    configOptions: [],
    saveDataShape: `interface EmbedData {
  service: string;        // Registry service key, e.g. "youtube"
  source: string;         // Original pasted URL
  embed: string;          // Resolved provider iframe URL
  kind?: 'iframe' | 'script'; // How the embed is rendered
  width?: number;         // Intrinsic width in pixels
  height?: number;        // Intrinsic height in pixels (user-adjustable for document-style providers)
  widthPercent?: number;  // Rendered width as % of the editor column (default 100)
  alignment?: 'left' | 'center' | 'right'; // Placement (default center)
  caption?: string;       // Caption HTML content
  captionVisible?: boolean; // Whether the caption field is shown
}`,
    saveDataExample: `{
  "id": "emb001",
  "type": "embed",
  "data": {
    "service": "youtube",
    "source": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "embed": "https://www.youtube.com/embed/dQw4w9WgXcQ",
    "kind": "iframe",
    "width": 580,
    "height": 320
  }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Embed } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    embed: {
      class: Embed,
    },
  },
});`,
  },
  {
    id: 'bookmark',
    exportName: 'Bookmark',
    type: 'block',
    title: 'Bookmark',
    description:
      'A static OpenGraph card for a pasted link, like Notion\'s "Create bookmark". It shows the page title, description, preview image, favicon, and domain.\n\nThe metadata comes from an unfurl endpoint that you supply. A backend is mandatory because of CORS. Blok ships only the contract.',
    importExample: `import { Bookmark } from '@bloklabs/core/tools';`,
    configOptions: [
      {
        option: 'endpoint',
        type: 'string',
        default: '""',
        description:
          'The unfurl endpoint you supply. Required. It is called as `endpoint?url=<encoded>` and should return `{ success: 1, link, meta: { title, description, image: { url }, favicon, domain } }`. Note that `image` is an object, not a string.',
      },
      {
        option: 'headers',
        type: 'Record<string, string>',
        default: 'undefined',
        description: 'Optional headers (e.g. auth) sent with the metadata request.',
      },
    ],
    saveDataShape: `interface BookmarkData {
  url: string;          // The bookmarked URL
  title?: string;       // Page title
  description?: string; // Page description
  image?: string;       // Preview image URL
  favicon?: string;     // Favicon URL
  domain?: string;      // Page domain, e.g. "example.com"
}`,
    saveDataExample: `{
  "id": "bkm001",
  "type": "bookmark",
  "data": {
    "url": "https://example.com/article",
    "title": "An Interesting Article",
    "description": "A short summary of the page.",
    "image": "https://example.com/preview.png",
    "favicon": "https://example.com/favicon.ico",
    "domain": "example.com"
  }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Bookmark } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    bookmark: {
      class: Bookmark,
      config: {
        endpoint: 'https://your-backend.example.com/unfurl',
      },
    },
  },
});`,
  },
  {
    id: 'file',
    exportName: 'File',
    type: 'block',
    title: 'File',
    description:
      'An attachment card for any uploaded file. It shows a type icon, filename, human-readable size, a download action, and an optional caption.\n\nFiles are sent through an uploader that you supply. When there is none, the tool falls back to a local blob URL (uploadByFile) or to the pasted URL itself (uploadByUrl). An optional MIME allowlist and max size can gate what is accepted.',
    importExample: `import { File } from '@bloklabs/core/tools';`,
    configOptions: [
      {
        option: 'uploader',
        type: 'FileUploader',
        default: 'undefined',
        description:
          'An uploader you supply. It has two optional methods, `uploadByFile(file, ctx)` and `uploadByUrl(url, ctx)`, and each one resolves to `{ url, fileName?, size?, mimeType? }`. The `ctx.onProgress(percent)` callback reports upload progress.\n\nWhen you omit the uploader, files fall back to a blob URL or the pasted URL.',
      },
      {
        option: 'endpoints',
        type: 'string | { byFile?: string; byUrl?: string }',
        default: 'undefined',
        description:
          'Upload endpoint or endpoints. Blok POSTs the upload itself: multipart/form-data for files, JSON `{ url }` for embedded URLs. It expects a `{ url, fileName?, size?, mimeType? }` body back.\n\nA string is used for both. An object targets each separately. An explicit `uploader` always takes precedence.',
      },
      {
        option: 'field',
        type: 'string',
        default: '"file"',
        description: 'Form-data field name carrying the uploaded file.',
      },
      {
        option: 'additionalRequestHeaders',
        type: 'Record<string, string>',
        default: 'undefined',
        description: 'Extra headers merged into endpoint upload requests.',
      },
      {
        option: 'types',
        type: 'string[]',
        default: 'undefined',
        description: 'Optional MIME allowlist. When omitted, files of any type are accepted.',
      },
      {
        option: 'sources',
        type: "'upload' | 'url' | 'both'",
        default: "'both'",
        description: 'Restrict how a file may be added: file upload only, URL only, or both.',
      },
      {
        option: 'maxSize',
        type: 'MaxSizeConfig',
        default: '30 MiB',
        description:
          'Max upload size. A number caps every type, in bytes. An object caps each MIME type, and `\'*\'` is the fallback. Pass Infinity for unlimited.',
      },
      {
        option: 'captionPlaceholder',
        type: 'string',
        default: '"Write a caption…"',
        description:
          'Placeholder text shown in the caption field. Defaults to the localized `tools.file.captionPlaceholder` string.',
      },
    ],
    saveDataShape: `interface FileData {
  url: string;             // File source URL — http(s) or blob:
  fileName?: string;       // Original filename, when known
  size?: number;           // File size in bytes; rendered human-readable
  mimeType?: string;       // MIME type; used to pick the type icon
  caption?: string;        // Plain-text caption
  captionVisible?: boolean; // Whether the caption row is shown. Opt-in: when omitted it
                            // resolves to true only if \`caption\` already has text
                            // (unlike Image/Video, which default to true).
}`,
    saveDataExample: `{
  "id": "fil001",
  "type": "file",
  "data": {
    "url": "https://example.com/files/report.pdf",
    "fileName": "report.pdf",
    "size": 184320,
    "mimeType": "application/pdf"
  }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { File } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    file: {
      class: File,
      config: {
        uploader: {
          async uploadByFile(file) {
            const url = await myUpload(file);
            return { url, fileName: file.name, size: file.size, mimeType: file.type };
          },
        },
      },
    },
  },
});`,
  },

  {
    id: 'audio',
    exportName: 'Audio',
    type: 'block',
    title: 'Audio',
    description:
      'A music-player style audio block. It renders an uploaded or linked audio file with a custom control bar. The bar has play/pause, a waveform scrubber, volume, playback speed and loop.\n\nThe block also takes optional cover art and title/artist metadata. An optional caption is switched on from the block settings menu (`captionVisible`). Waveform peaks and duration are decoded once and cached in the saved data, so playback renders instantly on reload.\n\nAudio is sent through a consumer-supplied uploader. When none is provided, the tool falls back to a local blob URL (uploadByFile) or the pasted URL (uploadByUrl).\n\nShare links from Dropbox, GitHub, GitLab, Hugging Face, Google Cloud Storage, and the Internet Archive are rewritten to their direct-content form automatically. Google Drive and OneDrive links also need an `uploadByUrl` backend, because those hosts block anonymous browser hotlinking.\n\nAn optional MIME allowlist and max size gate what is accepted.',
    importExample: `import { Audio } from '@bloklabs/core/tools';`,
    configOptions: [
      {
        option: 'uploader',
        type: 'AudioUploader',
        default: 'undefined',
        description:
          'Consumer-supplied uploader with optional `uploadByFile(file, ctx)` (resolving to `{ url, fileName? }`) and `uploadByUrl(url, ctx)` (resolving to `{ url }`) methods. The `ctx.onProgress(percent)` callback reports upload progress. When omitted, audio falls back to a blob URL or the pasted URL.',
      },
      {
        option: 'types',
        type: 'string[]',
        default: "['audio/*']",
        description:
          'Accepted MIME allowlist. Entries may be exact (`audio/mpeg`) or family wildcards (`audio/*`). Defaults to any audio type.',
      },
      {
        option: 'maxSize',
        type: 'MaxSizeConfig',
        default: '30 MiB',
        description:
          'Max upload size. A number caps every type (bytes). An object caps each MIME type, with `\'*\'` as the fallback.',
      },
      {
        option: 'sources',
        type: "'upload' | 'url' | 'both'",
        default: "'both'",
        description: 'Restrict how the media may be added: file upload only, URL only, or both.',
      },
      {
        option: 'captionPlaceholder',
        type: 'string',
        default: '"Write a caption…"',
        description: 'Placeholder text shown in the caption field.',
      },
    ],
    saveDataShape: `interface AudioData {
  url: string;             // Audio source URL — http(s) or blob:
  caption?: string;        // Plain-text caption
  captionVisible?: boolean; // Caption is opt-in — switch it on in block settings
  title?: string;          // Track title (from file metadata or edited)
  artist?: string;         // Track artist
  coverUrl?: string;       // Cover art image URL
  loop?: boolean;          // Loop playback
  width?: number;          // Pass-through width value; not currently surfaced in the audio UI
  alignment?: 'left' | 'center' | 'right';
  fileName?: string;       // Original filename, when known
  mimeType?: string;       // MIME type
  duration?: number;       // Decoded duration in seconds (cached)
  peaks?: number[];        // Cached waveform peaks for the scrubber
}`,
    saveDataExample: `{
  "id": "aud001",
  "type": "audio",
  "data": {
    "url": "https://example.com/media/track.mp3",
    "fileName": "track.mp3",
    "mimeType": "audio/mpeg",
    "title": "My Song",
    "artist": "The Artist",
    "alignment": "center"
  }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Audio } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    audio: {
      class: Audio,
      config: {
        uploader: {
          async uploadByFile(file) {
            const url = await myUpload(file);
            return { url, fileName: file.name };
          },
        },
      },
    },
  },
});`,
  },

  {
    id: 'video',
    exportName: 'Video',
    type: 'block',
    title: 'Video',
    description:
      'A video player block. It renders an uploaded or linked video with a custom control bar.\n\nThe bar has play/pause, a scrubber with buffered range and hover preview, volume, playback speed, loop, picture-in-picture, theater and fullscreen modes. It can also show a caption and an ambient glow behind the player.\n\nVideos are sent through a consumer-supplied uploader. When none is provided, the tool falls back to a local blob URL (uploadByFile) or the pasted URL (uploadByUrl). An optional MIME allowlist and max size gate what is accepted.',
    importExample: `import { Video } from '@bloklabs/core/tools';`,
    configOptions: [
      {
        option: 'uploader',
        type: 'VideoUploader',
        default: 'undefined',
        description:
          'Consumer-supplied uploader with optional `uploadByFile(file, ctx)` (resolving to `{ url, fileName? }`) and `uploadByUrl(url, ctx)` (resolving to `{ url }`) methods. The `ctx.onProgress(percent)` callback reports upload progress.\n\nWhen omitted, videos fall back to a blob URL or the entered URL. That URL then has to be a direct media file (`.mp4`, `.webm`, `.ogg`, `.mov`, `.m4v`), because it becomes the `<video src>` verbatim. Provide `uploadByUrl` to accept any URL and resolve it yourself.',
      },
      {
        option: 'types',
        type: 'string[]',
        default: "['video/*']",
        description:
          'Accepted MIME allowlist for uploads. Entries may be exact (`video/mp4`) or family wildcards (`video/*`). Defaults to any video type.',
      },
      {
        option: 'maxSize',
        type: 'MaxSizeConfig',
        default: '100 MiB',
        description:
          'Max upload size. A number caps every type, in bytes. An object caps each MIME type, with `\'*\'` as the fallback.',
      },
      {
        option: 'sources',
        type: "'upload' | 'url' | 'both'",
        default: "'both'",
        description: 'Restrict how the media may be added: file upload only, URL only, or both.',
      },
      {
        option: 'captionPlaceholder',
        type: 'string',
        default: '"Write a caption…"',
        description: 'Placeholder text shown in the caption field.',
      },
      {
        option: 'glow',
        type: "'more' | 'less' | 'minimal' | 'none'",
        default: "'minimal'",
        description: 'Ambient glow intensity rendered behind every player.',
      },
    ],
    saveDataShape: `interface VideoData {
  url: string;             // Video source URL — http(s) or blob:
  caption?: string;        // Plain-text caption
  captionVisible?: boolean; // Caption visible in the rendered state (default true)
  width?: number;          // Width as percent of the editor container, 10–100 (resize handle, default 100)
  alignment?: 'left' | 'center' | 'right';
  autoplay?: boolean;      // Autoplay on render
  loop?: boolean;          // Loop playback
  hideControls?: boolean;  // Render a control-free player
  fileName?: string;       // Original filename, when known
  mimeType?: string;       // MIME type
  aspectRatio?: string;    // e.g. "16 / 9", used to reserve layout space
}`,
    saveDataExample: `{
  "id": "vid001",
  "type": "video",
  "data": {
    "url": "https://example.com/media/clip.mp4",
    "fileName": "clip.mp4",
    "mimeType": "video/mp4",
    "alignment": "center"
  }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Video } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    video: {
      class: Video,
      config: {
        uploader: {
          async uploadByFile(file) {
            const url = await myUpload(file);
            return { url, fileName: file.name };
          },
        },
      },
    },
  },
});`,
  },

  // ── Inline Tools ──────────────────────────────────────────────────────────
  {
    id: 'bold',
    exportName: 'Bold',
    type: 'inline',
    title: 'Bold',
    description:
      'Wraps selected text in `<strong>`. Activated with Cmd/Ctrl+B or by clicking the B button in the inline toolbar. Supports nested bold ranges and normalises overlapping markup on paste.',
    importExample: `import { Bold } from '@bloklabs/core/tools';`,
    configOptions: [],
    saveDataShape: `// No separate data shape — Bold is stored as HTML inside the block's text field.
// Example HTML stored in a paragraph:
// "Hello <strong>world</strong>"`,
    saveDataExample: `// Inline tools affect the text field of the containing block.
// A paragraph with bold text:
{
  "type": "paragraph",
  "data": { "text": "Hello <strong>world</strong>" }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Bold, Paragraph } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    // Paragraph is the default block and is not bundled with the core —
    // without it the editor starts with an "unsupported block" stub.
    paragraph: Paragraph,
    bold: Bold,
    // or with a shortcut override:
    // bold: { class: Bold, shortcut: 'CMD+SHIFT+B' },
  },
});`,
  },
  {
    id: 'italic',
    exportName: 'Italic',
    type: 'inline',
    title: 'Italic',
    description:
      'Wraps selected text in `<i>` (pasted `<em>` is also preserved). Activated with Cmd/Ctrl+I or by clicking the I button in the inline toolbar.',
    importExample: `import { Italic } from '@bloklabs/core/tools';`,
    configOptions: [],
    saveDataShape: `// Stored as HTML inside the block's text field.
// "Hello <i>world</i>"`,
    saveDataExample: `{
  "type": "paragraph",
  "data": { "text": "Hello <i>world</i>" }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Italic, Paragraph } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    // Paragraph is the default block and is not bundled with the core —
    // without it the editor starts with an "unsupported block" stub.
    paragraph: Paragraph,
    italic: Italic,
  },
});`,
  },
  {
    id: 'link',
    exportName: 'Link',
    type: 'inline',
    title: 'Link',
    description:
      'Wraps selected text in `<a href="...">`. Activated with Cmd/Ctrl+K. Clicking the button on existing linked text opens the URL input, so the link can be edited or removed.\n\n`target` and `rel` are always written alongside `href` and come from `BlokConfig.link`. The defaults are `_blank` and `nofollow`.\n\nFor same-page hrefs, `target="_self"` is forced: that means a `#anchor`, or a URL resolving to the current origin and pathname. A `link.transform` can override any of href, target and rel.',
    importExample: `import { Link } from '@bloklabs/core/tools';`,
    configOptions: [],
    saveDataShape: `// Stored as HTML inside the block's text field.
// target and rel are always present — these are the defaults:
// '<a href="https://example.com" target="_blank" rel="nofollow">Example</a>'`,
    saveDataExample: `{
  "type": "paragraph",
  "data": {
    "text": "Visit <a href=\\"https://example.com\\" target=\\"_blank\\" rel=\\"nofollow\\">Example</a>"
  }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Link, Paragraph } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    // Paragraph is the default block and is not bundled with the core —
    // without it the editor starts with an "unsupported block" stub.
    paragraph: Paragraph,
    link: Link,
  },
});`,
  },
  {
    id: 'marker',
    exportName: 'Marker',
    type: 'inline',
    title: 'Marker',
    description:
      'Applies text colour or background colour to selected text. It uses `<mark style="color:...">` or `<mark style="background-color:...">`.\n\nClick the toolbar button, then choose the Text color or Background tab. Each tab shows preset swatches, a selected-colour preview, and a Default reset. Recently used colours appear below the palette.\n\nEvery colour is normalised to a CSS custom property (`var(--blok-color-<name>-<text|bg>)`), so themes can restyle it.\n\nThe picker offers only the nine presets. Any other CSS colour applied programmatically is snapped to the perceptually nearest preset. There is no distance threshold.\n\nThree kinds of value pass through untouched.\n\n- A value already written as `var(...)`.\n- A value the colour parser cannot read, such as the CSS named colour `rebeccapurple`.\n- The default page background colours.\n\nRaw colours can sit on `<mark>` elements, for example when pasted from another editor. On load they are rewritten to the nearest preset var. So arbitrary hex values are not preserved.\n\nCmd/Ctrl+Shift+H does not open the picker. It re-applies the last colour picked in this session straight to the selection. On first use that is a yellow highlight (`var(--blok-color-yellow-bg)`). It does nothing when the selection is collapsed.',
    importExample: `import { Marker } from '@bloklabs/core/tools';`,
    configOptions: [],
    saveDataShape: `// Stored as HTML inside the block's text field.
// Text colour:       '<mark style="color: var(--blok-color-red-text); background-color: transparent;">red text</mark>'
// Background colour: '<mark style="background-color: var(--blok-color-yellow-bg);">highlighted text</mark>'`,
    saveDataExample: `{
  "type": "paragraph",
  "data": {
    "text": "<mark style=\\"background-color: var(--blok-color-yellow-bg);\\">highlighted text</mark>"
  }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Marker, Paragraph } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    // Paragraph is the default block and is not bundled with the core —
    // without it the editor starts with an "unsupported block" stub.
    paragraph: Paragraph,
    marker: Marker,
  },
});`,
  },
  {
    id: 'underline',
    exportName: 'Underline',
    type: 'inline',
    title: 'Underline',
    description:
      'Wraps selected text in `<u>`. Activated with Cmd/Ctrl+U or by clicking the U button in the inline toolbar.',
    importExample: `import { Underline } from '@bloklabs/core/tools';`,
    configOptions: [],
    saveDataShape: `// Stored as HTML inside the block's text field.
// "Hello <u>world</u>"`,
    saveDataExample: `{
  "type": "paragraph",
  "data": { "text": "Hello <u>world</u>" }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Underline, Paragraph } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    // Paragraph is the default block and is not bundled with the core —
    // without it the editor starts with an "unsupported block" stub.
    paragraph: Paragraph,
    underline: Underline,
  },
});`,
  },
  {
    id: 'strikethrough',
    exportName: 'Strikethrough',
    type: 'inline',
    title: 'Strikethrough',
    description:
      'Wraps selected text in `<s>`. Activated with Cmd/Ctrl+Shift+S or by clicking the S button in the inline toolbar.',
    importExample: `import { Strikethrough } from '@bloklabs/core/tools';`,
    configOptions: [],
    saveDataShape: `// Stored as HTML inside the block's text field.
// "Hello <s>world</s>"`,
    saveDataExample: `{
  "type": "paragraph",
  "data": { "text": "Hello <s>world</s>" }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Strikethrough, Paragraph } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    // Paragraph is the default block and is not bundled with the core —
    // without it the editor starts with an "unsupported block" stub.
    paragraph: Paragraph,
    strikethrough: Strikethrough,
  },
});`,
  },
  {
    id: 'inlineCode',
    exportName: 'InlineCode',
    type: 'inline',
    title: 'Inline Code',
    description:
      'Wraps selected text in `<code>`. Activated with Cmd/Ctrl+E or by clicking the code button in the inline toolbar. Useful for marking up variable names, function calls, and short code snippets within text.',
    importExample: `import { InlineCode } from '@bloklabs/core/tools';`,
    configOptions: [],
    saveDataShape: `// Stored as HTML inside the block's text field.
// "Call <code>getData()</code> to fetch results"`,
    saveDataExample: `{
  "type": "paragraph",
  "data": { "text": "Call <code>getData()</code> to fetch results" }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { InlineCode, Paragraph } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    // Paragraph is the default block and is not bundled with the core —
    // without it the editor starts with an "unsupported block" stub.
    paragraph: Paragraph,
    inlineCode: InlineCode,
  },
});`,
  },
  {
    id: 'equation',
    exportName: 'Equation',
    type: 'inline',
    title: 'Equation',
    description:
      'Renders inline math (LaTeX) with KaTeX. Press Cmd/Ctrl+Shift+E to activate it. It wraps the selected text, or a formula typed into the popover input, in a `<span data-latex="...">`.\n\nThe `data-latex` attribute is the formula. The KaTeX markup is derived from it, is stripped on save, and is regenerated whenever the block renders (load, paste, undo).\n\nRead-only surfaces that never mount an editor, `blocksToHtml` and `<BlokView>`, display the source instead. Pass an `inlineRenderers` entry to render the math there too.',
    importExample: `import { Equation } from '@bloklabs/core/tools';`,
    configOptions: [],
    saveDataShape: `// Stored as HTML inside the block's text field. The data-latex attribute is
// the formula; the span's text is normalized to that same source on save, so
// nothing derived from KaTeX's rendering is persisted (which is why plain-text
// previews and search indexes read the formula, not its rendered fragments).
// '<span data-latex="E = mc^2">E = mc^2</span>'`,
    saveDataExample: `// Render the math on a DOM-free view surface by plugging KaTeX in:
//   blocksToHtml(data, {
//     inlineRenderers: {
//       span: ({ attrs }) => attrs['data-latex'] === undefined
//         ? undefined
//         : katex.renderToString(attrs['data-latex'], { throwOnError: false }),
//     },
//   })
{
  "type": "paragraph",
  "data": {
    "text": "Einstein wrote <span data-latex=\\"E = mc^2\\">E = mc^2</span>"
  }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Equation, Paragraph } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    // Paragraph is the default block and is not bundled with the core —
    // without it the editor starts with an "unsupported block" stub.
    paragraph: Paragraph,
    equation: Equation,
  },
});`,
  },
  {
    id: 'clearFormat',
    exportName: 'ClearFormat',
    type: 'inline',
    title: 'Clear Format',
    description:
      'Removes inline formatting (bold, italic, underline, strikethrough, inline code, highlight) from the selected text. Links stay intact. Apply it by clicking the Tx button in the inline toolbar.',
    importExample: `import { ClearFormat } from '@bloklabs/core/tools';`,
    configOptions: [],
    saveDataShape: `// Removes formatting tags from the block's text field.
// "<b>Hello</b> world" becomes "Hello world"`,
    saveDataExample: `{
  "type": "paragraph",
  "data": { "text": "Hello world" }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { ClearFormat, Paragraph } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    // Paragraph is the default block and is not bundled with the core —
    // without it the editor starts with an "unsupported block" stub.
    paragraph: Paragraph,
    clearFormat: ClearFormat,
  },
});`,
  },
  {
    id: 'supSub',
    exportName: 'SupSub',
    type: 'inline',
    title: 'Superscript & Subscript',
    description:
      'One toolbar button with a two-option popover. It toggles superscript (`<sup>`) or subscript (`<sub>`) on the selection. The two modes are mutually exclusive, so applying one removes the other. Shortcuts: Cmd/Ctrl+Period for superscript, Cmd/Ctrl+Comma for subscript.',
    importExample: `import { SupSub } from '@bloklabs/core/tools';`,
    configOptions: [],
    saveDataShape: `// Stored as HTML inside the block's text field:
// "E = mc<sup>2</sup>" or "H<sub>2</sub>O"`,
    saveDataExample: `{
  "type": "paragraph",
  "data": { "text": "E = mc<sup>2</sup>" }
}`,
    usageExample: `import { Blok } from '@bloklabs/core';
import { Paragraph, SupSub } from '@bloklabs/core/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    // Paragraph is the default block and is not bundled with the core —
    // without it the editor starts with an "unsupported block" stub.
    paragraph: Paragraph,
    supSub: SupSub,
  },
});`,
  },
];

// Derived lookup sets used by the documentation coverage unit test.
// When a new tool is added to defaultBlockTools/defaultInlineTools in src/tools/index.ts
// without a docs entry here, the coverage test fails immediately.
export const DOCUMENTED_BLOCK_TOOL_KEYS = new Set(
  TOOL_SECTIONS.filter((s) => s.type === 'block').map((s) => s.id)
);

export const DOCUMENTED_INLINE_TOOL_KEYS = new Set(
  TOOL_SECTIONS.filter((s) => s.type === 'inline').map((s) => s.id)
);

// The URL each documented tool has to be reachable at. Being documented is not
// the same as being discoverable: test/unit/architecture/docs-seo-surface-law.test.ts
// requires every path here to have route metadata AND a sitemap URL, so a new
// tool cannot ship as a page nothing links to and no crawler is told about.
// (Deduplicated: TOOL_SECTIONS carries a repeated id, matching the sidebar.)
export const DOCUMENTED_TOOL_ROUTE_PATHS = [
  ...new Set(TOOL_SECTIONS.map((s) => `/docs/${s.id}`)),
];

// Sidebar section structure used by the Tools page
export interface ToolsSidebarSection {
  title: string;
  links: { id: string; label: string }[];
}

export const TOOLS_SIDEBAR_SECTIONS: ToolsSidebarSection[] = [
  {
    title: 'Block Tools',
    links: TOOL_SECTIONS.filter((s) => s.type === 'block').map((s) => ({
      id: s.id,
      label: s.title,
    })),
  },
  {
    title: 'Inline Tools',
    links: TOOL_SECTIONS.filter((s) => s.type === 'inline').map((s) => ({
      id: s.id,
      label: s.title,
    })),
  },
];
