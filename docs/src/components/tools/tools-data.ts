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
  badge: string;       // 'Block Tool' | 'Inline Tool'
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
    badge: 'Block Tool',
    title: 'Paragraph',
    description:
      'The default text block. Supports rich inline formatting (bold, italic, links, colour). Empty paragraphs are excluded from saved output unless `preserveBlank` is enabled.',
    importExample: `import { Paragraph } from '@jackuait/blok/tools';`,
    configOptions: [
      {
        option: 'placeholder',
        type: 'string',
        default: '""',
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
  text: string; // HTML string (may include <b>, <i>, <a>, <mark>)
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
    badge: 'Block Tool',
    title: 'Header',
    description:
      'Heading blocks from H1 to H6. Supports multiple toolbox entries (one per heading level), keyboard shortcuts (# ## ### etc.), and optional toggle (collapse/expand children) for H1–H3.',
    importExample: `import { Header } from '@jackuait/blok/tools';`,
    configOptions: [
      {
        option: 'placeholder',
        type: 'string',
        default: '""',
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
  text: string;           // Heading HTML content
  level: number;          // 1–6
  isToggleable?: boolean; // true when the heading has toggle (collapse/expand)
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
    badge: 'Block Tool',
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
    badge: 'Block Tool',
    title: 'Table',
    description:
      'A full-featured table block. Each cell contains its own block editor (supporting any block type). Supports heading rows, heading columns, column resizing, cell background/text colours, row/column add and delete controls, and copy/paste.',
    importExample: `import { Table } from '@jackuait/blok/tools';`,
    configOptions: [
      {
        option: 'rows',
        type: 'number',
        default: '2',
        description: 'Initial number of rows when a new table is inserted.',
      },
      {
        option: 'cols',
        type: 'number',
        default: '2',
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
    badge: 'Block Tool',
    title: 'Toggle',
    description:
      'A collapsible toggle block with a clickable arrow. Child blocks are nested inside the toggle and hidden when collapsed. Toggling is controlled by clicking the arrow icon. In read-only mode, toggles start collapsed.',
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
  text: string; // Toggle title HTML content
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

  // ── Inline Tools ──────────────────────────────────────────────────────────
  {
    id: 'bold',
    exportName: 'Bold',
    type: 'inline',
    badge: 'Inline Tool',
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
    badge: 'Inline Tool',
    title: 'Italic',
    description:
      'Wraps selected text in `<em>`. Activated with Cmd/Ctrl+I or by clicking the I button in the inline toolbar.',
    importExample: `import { Italic } from '@jackuait/blok/tools';`,
    configOptions: [],
    saveDataShape: `// Stored as HTML inside the block's text field.
// "Hello <em>world</em>"`,
    saveDataExample: `{
  "type": "paragraph",
  "data": { "text": "Hello <em>world</em>" }
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
    badge: 'Inline Tool',
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
    badge: 'Inline Tool',
    title: 'Marker',
    description:
      'Applies text colour or background colour to selected text using `<mark style="color:...">` or `<mark style="background-color:...">`. Opens a colour picker with preset colours and a custom hex input. Activated with Cmd/Ctrl+Shift+H.',
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
