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
      'The default text block. Supports rich inline formatting (bold, italic, links, colour). Empty paragraphs are excluded from saved output unless `preserveBlank` is enabled.',
    importExample: `import { Paragraph } from '@jackuait/blok/tools';`,
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
        description: 'When true, empty paragraph blocks are included in the saved output.',
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
    usageExample: `import { Blok } from '@jackuait/blok';
import { Paragraph } from '@jackuait/blok/tools';

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
      'Heading blocks from H1 to H6. Supports multiple toolbox entries (one per heading level), keyboard shortcuts (# ## ### etc.), and optional toggle (collapse/expand children) for H1–H3.',
    importExample: `import { Header } from '@jackuait/blok/tools';`,
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
          'Custom keyboard shortcuts per level. If omitted, markdown-style shortcuts (#, ## …) are used. Pass an empty object {} to disable all shortcuts.',
      },
    ],
    saveDataShape: `interface HeaderData {
  text: string;             // Heading HTML content
  level: number;            // 1–6
  isToggleable?: boolean;   // true when the heading has toggle (collapse/expand)
  isOpen?: boolean;         // Persisted toggle state, present when toggleable
  textColor?: string;       // Block colour preset, present when set
  backgroundColor?: string; // Block background colour preset, present when set
}`,
    saveDataExample: `{
  "id": "def456",
  "type": "header",
  "data": {
    "text": "Getting Started",
    "level": 2
  }
}`,
    usageExample: `import { Blok } from '@jackuait/blok';
import { Header } from '@jackuait/blok/tools';

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
      'Bulleted, numbered, and to-do (checklist) lists with unlimited nesting. Each list item is a separate block. The toolbox shows three entries by default — one for each style — and items can be converted between styles via the block settings menu.',
    importExample: `import { List } from '@jackuait/blok/tools';`,
    configOptions: [
      {
        option: 'defaultStyle',
        type: '"unordered" | "ordered" | "checklist"',
        default: '"unordered"',
        description: 'The list style used when inserting a new list block.',
      },
      {
        option: 'styles',
        type: 'ListItemStyle[]',
        default: '["unordered","ordered","checklist"]',
        description: 'Restrict which styles are available in the block settings conversion menu.',
      },
      {
        option: 'toolboxStyles',
        type: 'ListItemStyle[]',
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
    saveDataShape: `interface ListItemData {
  text: string;                                    // Item HTML content
  style: 'unordered' | 'ordered' | 'checklist'; // List type
  checked?: boolean;  // Checklist check state
  start?: number;     // First number for ordered lists (root items only)
  depth?: number;     // Nesting depth (0 = root)
}`,
    saveDataExample: `{
  "id": "ghi789",
  "type": "list",
  "data": {
    "text": "First item",
    "style": "unordered",
    "depth": 0
  }
}`,
    usageExample: `import { Blok } from '@jackuait/blok';
import { List } from '@jackuait/blok/tools';

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
      'A full-featured table block. Each cell contains its own block editor (supporting any block type). Supports heading rows, heading columns, column resizing, cell background/text colours, row/column add and delete controls, and copy/paste.',
    importExample: `import { Table } from '@jackuait/blok/tools';`,
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
    usageExample: `import { Blok } from '@jackuait/blok';
import { Table } from '@jackuait/blok/tools';

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
      'A collapsible toggle block with a clickable arrow. Child blocks are nested inside the toggle and hidden when collapsed. Toggling is controlled by clicking the arrow icon. The open/collapsed state is persisted via `isOpen` and restored on reload; toggles default to open.',
    importExample: `import { Toggle } from '@jackuait/blok/tools';`,
    configOptions: [
      {
        option: 'placeholder',
        type: 'string',
        default: '"Toggle"',
        description: 'Placeholder text shown in an empty toggle block.',
      },
    ],
    saveDataShape: `interface ToggleItemData {
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
    usageExample: `import { Blok } from '@jackuait/blok';
import { Toggle } from '@jackuait/blok/tools';

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
      'A container block for highlighted content with an emoji icon. Supports customisable text and background colours via a colour picker. Child blocks are nested inside the callout. Useful for tips, warnings, notes, and other call-to-action content.',
    importExample: `import { Callout } from '@jackuait/blok/tools';`,
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
    usageExample: `import { Blok } from '@jackuait/blok';
import { Callout } from '@jackuait/blok/tools';

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
      'A multi-view database block supporting board (Kanban), list, table, and gallery views. Stores a schema of typed properties (text, select, status, date, etc.) and view configurations. Rows are stored as child `database-row` blocks. Supports grouping, sorting, filtering, drag-and-drop reordering, inline editing, and an optional backend sync adapter.',
    importExample: `import { Database } from '@jackuait/blok/tools';`,
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
  views: DatabaseViewConfig[];         // View configs (board, list, table, gallery)
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
    usageExample: `import { Blok } from '@jackuait/blok';
import { Database } from '@jackuait/blok/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    database: {
      class: Database,
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
      'An internal block tool that stores a single database row. Not user-insertable — rows are created and managed by the parent Database block. Each row stores property values conforming to the parent database schema and a position string for ordering.',
    importExample: `import { DatabaseRow } from '@jackuait/blok/tools';`,
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
import { Database, DatabaseRow } from '@jackuait/blok/tools';

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
      'A horizontal line separator. Renders a semantic `<hr>` element. Has no editable content or settings. Can be inserted via the toolbox or by typing `---` in an empty paragraph.',
    importExample: `import { Divider } from '@jackuait/blok/tools';`,
    configOptions: [],
    saveDataShape: `interface DividerData {
  // Empty — dividers have no configurable properties.
}`,
    saveDataExample: `{
  "id": "div001",
  "type": "divider",
  "data": {}
}`,
    usageExample: `import { Blok } from '@jackuait/blok';
import { Divider } from '@jackuait/blok/tools';

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
    id: 'quote',
    exportName: 'Quote',
    type: 'block',
    title: 'Quote',
    description:
      'A blockquote with a left border accent. Supports two sizes (default and large) switchable via the block settings menu. Pasting a `<blockquote>` element automatically creates a quote block.',
    importExample: `import { Quote } from '@jackuait/blok/tools';`,
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
    usageExample: `import { Blok } from '@jackuait/blok';
import { Quote } from '@jackuait/blok/tools';

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
      'A syntax-highlighted code block with a language picker, an optional line-number gutter, and a copy-to-clipboard button. Supports 30+ languages via Prism. LaTeX and Mermaid languages include a live preview tab. Pasting markdown fenced code blocks (```) or `<pre>` elements automatically creates a code block.',
    importExample: `import { Code } from '@jackuait/blok/tools';`,
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
    usageExample: `import { Blok } from '@jackuait/blok';
import { Code } from '@jackuait/blok/tools';

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
    description: 'Embed an image via URL upload or file paste.',
    importExample: "import { Image } from '@jackuait/blok/tools';",
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
          'Max upload size. A number caps every type (bytes); an object caps per MIME type with `\'*\'` as the fallback. Pass Infinity for unlimited.',
      },
      {
        option: 'sources',
        type: "'upload' | 'url' | 'both'",
        default: "'both'",
        description: 'Restrict how an image may be added — file upload only, URL only, or both.',
      },
      {
        option: 'convertGifToVideo',
        type: 'boolean',
        default: 'true',
        description: 'Auto-convert animated GIFs to a looping WebM video block on insert. Set false to keep GIFs as image blocks.',
      },
      {
        option: 'captionPlaceholder',
        type: 'string',
        default: '"Write a caption…"',
        description: 'Placeholder text shown in the caption field.',
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
    usageExample: `import { Blok } from '@jackuait/blok';
import { Image } from '@jackuait/blok/tools';

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
      'A layout block that arranges its children into side-by-side columns. The column list itself holds no content — each column is a child `column` block, and the blocks you write live inside those columns (via `contentIds`). Columns can be created three ways: from the toolbox · by dragging a block beside another · by selecting multiple blocks and choosing "Turn into columns". Column widths are resizable via the separators between columns.',
    importExample: `import { ColumnList } from '@jackuait/blok/tools';`,
    configOptions: [],
    saveDataShape: `interface ColumnListData {
  // No persisted fields. The structure lives in the block's contentIds,
  // which reference the child column blocks.
  // (columnCount and noSeed are transient seed hints, never saved.)
}`,
    saveDataExample: `{
  "id": "col001",
  "type": "column_list",
  "data": {},
  "contentIds": ["column1", "column2"]
}`,
    usageExample: `import { Blok } from '@jackuait/blok';
import { ColumnList, Column } from '@jackuait/blok/tools';

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
      'A single column inside a column list. Not user-insertable on its own — columns are created and managed by the parent `column_list` block. Child blocks are nested inside the column via `contentIds`. The optional `widthRatio` controls the column’s width relative to its siblings (applied as flex-grow); omit it for equal width.',
    importExample: `import { Column } from '@jackuait/blok/tools';`,
    configOptions: [],
    saveDataShape: `interface ColumnData {
  widthRatio?: number; // Width relative to siblings (flex-grow). Omitted = equal width.
}
// Child blocks are referenced via the block's contentIds, not stored here.`,
    saveDataExample: `{
  "id": "column1",
  "type": "column",
  "data": {
    "widthRatio": 1.5
  },
  "contentIds": ["block1", "block2"]
}`,
    usageExample: `// Column is not inserted directly — it is created by the ColumnList tool.
import { ColumnList, Column } from '@jackuait/blok/tools';

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
      'A live interactive iframe for a pasted provider URL (YouTube, Vimeo, Figma, CodePen, and 100+ other services), like Notion’s "Create embed". Pure client-side: the URL is matched against a built-in embed registry and resolved into a provider-sanctioned iframe URL — only registry-matched URLs are ever embedded. Supports resizing, alignment (left/center/right), and an optional caption.',
    importExample: `import { Embed } from '@jackuait/blok/tools';`,
    configOptions: [],
    saveDataShape: `interface EmbedData {
  service: string;        // Registry service key, e.g. "youtube"
  source: string;         // Original pasted URL
  embed: string;          // Resolved provider iframe URL
  kind?: 'iframe' | 'script'; // How the embed is rendered
  width?: number;         // Intrinsic width in pixels
  height?: number;        // Intrinsic height in pixels
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
    usageExample: `import { Blok } from '@jackuait/blok';
import { Embed } from '@jackuait/blok/tools';

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
      'A static OpenGraph card for a pasted link, like Notion’s "Create bookmark". Shows the page title, description, preview image, favicon, and domain. Metadata is fetched from a consumer-supplied unfurl endpoint (CORS makes a backend mandatory) — Blok ships only the contract.',
    importExample: `import { Bookmark } from '@jackuait/blok/tools';`,
    configOptions: [
      {
        option: 'endpoint',
        type: 'string',
        default: '""',
        description:
          'Consumer-supplied unfurl endpoint. Required. Called as `endpoint?url=<encoded>` and expected to return `{ success: 1, link, meta: { title, description, image: { url }, favicon, domain } }` (note `image` is an object, not a string).',
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
    usageExample: `import { Blok } from '@jackuait/blok';
import { Bookmark } from '@jackuait/blok/tools';

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
      'An attachment card for any uploaded file. Shows a type icon, filename, human-readable size, a download action, and an optional caption. Files are sent through a consumer-supplied uploader; when none is provided the tool falls back to a local blob URL (uploadByFile) or the pasted URL itself (uploadByUrl). An optional MIME allowlist and max size can gate what is accepted.',
    importExample: `import { File } from '@jackuait/blok/tools';`,
    configOptions: [
      {
        option: 'uploader',
        type: 'FileUploader',
        default: 'undefined',
        description:
          'Consumer-supplied uploader with optional `uploadByFile(file, ctx)` and `uploadByUrl(url, ctx)` methods, each resolving to `{ url, fileName?, size?, mimeType? }`. The `ctx.onProgress(percent)` callback reports upload progress. When omitted, files fall back to a blob URL or the pasted URL.',
      },
      {
        option: 'endpoints',
        type: 'string | { byFile?: string; byUrl?: string }',
        default: 'undefined',
        description:
          'Upload endpoint(s) — Blok POSTs the upload itself (multipart/form-data for files, JSON `{ url }` for embedded URLs) and expects a `{ url, fileName?, size?, mimeType? }` body back. A string is used for both; an object targets each separately. An explicit `uploader` always takes precedence.',
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
        description: 'Restrict how a file may be added — file upload only, URL only, or both.',
      },
      {
        option: 'maxSize',
        type: 'MaxSizeConfig',
        default: '30 MiB',
        description:
          'Max upload size. A number caps every type (bytes); an object caps per MIME type with `\'*\'` as the fallback. Pass Infinity for unlimited.',
      },
      {
        option: 'captionPlaceholder',
        type: 'string',
        default: 'undefined',
        description: 'Placeholder text shown in the caption field.',
      },
    ],
    saveDataShape: `interface FileData {
  url: string;             // File source URL — http(s) or blob:
  fileName?: string;       // Original filename, when known
  size?: number;           // File size in bytes; rendered human-readable
  mimeType?: string;       // MIME type; used to pick the type icon
  caption?: string;        // Plain-text caption
  captionVisible?: boolean; // Caption visible in the rendered state (default true)
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
    usageExample: `import { Blok } from '@jackuait/blok';
import { File } from '@jackuait/blok/tools';

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
      'A music-player style audio block. Renders an uploaded or linked audio file with a custom control bar (play/pause, a waveform scrubber, volume, playback speed, loop), optional cover art, title/artist metadata, and a caption. Waveform peaks and duration are decoded once and cached in the saved data so playback renders instantly on reload. Audio is sent through a consumer-supplied uploader; when none is provided the tool falls back to a local blob URL (uploadByFile) or the pasted URL (uploadByUrl). An optional MIME allowlist and max size gate what is accepted.',
    importExample: `import { Audio } from '@jackuait/blok/tools';`,
    configOptions: [
      {
        option: 'uploader',
        type: 'AudioUploader',
        default: 'undefined',
        description:
          'Consumer-supplied uploader with optional `uploadByFile(file, ctx)` and `uploadByUrl(url, ctx)` methods, each resolving to `{ url, fileName? }`. The `ctx.onProgress(percent)` callback reports upload progress. When omitted, audio falls back to a blob URL or the pasted URL.',
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
          'Max upload size. A number caps every type (bytes); an object caps per MIME type with `\'*\'` as the fallback.',
      },
      {
        option: 'captionPlaceholder',
        type: 'string',
        default: 'undefined',
        description: 'Placeholder text shown in the caption field.',
      },
    ],
    saveDataShape: `interface AudioData {
  url: string;             // Audio source URL — http(s) or blob:
  caption?: string;        // Plain-text caption
  captionVisible?: boolean; // Caption visible in the rendered state
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
    usageExample: `import { Blok } from '@jackuait/blok';
import { Audio } from '@jackuait/blok/tools';

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
      'A full-featured video player block. Renders an uploaded or linked video with a custom control bar (play/pause, scrubber with buffered range and hover preview, volume, playback speed, loop, picture-in-picture, theater and fullscreen modes), an optional caption, and an ambient glow behind the player. Videos are sent through a consumer-supplied uploader; when none is provided the tool falls back to a local blob URL (uploadByFile) or the pasted URL (uploadByUrl). An optional MIME allowlist and max size gate what is accepted.',
    importExample: `import { Video } from '@jackuait/blok/tools';`,
    configOptions: [
      {
        option: 'uploader',
        type: 'VideoUploader',
        default: 'undefined',
        description:
          'Consumer-supplied uploader with optional `uploadByFile(file, ctx)` and `uploadByUrl(url, ctx)` methods, each resolving to `{ url, fileName? }`. The `ctx.onProgress(percent)` callback reports upload progress. When omitted, videos fall back to a blob URL or the pasted URL.',
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
          'Max upload size. A number caps every type (bytes); an object caps per MIME type with `\'*\'` as the fallback.',
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
    usageExample: `import { Blok } from '@jackuait/blok';
import { Video } from '@jackuait/blok/tools';

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
    importExample: `import { Bold } from '@jackuait/blok/tools';`,
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
    usageExample: `import { Blok } from '@jackuait/blok';
import { Bold } from '@jackuait/blok/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    bold: Bold,
    // or with shortcut override:
    // bold: { class: Bold },
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
    importExample: `import { Italic } from '@jackuait/blok/tools';`,
    configOptions: [],
    saveDataShape: `// Stored as HTML inside the block's text field.
// "Hello <i>world</i>"`,
    saveDataExample: `{
  "type": "paragraph",
  "data": { "text": "Hello <i>world</i>" }
}`,
    usageExample: `import { Blok } from '@jackuait/blok';
import { Italic } from '@jackuait/blok/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
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
      'Wraps selected text in `<a href="...">`. Activated with Cmd/Ctrl+K. Clicking the button on existing linked text opens the URL input allowing the link to be edited or removed.',
    importExample: `import { Link } from '@jackuait/blok/tools';`,
    configOptions: [],
    saveDataShape: `// Stored as HTML inside the block's text field.
// '<a href="https://example.com">Example</a>'`,
    saveDataExample: `{
  "type": "paragraph",
  "data": {
    "text": "Visit <a href=\\"https://example.com\\">Example</a>"
  }
}`,
    usageExample: `import { Blok } from '@jackuait/blok';
import { Link } from '@jackuait/blok/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
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
      'Applies text colour or background colour to selected text using `<mark style="color:...">` or `<mark style="background-color:...">`. Opens a colour picker with preset text and background swatches plus a Default reset. Activated with Cmd/Ctrl+Shift+H.',
    importExample: `import { Marker } from '@jackuait/blok/tools';`,
    configOptions: [],
    saveDataShape: `// Stored as HTML inside the block's text field.
// Text colour:       '<mark style="color:#e03e2d">red text</mark>'
// Background colour: '<mark style="background-color:#ffd966">highlighted</mark>'`,
    saveDataExample: `{
  "type": "paragraph",
  "data": {
    "text": "<mark style=\\"background-color:#ffd966\\">highlighted text</mark>"
  }
}`,
    usageExample: `import { Blok } from '@jackuait/blok';
import { Marker } from '@jackuait/blok/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
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
    importExample: `import { Underline } from '@jackuait/blok/tools';`,
    configOptions: [],
    saveDataShape: `// Stored as HTML inside the block's text field.
// "Hello <u>world</u>"`,
    saveDataExample: `{
  "type": "paragraph",
  "data": { "text": "Hello <u>world</u>" }
}`,
    usageExample: `import { Blok } from '@jackuait/blok';
import { Underline } from '@jackuait/blok/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
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
    importExample: `import { Strikethrough } from '@jackuait/blok/tools';`,
    configOptions: [],
    saveDataShape: `// Stored as HTML inside the block's text field.
// "Hello <s>world</s>"`,
    saveDataExample: `{
  "type": "paragraph",
  "data": { "text": "Hello <s>world</s>" }
}`,
    usageExample: `import { Blok } from '@jackuait/blok';
import { Strikethrough } from '@jackuait/blok/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
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
    importExample: `import { InlineCode } from '@jackuait/blok/tools';`,
    configOptions: [],
    saveDataShape: `// Stored as HTML inside the block's text field.
// "Call <code>getData()</code> to fetch results"`,
    saveDataExample: `{
  "type": "paragraph",
  "data": { "text": "Call <code>getData()</code> to fetch results" }
}`,
    usageExample: `import { Blok } from '@jackuait/blok';
import { InlineCode } from '@jackuait/blok/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
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
      'Renders inline math (LaTeX) with KaTeX. Activated with Cmd/Ctrl+Shift+E — wraps the selected text, or a formula typed into the popover input, in a `<span data-latex="...">`. The LaTeX source is kept in the `data-latex` attribute so the formula round-trips through save/load, while the rendered KaTeX markup is regenerated on load.',
    importExample: `import { Equation } from '@jackuait/blok/tools';`,
    configOptions: [],
    saveDataShape: `// Stored as HTML inside the block's text field.
// The LaTeX source lives in the data-latex attribute:
// '<span data-latex="E = mc^2"></span>'`,
    saveDataExample: `{
  "type": "paragraph",
  "data": {
    "text": "Einstein wrote <span data-latex=\\"E = mc^2\\"></span>"
  }
}`,
    usageExample: `import { Blok } from '@jackuait/blok';
import { Equation } from '@jackuait/blok/tools';

const editor = new Blok({
  holder: 'editor',
  tools: {
    equation: Equation,
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
