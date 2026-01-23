export interface ApiMethod {
  name: string;
  returnType: string;
  description: string;
  example?: string;
}

export interface ApiSection {
  id: string;
  badge?: string;
  title: string;
  description?: string;
  methods?: ApiMethod[];
  properties?: { name: string; type: string; description: string }[];
  table?: { option: string; type: string; default: string; description: string }[];
  customType?: 'quick-start';
}

export const API_SECTIONS: ApiSection[] = [
  {
    id: 'quick-start',
    badge: 'Guide',
    title: 'Quick Start',
    description: 'Get up and running with Blok in just a few simple steps.',
    customType: 'quick-start',
  },
  {
    id: 'core',
    badge: 'Core',
    title: 'Blok Class',
    description: 'The main editor class that initializes and manages the Blok editor instance.',
    methods: [
      {
        name: 'save()',
        returnType: 'Promise<OutputData>',
        description:
          'Extracts the current editor content as structured JSON data. This is the primary method for persisting editor content.',
        example: 'const data = await editor.save();',
      },
      {
        name: 'render(data)',
        returnType: 'Promise<void>',
        description: 'Renders editor content from previously saved JSON data.',
        example: 'await editor.render(data);',
      },
      {
        name: 'focus(atEnd?)',
        returnType: 'boolean',
        description: 'Sets focus to the editor. Optionally positions cursor at the end of content.',
        example: 'editor.focus();\neditor.focus(true); // Focus at end',
      },
      {
        name: 'clear()',
        returnType: 'void',
        description: 'Removes all blocks from the editor.',
        example: 'editor.clear();',
      },
      {
        name: 'destroy()',
        returnType: 'void',
        description: 'Destroys the editor instance and removes all DOM elements and event listeners.',
        example: 'editor.destroy();',
      },
    ],
    properties: [
      { name: 'isReady', type: 'Promise<void>', description: 'Promise that resolves when editor is ready' },
      { name: 'blocks', type: 'BlocksAPI', description: 'Blocks API module' },
      { name: 'caret', type: 'CaretAPI', description: 'Caret API module' },
      { name: 'saver', type: 'SaverAPI', description: 'Saver API module' },
      { name: 'toolbar', type: 'ToolbarAPI', description: 'Toolbar API module' },
      { name: 'inlineToolbar', type: 'InlineToolbarAPI', description: 'Inline toolbar API module' },
      { name: 'events', type: 'EventsAPI', description: 'Events API module' },
    ],
  },
  {
    id: 'config',
    title: 'Configuration',
    description: 'The configuration object passed to the Blok constructor.',
    table: [
      { option: 'holder', type: 'string | HTMLElement', default: "'blok'", description: 'Container element ID or reference' },
      { option: 'tools', type: 'Record<string, ToolConfig>', default: '{}', description: 'Available block and inline tools' },
      { option: 'placeholder', type: 'string', default: "''", description: 'Placeholder text for empty blocks' },
      { option: 'minHeight', type: 'string | number', default: "'300px'", description: 'Minimum height of the editor' },
      { option: 'defaultBlock', type: 'string', default: "'paragraph'", description: 'Default block type' },
      { option: 'data', type: 'OutputData', default: 'undefined', description: 'Initial data to render' },
      { option: 'readOnly', type: 'boolean', default: 'false', description: 'Enable read-only mode' },
      { option: 'onChange', type: '(api: API) => void', default: 'undefined', description: 'Change callback function' },
    ],
  },
  {
    id: 'blocks-api',
    badge: 'Blocks',
    title: 'Blocks API',
    description: 'Manage blocks in the editor—create, delete, update, and reorder content.',
    methods: [
      {
        name: 'blocks.delete(blockId)',
        returnType: 'Promise<void>',
        description: 'Removes the specified block from the editor.',
        example: 'await editor.blocks.delete("block-id");',
      },
      {
        name: 'blocks.insert(type, data?)',
        returnType: 'Promise<BlockAPI>',
        description: 'Inserts a new block at the end of the editor.',
        example: 'const block = await editor.blocks.insert("paragraph", { text: "Hello" });',
      },
      {
        name: 'blocks.move(blockId, toIndex)',
        returnType: 'Promise<void>',
        description: 'Moves a block to a new position in the editor.',
        example: 'await editor.blocks.move("block-id", 0);',
      },
      {
        name: 'blocks.update(blockId, data)',
        returnType: 'Promise<void>',
        description: 'Updates the data of an existing block.',
        example: 'await editor.blocks.update("block-id", { text: "New content" });',
      },
    ],
  },
  {
    id: 'caret-api',
    badge: 'Caret',
    title: 'Caret API',
    description: 'Control cursor position and selection within the editor.',
    methods: [
      {
        name: 'caret.setToBlock(blockIndex, position?)',
        returnType: 'Promise<void>',
        description: 'Sets the caret to a specific block.',
        example: 'await editor.caret.setToBlock(0);',
      },
      {
        name: 'caret.setToNextBlock()',
        returnType: 'Promise<void>',
        description: 'Moves the caret to the next block.',
        example: 'await editor.caret.setToNextBlock();',
      },
      {
        name: 'caret.setToPreviousBlock()',
        returnType: 'Promise<void>',
        description: 'Moves the caret to the previous block.',
        example: 'await editor.caret.setToPreviousBlock();',
      },
    ],
  },
  {
    id: 'events-api',
    badge: 'Events',
    title: 'Events API',
    description: 'Subscribe to and manage editor lifecycle events.',
    methods: [
      {
        name: 'on(event, callback)',
        returnType: 'void',
        description: 'Subscribe to an editor event.',
        example: 'editor.on("change", (api) => console.log("Content changed"));',
      },
      {
        name: 'off(event, callback)',
        returnType: 'void',
        description: 'Unsubscribe from an editor event.',
        example: 'editor.off("change", handler);',
      },
      {
        name: 'emit(event, data)',
        returnType: 'void',
        description: 'Emit a custom event.',
        example: 'editor.emit("custom-event", { data: "value" });',
      },
    ],
  },
  {
    id: 'saver-api',
    badge: 'Saver',
    title: 'Saver API',
    description: 'Save and export editor content.',
    methods: [
      {
        name: 'saver.save()',
        returnType: 'Promise<OutputData>',
        description: 'Alias for the main save() method.',
        example: 'const data = await editor.saver.save();',
      },
    ],
  },
  {
    id: 'selection-api',
    badge: 'Selection',
    title: 'Selection API',
    description: 'Work with text selection within the editor.',
    methods: [
      {
        name: 'selection.findParentTag(tagName, class?)',
        returnType: 'HTMLElement | null',
        description: 'Find the parent element of the current selection.',
        example: 'const bold = editor.selection.findParentTag("B");',
      },
      {
        name: 'selection.expandToTag(element)',
        returnType: 'void',
        description: 'Expand selection to cover the entire element.',
        example: 'editor.selection.expandToTag(element);',
      },
    ],
  },
  {
    id: 'styles-api',
    badge: 'Styles',
    title: 'Styles API',
    description: 'Apply inline formatting to text selections.',
    methods: [
      {
        name: 'styles.toggle(style)',
        returnType: 'Promise<void>',
        description: 'Toggle an inline style on the current selection.',
        example: 'await editor.styles.toggle("bold");',
      },
    ],
  },
  {
    id: 'toolbar-api',
    badge: 'Toolbar',
    title: 'Toolbar API',
    description: 'Control the block toolbar and its state.',
    methods: [
      {
        name: 'toolbar.close()',
        returnType: 'void',
        description: 'Close the toolbar if open.',
        example: 'editor.toolbar.close();',
      },
      {
        name: 'toolbar.open()',
        returnType: 'void',
        description: 'Open the toolbar.',
        example: 'editor.toolbar.open();',
      },
    ],
  },
  {
    id: 'tools-api',
    badge: 'Tools',
    title: 'Tools API',
    description: 'Access and manage editor tools.',
    methods: [
      {
        name: 'tools.available',
        returnType: 'Record<string, Tool>',
        description: 'Object containing all available tools (property, not method).',
        example: 'const paragraphTool = editor.tools.available.paragraph;',
      },
    ],
  },
  {
    id: 'output-data',
    badge: 'Data',
    title: 'OutputData',
    description: 'The data structure returned by the save() method.',
    table: [
      { option: 'version', type: 'string', default: '—', description: 'Editor version' },
      { option: 'time', type: 'number', default: '—', description: 'Timestamp of save' },
      { option: 'blocks', type: 'BlockData[]', default: '—', description: 'Array of block data' },
    ],
  },
  {
    id: 'block-data',
    badge: 'Data',
    title: 'BlockData',
    description: 'The structure of each block in the blocks array.',
    table: [
      { option: 'id', type: 'string', default: '—', description: 'Unique block identifier' },
      { option: 'type', type: 'string', default: '—', description: 'Block type name' },
      { option: 'data', type: 'object', default: '—', description: 'Block-specific data' },
      { option: 'tunes', type: 'TuneData[]', default: '—', description: 'Block tunes/meta data' },
    ],
  },
];

export interface SidebarSection {
  title: string;
  links: { id: string; label: string }[];
}

export const SIDEBAR_SECTIONS: SidebarSection[] = [
  {
    title: 'Guide',
    links: [
      { id: 'quick-start', label: 'Quick Start' },
    ],
  },
  {
    title: 'Core',
    links: [
      { id: 'core', label: 'Blok Class' },
      { id: 'config', label: 'Configuration' },
    ],
  },
  {
    title: 'API Modules',
    links: [
      { id: 'blocks-api', label: 'Blocks' },
      { id: 'caret-api', label: 'Caret' },
      { id: 'events-api', label: 'Events' },
      { id: 'saver-api', label: 'Saver' },
      { id: 'selection-api', label: 'Selection' },
      { id: 'styles-api', label: 'Styles' },
      { id: 'toolbar-api', label: 'Toolbar' },
      { id: 'tools-api', label: 'Tools' },
    ],
  },
  {
    title: 'Data',
    links: [
      { id: 'output-data', label: 'OutputData' },
      { id: 'block-data', label: 'BlockData' },
    ],
  },
];
