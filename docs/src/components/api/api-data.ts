/**
 * Demo action configuration for interactive API method demonstrations
 */
export interface DemoAction {
  /** Button text displayed to users */
  label: string;
  /** Function that executes the API method on the mini editor */
  execute: (editor: unknown) => Promise<void> | void;
  /** Optional expected output message to display on success */
  expectedOutput?: string;
}

/**
 * Demo configuration for an API method
 */
export interface DemoConfig {
  /** Optional custom initial state for the demo editor */
  initialState?: {
    blocks: BlockData[];
  };
  /** Array of actions to expose as demo buttons */
  actions: DemoAction[];
}

/** Block data structure for demo initial state */
export interface BlockData {
  id?: string;
  type: string;
  data: unknown;
}

export interface ApiMethod {
  name: string;
  returnType: string;
  description: string;
  example?: string;
  /** Optional demo configuration for interactive demonstrations */
  demo?: DemoConfig;
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
        example: `// Save editor content
const data = await editor.save();
console.log(data.blocks); // Array of block data`,
      },
      {
        name: 'render(data)',
        returnType: 'Promise<void>',
        description: 'Renders editor content from previously saved JSON data.',
        example: `// Load saved content
const savedData = {
  blocks: [
    { id: '1', type: 'paragraph', data: { text: 'Hello' } }
  ]
};
await editor.render(savedData);`,
      },
      {
        name: 'focus(atEnd?)',
        returnType: 'boolean',
        description: 'Sets focus to the editor. Optionally positions cursor at the end of content.',
        example: `// Focus at start
editor.focus();

// Focus at end
editor.focus(true);`,
      },
      {
        name: 'clear()',
        returnType: 'void',
        description: 'Removes all blocks from the editor.',
        example: `// Clear all content
editor.clear();`,
      },
      {
        name: 'destroy()',
        returnType: 'void',
        description: 'Destroys the editor instance and removes all DOM elements and event listeners.',
        example: `// Clean up on component unmount
editor.destroy();`,
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
        name: 'blocks.clear()',
        returnType: 'Promise<void>',
        description: 'Remove all blocks from the editor.',
        example: `await editor.blocks.clear();
// Editor is now empty`,
        demo: {
          actions: [
            {
              label: 'Clear all blocks',
              execute: async (editor) => {
                await (editor as { blocks: { clear(): Promise<void> } }).blocks.clear();
              },
              expectedOutput: 'All blocks removed',
            },
          ],
        },
      },
      {
        name: 'blocks.render(data)',
        returnType: 'Promise<void>',
        description: 'Render passed JSON data as blocks.',
        example: `const data = {
  blocks: [
    { id: '1', type: 'paragraph', data: { text: 'Hello World' } },
    { id: '2', type: 'header', data: { text: 'Title', level: 1 } }
  ]
};
await editor.blocks.render(data);`,
        demo: {
          initialState: {
            blocks: [] as BlockData[],
          },
          actions: [
            {
              label: 'Load sample content',
              execute: async (editor) => {
                await (editor as { blocks: { render(data: { blocks: BlockData[] }): Promise<void> } }).blocks.render({
                  blocks: [
                    { id: '1', type: 'paragraph', data: { text: 'Hello World!' } },
                    { id: '2', type: 'paragraph', data: { text: 'This is dynamically rendered content.' } },
                    { id: '3', type: 'header', data: { text: 'New Section', level: 2 } },
                  ] as BlockData[],
                });
              },
              expectedOutput: 'Loaded 3 blocks from JSON data',
            },
          ],
        },
      },
      {
        name: 'blocks.renderFromHTML(data)',
        returnType: 'Promise<void>',
        description: 'Render HTML string as blocks by converting it to block format.',
        example: `const html = '<h1>Title</h1><p>Hello World</p>';
await editor.blocks.renderFromHTML(html);
// HTML is converted to appropriate blocks`,
      },
      {
        name: 'blocks.delete(index?)',
        returnType: 'Promise<void>',
        description: 'Remove the block at the specified index, or current block if no index provided.',
        example: `// Delete current block
await editor.blocks.delete();

// Delete block at index 0
await editor.blocks.delete(0);`,
      },
      {
        name: 'blocks.move(toIndex, fromIndex?)',
        returnType: 'void',
        description: 'Moves a block to a new position. If fromIndex is not provided, moves the current block.',
        example: `// Move current block to top
editor.blocks.move(0);

// Move block from index 2 to index 0
editor.blocks.move(0, 2);`,
        demo: {
          actions: [
            {
              label: 'Move first to last',
              execute: async (editor) => {
                const e = editor as { blocks: { move(toIndex: number, fromIndex?: number): void; getBlocksCount(): number } };
                e.blocks.move(e.blocks.getBlocksCount() - 1, 0);
              },
              expectedOutput: 'Moved first block to last position',
            },
            {
              label: 'Move last to top',
              execute: async (editor) => {
                const e = editor as { blocks: { move(toIndex: number, fromIndex?: number): void; getBlocksCount(): number } };
                e.blocks.move(0, e.blocks.getBlocksCount() - 1);
              },
              expectedOutput: 'Moved last block to first position',
            },
          ],
        },
      },
      {
        name: 'blocks.getBlockByIndex(index)',
        returnType: 'BlockAPI | undefined',
        description: 'Get the BlockAPI object for the block at the specified index.',
        example: `const block = editor.blocks.getBlockByIndex(0);
if (block) {
  console.log(block.id, block.name);
}`,
      },
      {
        name: 'blocks.getById(id)',
        returnType: 'BlockAPI | null',
        description: 'Get the BlockAPI object for the block with the specified ID.',
        example: `const block = editor.blocks.getById('block-123');
if (block) {
  await block.update({ text: 'New content' });
}`
      },
      {
        name: 'blocks.getCurrentBlockIndex()',
        returnType: 'number',
        description: 'Get the index of the currently focused block.',
        example: `const index = editor.blocks.getCurrentBlockIndex();
console.log('Current block index:', index);`,
      },
      {
        name: 'blocks.getBlockIndex(blockId)',
        returnType: 'number | undefined',
        description: 'Get the index of a block by its ID.',
        example: `const index = editor.blocks.getBlockIndex('block-123');
if (index !== undefined) {
  console.log('Block is at index:', index);
}`,
      },
      {
        name: 'blocks.getBlockByElement(element)',
        returnType: 'BlockAPI | undefined',
        description: 'Get the BlockAPI object for the block containing the given HTML element.',
        example: `document.addEventListener('click', (e) => {
  const block = editor.blocks.getBlockByElement(e.target);
  if (block) {
    console.log('Clicked on block:', block.id);
  }
});`,
      },
      {
        name: 'blocks.getChildren(parentId)',
        returnType: 'BlockAPI[]',
        description: 'Get all child blocks of a parent container block.',
        example: `const children = editor.blocks.getChildren('parent-block-id');
children.forEach(child => {
  console.log('Child:', child.id);
});`,
      },
      {
        name: 'blocks.getBlocksCount()',
        returnType: 'number',
        description: 'Get the total number of blocks in the editor.',
        example: `const count = editor.blocks.getBlocksCount();
console.log('Total blocks:', count);`,
        demo: {
          actions: [
            {
              label: 'Count blocks',
              execute: (editor) => {
                // This is a read-only action - returns count but doesn't modify
                const count = (editor as { blocks: { getBlocksCount(): number } }).blocks.getBlocksCount();
                console.log('Block count:', count);
              },
              expectedOutput: 'Editor has 3 blocks',
            },
          ],
        },
      },
      {
        name: 'blocks.insert(type?, data?, config?, index?, needToFocus?, replace?, id?)',
        returnType: 'BlockAPI',
        description: 'Insert a new block with full control over its properties and position.',
        example: `// Insert at end with default type
const block = editor.blocks.insert();

// Insert paragraph with data at index 0
const block = editor.blocks.insert('paragraph', { text: 'Hello' }, undefined, 0);

// Insert with custom ID
const block = editor.blocks.insert('header', { text: 'Title' }, undefined, undefined, undefined, undefined, 'custom-id');`,
        demo: {
          actions: [
            {
              label: 'Add paragraph',
              execute: (editor) => {
                (editor as { blocks: { insert(): unknown } }).blocks.insert();
              },
              expectedOutput: 'Added new paragraph block',
            },
            {
              label: 'Add header at top',
              execute: (editor) => {
                (editor as { blocks: { insert(type: string, data: unknown, config: unknown, index: number): unknown } }).blocks.insert(
                  'header',
                  { text: 'New Header', level: 2 },
                  undefined,
                  0
                );
              },
              expectedOutput: 'Added header at position 0',
            },
          ],
        },
      },
      {
        name: 'blocks.insertMany(blocks, index?)',
        returnType: 'BlockAPI[]',
        description: 'Insert multiple blocks at once at the specified index.',
        example: `const blocksToInsert = [
  { id: '1', type: 'paragraph', data: { text: 'First' } },
  { id: '2', type: 'paragraph', data: { text: 'Second' } }
];
const inserted = editor.blocks.insertMany(blocksToInsert, 0);
console.log('Inserted:', inserted.length, 'blocks');`,
      },
      {
        name: 'blocks.composeBlockData(toolName)',
        returnType: 'Promise<BlockToolData>',
        description: 'Create empty block data for the specified tool type.',
        example: `const emptyData = await editor.blocks.composeBlockData('paragraph');
// Returns: { text: '' } or appropriate empty state for the tool`,
      },
      {
        name: 'blocks.update(id, data?, tunes?)',
        returnType: 'Promise<BlockAPI>',
        description: 'Update a block\'s data and/or tunes.',
        example: `// Update block data
const block = await editor.blocks.update('block-123', { text: 'New text' });

// Update with tunes
const block = await editor.blocks.update('block-123', undefined, { alignment: 'center' });`,
      },
      {
        name: 'blocks.convert(id, newType, dataOverrides?)',
        returnType: 'Promise<BlockAPI>',
        description: 'Convert a block to a different type. Both tools must support conversion config.',
        example: `// Convert paragraph to header
const headerBlock = await editor.blocks.convert('block-123', 'header', { level: 2 });

// Convert with data overrides
const headerBlock = await editor.blocks.convert('block-123', 'header', { text: 'New Title', level: 1 });`,
      },
      {
        name: 'blocks.splitBlock(currentBlockId, currentBlockData, newBlockType, newBlockData, insertIndex)',
        returnType: 'BlockAPI',
        description: 'Atomically split a block by updating the current block and inserting a new block. Both operations are grouped into a single undo entry.',
        example: `// Split a paragraph at cursor position
const newBlock = editor.blocks.splitBlock(
  'current-block-id',
  { text: 'First part' },
  'paragraph',
  { text: 'Second part' },
  1
);`,
      },
    ],
  },
  {
    id: 'block-api',
    badge: 'Block',
    title: 'BlockAPI',
    description: 'Interface for working with individual blocks. Returned by blocks.getById(), blocks.getBlockByIndex(), and blocks.insert().',
    methods: [
      {
        name: 'block.save()',
        returnType: 'Promise<void|SavedData>',
        description: 'Save the block content and return its data.',
        example: `const block = editor.blocks.getById('block-123');
const data = await block.save();
console.log(data); // { text: 'Block content' }`,
      },
      {
        name: 'block.validate(data)',
        returnType: 'Promise<boolean>',
        description: 'Validate block data against the tool\'s validation rules.',
        example: `const block = editor.blocks.getById('block-123');
const isValid = await block.validate({ text: 'Hello' });
if (!isValid) {
  console.log('Block data is invalid');
}`,
      },
      {
        name: 'block.call(methodName, param?)',
        returnType: 'void',
        description: 'Call a custom method on the block\'s tool.',
        example: `const block = editor.blocks.getById('block-123');
// Call a custom method defined in the tool
block.call('showNotification', { message: 'Hello' });`,
      },
      {
        name: 'block.dispatchChange()',
        returnType: 'void',
        description: 'Manually trigger the onChange callback for this block.',
        example: `const block = editor.blocks.getById('block-123');
// Trigger change after invisible modification
block.dispatchChange();`,
      },
      {
        name: 'block.getActiveToolboxEntry()',
        returnType: 'Promise<ToolboxConfigEntry | undefined>',
        description: 'Get the active toolbox entry for this block (e.g., Heading 1 vs Heading 2).',
        example: `const block = editor.blocks.getById('block-123');
const entry = await block.getActiveToolboxEntry();
if (entry) {
  console.log('Active entry:', entry.title);
}`,
      },
    ],
    properties: [
      { name: 'id', type: 'string', description: 'Unique block identifier' },
      { name: 'name', type: 'string', description: 'Tool name (e.g., "paragraph", "header")' },
      { name: 'config', type: 'ToolConfig', description: 'Tool config passed on initialization' },
      { name: 'holder', type: 'HTMLElement', description: 'Wrapper of Tool\'s HTML element' },
      { name: 'isEmpty', type: 'boolean', description: 'True if block content is empty' },
      { name: 'selected', type: 'boolean', description: 'True if block is selected with Cross-Block selection' },
      { name: 'focusable', type: 'boolean', description: 'True if block has inputs to be focused' },
      { name: 'stretched', type: 'boolean', description: 'Getter/setter for block stretch state' },
    ],
  },
  {
    id: 'caret-api',
    badge: 'Caret',
    title: 'Caret API',
    description: 'Control cursor position and selection within the editor.',
    methods: [
      {
        name: 'caret.setToFirstBlock(position?, offset?)',
        returnType: 'boolean',
        description: 'Set caret to the first block with optional position and offset.',
        example: `// Set to start of first block
editor.caret.setToFirstBlock('start');

// Set to end of first block with offset
editor.caret.setToFirstBlock('end', 5);`,
      },
      {
        name: 'caret.setToLastBlock(position?, offset?)',
        returnType: 'boolean',
        description: 'Set caret to the last block with optional position and offset.',
        example: `// Focus last block at end
editor.caret.setToLastBlock('end');

// Focus last block at start
editor.caret.setToLastBlock('start');`,
      },
      {
        name: 'caret.setToPreviousBlock(position?, offset?)',
        returnType: 'boolean',
        description: 'Move caret to the previous block.',
        example: `editor.caret.setToPreviousBlock('end');
// Caret now at end of previous block`,
      },
      {
        name: 'caret.setToNextBlock(position?, offset?)',
        returnType: 'boolean',
        description: 'Move caret to the next block.',
        example: `editor.caret.setToNextBlock('start');
// Caret now at start of next block`,
      },
      {
        name: 'caret.setToBlock(blockOrIdOrIndex, position?, offset?)',
        returnType: 'boolean',
        description: 'Set caret to a specific block by BlockAPI, ID, or index.',
        example: `// By index
editor.caret.setToBlock(0, 'end');

// By ID
editor.caret.setToBlock('block-123', 'start');

// By BlockAPI
const block = editor.blocks.getById('block-123');
editor.caret.setToBlock(block);`,
      },
      {
        name: 'caret.focus(atEnd?)',
        returnType: 'boolean',
        description: 'Set focus to the editor, optionally at the end of content.',
        example: `// Focus at start
editor.caret.focus();

// Focus at end
editor.caret.focus(true);`,
      },
      {
        name: 'caret.updateLastCaretAfterPosition()',
        returnType: 'void',
        description: 'Update the "after" position of the most recent caret undo entry. Use after async caret movements.',
        example: `// After moving caret asynchronously
requestAnimationFrame(() => {
  editor.caret.setToBlock(0);
  editor.caret.updateLastCaretAfterPosition();
});`,
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
        example: `// Listen for content changes
editor.on('change', (api) => {
  console.log('Content changed');
  const data = await api.save();
});

// Listen for block selection
editor.on('block-selected', (block) => {
  console.log('Selected block:', block.id);
});`,
      },
      {
        name: 'off(event, callback)',
        returnType: 'void',
        description: 'Unsubscribe from an editor event.',
        example: `const handleChange = (api) => console.log('Changed');
editor.on('change', handleChange);

// Later, remove the listener
editor.off('change', handleChange);`,
      },
      {
        name: 'emit(event, data)',
        returnType: 'void',
        description: 'Emit a custom event.',
        example: `editor.emit('custom-event', { message: 'Hello', data: 123 });

// Listen to custom events
editor.on('custom-event', (data) => {
  console.log(data.message); // 'Hello'
});`,
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
        example: `const data = await editor.saver.save();
// Returns: { version, time, blocks }`,
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
        name: 'selection.findParentTag(tagName, className?)',
        returnType: 'HTMLElement | null',
        description: 'Find the parent element of the current selection matching the tag and optionally class.',
        example: `const bold = editor.selection.findParentTag('B');
if (bold) {
  console.log('Selection is inside bold text');
}

const link = editor.selection.findParentTag('A', 'external-link');`,
      },
      {
        name: 'selection.expandToTag(node)',
        returnType: 'void',
        description: 'Expand selection to cover the entire element.',
        example: `const element = editor.selection.findParentTag('B');
if (element) {
  editor.selection.expandToTag(element);
  // Now entire bold element is selected
}`,
      },
      {
        name: 'selection.setFakeBackground()',
        returnType: 'void',
        description: 'Set a fake background to imitate selection when focus moves away. Useful for inline tools.',
        example: `// Save selection visual before opening a modal
editor.selection.setFakeBackground();
// Open modal - selection stays visually highlighted`,
      },
      {
        name: 'selection.removeFakeBackground()',
        returnType: 'void',
        description: 'Remove the fake background selection.',
        example: `// After closing modal
editor.selection.removeFakeBackground();`,
      },
      {
        name: 'selection.clearFakeBackground()',
        returnType: 'void',
        description: 'Clear all fake background state - both DOM elements and internal flags.',
        example: `// Full cleanup after undo/redo
editor.selection.clearFakeBackground();`,
      },
      {
        name: 'selection.save()',
        returnType: 'void',
        description: 'Save the current selection range to restore later.',
        example: `// Save selection before moving focus
editor.selection.save();

// Do something that moves focus away...

// Restore selection
editor.selection.restore();`,
      },
      {
        name: 'selection.restore()',
        returnType: 'void',
        description: 'Restore a previously saved selection range.',
        example: `editor.selection.save();
// ... operations that move focus ...
editor.selection.restore();`,
      },
    ],
  },
  {
    id: 'styles-api',
    badge: 'Styles',
    title: 'Styles API',
    description: 'Access CSS class names for styling custom tools and UI elements.',
    properties: [
      { name: 'block', type: 'string', description: 'Base block wrapper styles' },
      { name: 'inlineToolButton', type: 'string', description: 'Inline toolbar button styles' },
      { name: 'inlineToolButtonActive', type: 'string', description: 'Active inline tool button styles' },
      { name: 'input', type: 'string', description: 'Input element styles' },
      { name: 'loader', type: 'string', description: 'Loading spinner styles' },
      { name: 'settingsButton', type: 'string', description: 'Settings button styles' },
      { name: 'settingsButtonActive', type: 'string', description: 'Active settings button styles' },
      { name: 'button', type: 'string', description: 'General button styles' },
    ],
  },
  {
    id: 'toolbar-api',
    badge: 'Toolbar',
    title: 'Toolbar API',
    description: 'Control the block toolbar and its state.',
    methods: [
      {
        name: 'toolbar.close(options?)',
        returnType: 'void',
        description: 'Close the toolbar with optional configuration.',
        example: `// Standard close
editor.toolbar.close();

// Close and prevent hover reopen
editor.toolbar.close({ setExplicitlyClosed: true });`,
      },
      {
        name: 'toolbar.open()',
        returnType: 'void',
        description: 'Open the toolbar.',
        example: `editor.toolbar.open();`,
      },
      {
        name: 'toolbar.toggleBlockSettings(openingState?)',
        returnType: 'void',
        description: 'Toggle the block settings menu (☰).',
        example: `// Toggle current state
editor.toolbar.toggleBlockSettings();

// Force open
editor.toolbar.toggleBlockSettings(true);

// Force close
editor.toolbar.toggleBlockSettings(false);`,
      },
      {
        name: 'toolbar.toggleToolbox(openingState?)',
        returnType: 'void',
        description: 'Toggle the toolbox (+ menu).',
        example: `// Toggle current state
editor.toolbar.toggleToolbox();

// Force open
editor.toolbar.toggleToolbox(true);`,
      },
    ],
  },
  {
    id: 'inline-toolbar-api',
    badge: 'Inline',
    title: 'InlineToolbar API',
    description: 'Control the inline formatting toolbar (bold, italic, etc.).',
    methods: [
      {
        name: 'inlineToolbar.close()',
        returnType: 'void',
        description: 'Close the inline toolbar.',
        example: `editor.inlineToolbar.close();`,
      },
      {
        name: 'inlineToolbar.open()',
        returnType: 'void',
        description: 'Open the inline toolbar at the current selection.',
        example: `editor.inlineToolbar.open();`,
      },
    ],
  },
  {
    id: 'notifier-api',
    badge: 'Notifier',
    title: 'Notifier API',
    description: 'Display notification messages to users.',
    methods: [
      {
        name: 'notifier.show(options)',
        returnType: 'void',
        description: 'Show a notification message. Supports simple, confirm, and prompt notifications.',
        example: `// Simple notification
editor.notifier.show({
  message: 'Changes saved',
  style: 'success'
});

// Confirm notification
editor.notifier.show({
  message: 'Delete this block?',
  style: 'confirm',
  onConfirm: () => console.log('Confirmed'),
  onCancel: () => console.log('Cancelled')
});

// Prompt notification
editor.notifier.show({
  message: 'Enter a title',
  style: 'prompt',
  onConfirm: (value) => console.log('Entered:', value)
});`,
      },
    ],
  },
  {
    id: 'sanitizer-api',
    badge: 'Sanitizer',
    title: 'Sanitizer API',
    description: 'Clean and sanitize HTML content to prevent XSS attacks.',
    methods: [
      {
        name: 'sanitizer.clean(taintString, config)',
        returnType: 'string',
        description: 'Clean HTML string using the provided sanitizer configuration.',
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
    id: 'tooltip-api',
    badge: 'Tooltip',
    title: 'Tooltip API',
    description: 'Display tooltip hints on UI elements.',
    methods: [
      {
        name: 'tooltip.show(element, content, options?)',
        returnType: 'void',
        description: 'Show a tooltip on the specified element.',
        example: `const button = document.querySelector('button');
editor.tooltip.show(button, 'Click to save', {
  placement: 'top',
  duration: 2000
});`,
      },
      {
        name: 'tooltip.hide()',
        returnType: 'void',
        description: 'Hide the currently visible tooltip.',
        example: `editor.tooltip.hide();`,
      },
      {
        name: 'tooltip.onHover(element, content, options?)',
        returnType: 'void',
        description: 'Show tooltip on hover using event listeners.',
        example: `const button = document.querySelector('button');
editor.tooltip.onHover(button, 'Click me', {
  placement: 'bottom'
});`,
      },
    ],
  },
  {
    id: 'readonly-api',
    badge: 'ReadOnly',
    title: 'ReadOnly API',
    description: 'Control the read-only state of the editor.',
    methods: [
      {
        name: 'readOnly.toggle(state?)',
        returnType: 'Promise<boolean>',
        description: 'Set or toggle read-only mode. Returns the current state.',
        example: `// Toggle current state
const isReadOnly = await editor.readOnly.toggle();

// Enable read-only
await editor.readOnly.toggle(true);

// Disable read-only
await editor.readOnly.toggle(false);`,
      },
    ],
    properties: [
      { name: 'isEnabled', type: 'boolean', description: 'Current read-only state' },
    ],
  },
  {
    id: 'i18n-api',
    badge: 'I18n',
    title: 'I18n API',
    description: 'Internationalization support for translating UI strings.',
    methods: [
      {
        name: 'i18n.t(dictKey)',
        returnType: 'string',
        description: 'Translate a key from the global dictionary.',
        example: `const text = editor.i18n.t('toolNames.paragraph');
console.log(text); // 'Paragraph' (or translated string)

const deleteText = editor.i18n.t('blockSettings.delete');`,
      },
      {
        name: 'i18n.has(dictKey)',
        returnType: 'boolean',
        description: 'Check if a translation exists for the given key.',
        example: `if (editor.i18n.has('toolNames.paragraph')) {
  const translation = editor.i18n.t('toolNames.paragraph');
}`,
      },
      {
        name: 'i18n.getEnglishTranslation(key)',
        returnType: 'string',
        description: 'Get the English translation for a key (used for multilingual search).',
        example: `const english = editor.i18n.getEnglishTranslation('toolNames.header');
console.log(english); // 'Header'`,
      },
    ],
  },
  {
    id: 'ui-api',
    badge: 'UI',
    title: 'UI API',
    description: 'Access to Blok UI elements and state.',
    properties: [
      { name: 'nodes.wrapper', type: 'HTMLElement', description: 'Top-level blok instance wrapper' },
      { name: 'nodes.redactor', type: 'HTMLElement', description: 'Element that holds all the blocks' },
      { name: 'isMobile', type: 'boolean', description: 'Whether Blok is in mobile mode' },
    ],
  },
  {
    id: 'listeners-api',
    badge: 'Listeners',
    title: 'Listeners API',
    description: 'Manage custom DOM event listeners with automatic cleanup.',
    methods: [
      {
        name: 'listeners.on(element, eventType, handler, useCapture?)',
        returnType: 'string | undefined',
        description: 'Subscribe to event on element. Returns listener ID for removal.',
        example: `const button = document.querySelector('button');
const listenerId = editor.listeners.on(button, 'click', (e) => {
  console.log('Button clicked');
});

// Store ID for later removal`,
      },
      {
        name: 'listeners.off(element, eventType, handler, useCapture?)',
        returnType: 'void',
        description: 'Unsubscribe from event on element.',
        example: `const handler = (e) => console.log('Clicked');
editor.listeners.on(button, 'click', handler);
editor.listeners.off(button, 'click', handler);`,
      },
      {
        name: 'listeners.offById(id)',
        returnType: 'void',
        description: 'Unsubscribe from event using the listener ID.',
        example: `const listenerId = editor.listeners.on(button, 'click', handler);
// Later...
editor.listeners.offById(listenerId);`,
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
        name: 'tools.getBlockTools()',
        returnType: 'BlockToolAdapter[]',
        description: 'Get all available block tool instances.',
        example: `const blockTools = editor.tools.getBlockTools();
blockTools.forEach(tool => {
  console.log('Available tool:', tool.name);
});`,
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
      { id: 'block-api', label: 'BlockAPI' },
      { id: 'caret-api', label: 'Caret' },
      { id: 'events-api', label: 'Events' },
      { id: 'saver-api', label: 'Saver' },
      { id: 'selection-api', label: 'Selection' },
      { id: 'styles-api', label: 'Styles' },
      { id: 'toolbar-api', label: 'Toolbar' },
      { id: 'inline-toolbar-api', label: 'InlineToolbar' },
      { id: 'notifier-api', label: 'Notifier' },
      { id: 'sanitizer-api', label: 'Sanitizer' },
      { id: 'tooltip-api', label: 'Tooltip' },
      { id: 'readonly-api', label: 'ReadOnly' },
      { id: 'i18n-api', label: 'I18n' },
      { id: 'ui-api', label: 'UI' },
      { id: 'listeners-api', label: 'Listeners' },
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
