import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { Paste } from '../../../../src/components/modules/paste';
import type { ToolRegistry } from '../../../../src/components/modules/paste/tool-registry';
import { SanitizerConfigBuilder } from '../../../../src/components/modules/paste/sanitizer-config';
import type { TagSubstitute } from '../../../../src/components/modules/paste/types';
import { BlokDataHandler } from '../../../../src/components/modules/paste/handlers/blok-data-handler';
import { FilesHandler } from '../../../../src/components/modules/paste/handlers/files-handler';
import { HtmlHandler } from '../../../../src/components/modules/paste/handlers/html-handler';
import { PatternHandler } from '../../../../src/components/modules/paste/handlers/pattern-handler';
import { TextHandler } from '../../../../src/components/modules/paste/handlers/text-handler';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';
import type { SanitizerConfig } from '../../../../types/configs/sanitizer-config';
import * as sanitizer from '../../../../src/components/utils/sanitizer';
import { Listeners } from '../../../../src/components/utils/listeners';
import * as utils from '../../../../src/components/utils';

/**
 * Mock DataTransfer class for testing.
 * In Node.js environment, DataTransfer is not available.
 */
class MockDataTransfer implements DataTransfer {
  dropEffect: 'none' | 'copy' | 'link' | 'move' = 'none';
  effectAllowed: 'none' | 'copy' | 'copyLink' | 'copyMove' | 'link' | 'linkMove' | 'all' | 'move' | 'uninitialized' = 'uninitialized';
  files: FileList;
  items: DataTransferItemList;
  types: string[];

  private data: Record<string, string> = {};

  constructor(data: Record<string, string>, files: FileList = {} as FileList, types: string[] = []) {
    this.data = data;
    this.files = files;
    this.types = types;
    this.items = [] as unknown as DataTransferItemList;
  }

  getData(format: string): string {
    return this.data[format] || '';
  }

  setData(format: string, data: string): void {
    this.data[format] = data;
  }

  clearData(format?: string): void {
    if (format) {
      delete this.data[format];
    } else {
      this.data = {};
    }
  }

  setDragImage(_image: Element, _x: number, _y: number): void {
    // Mock implementation
  }

  readonly element: HTMLElement | null = null;
}

interface CreatePasteOptions {
  defaultBlock?: string;
  sanitizer?: SanitizerConfig;
  defaultTool?: BlockToolAdapter;
}

type ListenersMock = {
  instance: Listeners;
  on: MockInstance<Listeners['on']>;
  off: MockInstance<Listeners['off']>;
};

type BlockManagerMock = {
  currentBlock: {
    tool: {
      isDefault: boolean;
      baseSanitizeConfig?: SanitizerConfig;
    };
    isEmpty: boolean;
    name?: string;
    currentInput?: HTMLElement | null;
  } | null;
  paste: ReturnType<typeof vi.fn<(tool: string, event: CustomEvent, replace?: boolean) => unknown>>;
  insert: ReturnType<typeof vi.fn<(payload: { tool: string; data: unknown; replace: boolean }) => unknown>>;
  setCurrentBlockByChildNode: ReturnType<typeof vi.fn<(node: HTMLElement) => unknown>>;
};

type CaretMock = {
  positions: {
    END: string;
  };
  setToBlock: ReturnType<typeof vi.fn<(block: unknown, position: string) => void>>;
  insertContentAtCaretPosition: ReturnType<typeof vi.fn<(content: string) => void>>;
};

type ToolsMock = {
  blockTools: Map<string, BlockToolAdapter>;
  defaultTool: BlockToolAdapter;
  getAllInlineToolsSanitizeConfig: ReturnType<typeof vi.fn<() => SanitizerConfig>>;
};

type ToolbarMock = {
  close: ReturnType<typeof vi.fn<() => void>>;
};

type PasteMocks = {
  listeners: ListenersMock;
  BlockManager: BlockManagerMock;
  Caret: CaretMock;
  Tools: ToolsMock;
  Toolbar: ToolbarMock;
  holder: HTMLElement;
};

const createPaste = (options?: CreatePasteOptions): { paste: Paste; mocks: PasteMocks } => {
  const holder = document.createElement('div');
  const defaultBlockName = options?.defaultBlock ?? 'paragraph';
  const defaultTool = options?.defaultTool ?? ({
    name: defaultBlockName,
    pasteConfig: {},
    baseSanitizeConfig: {},
  } as unknown as BlockToolAdapter);

  const listenersInstance = new Listeners();
  const listeners: ListenersMock = {
    instance: listenersInstance,
    on: vi.spyOn(listenersInstance, 'on'),
    off: vi.spyOn(listenersInstance, 'off'),
  };

  const blockManager: BlockManagerMock = {
    currentBlock: null,
    paste: vi.fn<(tool: string, event: CustomEvent, replace?: boolean) => unknown>(),
    insert: vi.fn<(payload: { tool: string; data: unknown; replace: boolean }) => unknown>(),
    setCurrentBlockByChildNode: vi.fn<(node: HTMLElement) => unknown>(),
  };

  const caret: CaretMock = {
    positions: {
      END: 'end',
    },
    setToBlock: vi.fn<(block: unknown, position: string) => void>(),
    insertContentAtCaretPosition: vi.fn<(content: string) => void>(),
  };

  const tools: ToolsMock = {
    blockTools: new Map<string, BlockToolAdapter>(),
    defaultTool,
    getAllInlineToolsSanitizeConfig: vi.fn<() => SanitizerConfig>(() => ({})),
  };

  const toolbar: ToolbarMock = {
    close: vi.fn<() => void>(),
  };

  const paste = new Paste({
    config: {
      defaultBlock: options?.defaultBlock ?? 'paragraph',
      sanitizer: options?.sanitizer ?? {},
    },
    eventsDispatcher: {
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Paste['eventsDispatcher'],
  });

  const pasteWithInternals = paste as unknown as { listeners: Listeners; state: Paste['Blok'] };

  pasteWithInternals.listeners = listeners.instance;

  const blokState = {
    BlockManager: blockManager,
    Caret: caret,
    Tools: tools,
    Toolbar: toolbar,
    UI: {
      nodes: {
        holder,
      },
    },
  };

  pasteWithInternals.state = blokState as unknown as Paste['Blok'];

  return {
    paste,
    mocks: {
      listeners,
      BlockManager: blockManager,
      Caret: caret,
      Tools: tools,
      Toolbar: toolbar,
      holder,
    },
  };
};

describe('Paste module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ToolRegistry', () => {
    it('collects tool configurations during processTools', async () => {
      const { paste, mocks } = createPaste();

      const firstTool = {
        name: 'first',
        create: vi.fn(() => ({ onPaste: vi.fn() })),
        pasteConfig: {},
        baseSanitizeConfig: {},
        hasOnPasteHandler: true,
      } as unknown as BlockToolAdapter;

      const secondTool = {
        name: 'second',
        create: vi.fn(() => ({ onPaste: vi.fn() })),
        pasteConfig: {},
        baseSanitizeConfig: {},
        hasOnPasteHandler: true,
      } as unknown as BlockToolAdapter;

      mocks.Tools.blockTools.set('first', firstTool);
      mocks.Tools.blockTools.set('second', secondTool);

      await paste.prepare();

      const toolRegistry = (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry;

      expect(toolRegistry.toolsTags).toBeDefined();
      expect(toolRegistry.tagsByTool).toBeDefined();
      expect(toolRegistry.toolsFiles).toBeDefined();
      expect(toolRegistry.toolsPatterns).toBeDefined();
    });

    it('adds tools with disabled paste config to exception list', async () => {
      const { paste, mocks } = createPaste();

      const tool = {
        name: 'skip-tool',
        create: vi.fn(() => ({ onPaste: vi.fn() })),
        pasteConfig: false,
        baseSanitizeConfig: {},
        hasOnPasteHandler: true,
      } as unknown as BlockToolAdapter;

      mocks.Tools.blockTools.set('skip-tool', tool);

      await paste.prepare();

      const toolRegistry = (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry;

      expect(toolRegistry.exceptionList).toContain('skip-tool');
    });

    it('skips tools without onPaste handler when processing paste config', async () => {
      const { paste, mocks } = createPaste();

      const tool = {
        name: 'incompatible',
        create: vi.fn(() => ({})),
        pasteConfig: {},
        baseSanitizeConfig: {},
        hasOnPasteHandler: false,
      } as unknown as BlockToolAdapter;

      mocks.Tools.blockTools.set('incompatible', tool);

      await paste.prepare();

      const toolRegistry = (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry;

      expect(toolRegistry.tagsByTool[tool.name]).toBeUndefined();
    });

    it('collects tag, file and pattern configs for eligible tools', async () => {
      const { paste, mocks } = createPaste();

      const tool = {
        name: 'handler',
        create: vi.fn(() => ({ onPaste: vi.fn() })),
        hasOnPasteHandler: true,
        pasteConfig: {
          tags: ['P'],
          files: {
            extensions: ['jpg'],
            mimeTypes: ['image/png'],
          },
          patterns: {
            link: /example/,
          },
        },
        baseSanitizeConfig: {},
      } as unknown as BlockToolAdapter;

      mocks.Tools.blockTools.set('handler', tool);

      await paste.prepare();

      const toolRegistry = (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry;

      expect(toolRegistry.toolsTags['P']).toBeDefined();
      expect(toolRegistry.toolsFiles['handler']).toBeDefined();
      expect(toolRegistry.toolsPatterns).toHaveLength(1);
    });

    it('collects tags from paste config and prevents duplicates', async () => {
      const { paste, mocks } = createPaste();
      const logSpy = vi.spyOn(utils, 'log').mockImplementation(() => undefined);

      const firstTool = {
        name: 'first',
        pasteConfig: {
          tags: ['DIV', { table: { tr: {} } }],
        },
        hasOnPasteHandler: true,
        baseSanitizeConfig: {},
      } as unknown as BlockToolAdapter;

      const secondTool = {
        name: 'second',
        pasteConfig: {
          tags: ['DIV'],
        },
        hasOnPasteHandler: true,
        baseSanitizeConfig: {},
      } as unknown as BlockToolAdapter;

      mocks.Tools.blockTools.set('first', firstTool);
      mocks.Tools.blockTools.set('second', secondTool);

      await paste.prepare();

      const toolRegistry = (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry;

      expect(toolRegistry.toolsTags['DIV'].tool).toBe(firstTool);
      expect(toolRegistry.toolsTags['TABLE'].tool).toBe(firstTool);
      expect(toolRegistry.tagsByTool[firstTool.name]).toEqual(['DIV', 'TABLE']);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Paste handler for «second» Tool on «DIV» tag is skipped'),
        'warn'
      );

      logSpy.mockRestore();
    });

    it('normalizes file configurations and warns for invalid values', async () => {
      const { paste, mocks } = createPaste();
      const logSpy = vi.spyOn(utils, 'log').mockImplementation(() => undefined);

      const tool = {
        name: 'files',
        pasteConfig: {
          files: {
            extensions: 'jpg' as unknown as string[],
            mimeTypes: ['image/png', 'invalid'],
          },
        },
        hasOnPasteHandler: true,
        baseSanitizeConfig: {},
      } as unknown as BlockToolAdapter;

      mocks.Tools.blockTools.set('files', tool);

      await paste.prepare();

      const toolRegistry = (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry;

      expect(toolRegistry.toolsFiles['files']).toEqual({
        extensions: [],
        mimeTypes: ['image/png'],
      });
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('«extensions» property of the paste config')
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('MIME type value «invalid»'),
        'warn'
      );

      logSpy.mockRestore();
    });

    it('stores valid patterns and warns when non-RegExp values are provided', async () => {
      const { paste, mocks } = createPaste();
      const logSpy = vi.spyOn(utils, 'log').mockImplementation(() => undefined);

      const tool = {
        name: 'patterns',
        pasteConfig: {
          patterns: {
            link: /example/,
            invalid: 'string' as unknown as RegExp,
          },
        },
        hasOnPasteHandler: true,
        baseSanitizeConfig: {},
      } as unknown as BlockToolAdapter;

      mocks.Tools.blockTools.set('patterns', tool);

      await paste.prepare();

      const toolRegistry = (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry;

      expect(toolRegistry.toolsPatterns).toHaveLength(2);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('should be a Regexp instance'),
        'warn'
      );

      logSpy.mockRestore();
    });
  });

  describe('Paste class public API', () => {
    it('registers and removes paste listener when toggling read-only state', () => {
      const { paste, mocks } = createPaste();

      paste.toggleReadOnly(false);

      expect(mocks.listeners.on).toHaveBeenCalledTimes(1);
      expect(mocks.listeners.on).toHaveBeenCalledWith(
        mocks.holder,
        'paste',
        expect.any(Function)
      );

      const [, , handler] = mocks.listeners.on.mock.calls[0];

      mocks.listeners.on.mockClear();

      paste.toggleReadOnly(true);

      expect(mocks.listeners.off).toHaveBeenCalledTimes(1);
      expect(mocks.listeners.off).toHaveBeenCalledWith(
        mocks.holder,
        'paste',
        handler
      );
      expect(mocks.listeners.on).not.toHaveBeenCalled();
    });

    it('processes plain text via processText', async () => {
      const { paste, mocks } = createPaste();

      mocks.Tools.blockTools.set('paragraph', mocks.Tools.defaultTool);

      await paste.prepare();

      mocks.BlockManager.currentBlock = {
        tool: {
          isDefault: true,
        },
        isEmpty: true,
      };

      mocks.BlockManager.paste.mockReturnValue({ id: 'block-id' });

      await paste.processText('Hello world', false);

      expect(mocks.BlockManager.paste).toHaveBeenCalled();
    });

    it('processes HTML via processText with isHTML flag', async () => {
      const { paste, mocks } = createPaste();

      mocks.Tools.blockTools.set('paragraph', mocks.Tools.defaultTool);

      await paste.prepare();

      mocks.BlockManager.currentBlock = {
        tool: {
          isDefault: true,
        },
        isEmpty: true,
      };

      mocks.BlockManager.paste.mockReturnValue({ id: 'block-id' });

      await paste.processText('<p>Hello world</p>', true);

      expect(mocks.BlockManager.paste).toHaveBeenCalled();
    });

    it('detects native inputs when checking for native behaviour', () => {
      const { paste } = createPaste();

      const input = document.createElement('input');
      const div = document.createElement('div');

      expect((paste as unknown as { isNativeBehaviour(element: EventTarget): boolean }).isNativeBehaviour(input)).toBe(true);
      expect((paste as unknown as { isNativeBehaviour(element: EventTarget): boolean }).isNativeBehaviour(div)).toBe(false);
    });
  });

  describe('FilesHandler', () => {
    it('processes matched files via BlockManager and replaces current default block', async () => {
      const { paste, mocks } = createPaste();

      await paste.prepare();

      // Register a file tool
      const imageTool = {
        name: 'imageTool',
        pasteConfig: {
          files: {
            extensions: ['png'],
            mimeTypes: ['image/*'],
          },
        },
        hasOnPasteHandler: true,
        baseSanitizeConfig: {},
      } as unknown as BlockToolAdapter;

      mocks.Tools.blockTools.set('imageTool', imageTool);

      // Re-prepare to reprocess tools
      await paste.prepare();

      mocks.BlockManager.currentBlock = {
        tool: {
          isDefault: true,
        },
        isEmpty: true,
      };

      const file = new File(['content'], 'example.png', { type: 'image/png' });
      const fileList = {
        length: 1,
        item(index: number): File | null {
          return index === 0 ? file : null;
        },
        [0]: file,
      } as unknown as FileList;

      const dataTransfer = new MockDataTransfer({}, fileList, ['Files']);

      await paste.processDataTransfer(dataTransfer);

      expect(mocks.BlockManager.paste).toHaveBeenCalledTimes(1);

      const [tool, event, shouldReplace] = mocks.BlockManager.paste.mock.calls[0];

      expect(tool).toBe('imageTool');
      expect(event).toBeInstanceOf(CustomEvent);
      expect(event.type).toBe('file');
      expect(event.detail.file).toBe(file);
      expect(shouldReplace).toBe(true);
    });
  });

  describe('PatternHandler', () => {
    it('substitutes pattern matches on inline paste and replaces current default block', async () => {
      const { paste, mocks } = createPaste();

      const patternTool = {
        name: 'link',
        pasteConfig: {
          patterns: {
            link: /^https:\/\/example\.com$/,
          },
        },
        baseSanitizeConfig: {},
        hasOnPasteHandler: true,
      } as unknown as BlockToolAdapter;

      mocks.Tools.blockTools.set('link', patternTool);

      await paste.prepare();

      mocks.BlockManager.currentBlock = {
        tool: {
          isDefault: true,
          baseSanitizeConfig: {},
        },
        isEmpty: true,
        name: 'paragraph',
        currentInput: document.createElement('div'),
      };

      mocks.BlockManager.paste.mockImplementation((_tool, _event, replace) => {
        expect(replace).toBe(true);

        return { id: 'link-block' };
      });

      const dataTransfer = new MockDataTransfer(
        { 'text/plain': 'https://example.com' },
        { length: 0 } as FileList,
        ['text/plain']
      );

      await paste.processDataTransfer(dataTransfer);

      expect(mocks.BlockManager.paste).toHaveBeenCalledTimes(1);

      const [tool, event] = mocks.BlockManager.paste.mock.calls[0];

      expect(tool).toBe('link');
      expect(event).toBeInstanceOf(CustomEvent);
      expect(event.type).toBe('pattern');
      expect(event.detail.data).toBe('https://example.com');
      expect(event.detail.key).toBe('link');
      expect(mocks.Caret.setToBlock).toHaveBeenCalledWith({ id: 'link-block' }, mocks.Caret.positions.END);
    });

    it('inserts sanitized inline content when no pattern matches and current input exists', async () => {
      const { paste, mocks } = createPaste();

      await paste.prepare();

      const cleanSpy = vi.spyOn(sanitizer, 'clean').mockReturnValue('sanitized-content');

      mocks.BlockManager.currentBlock = {
        tool: {
          isDefault: false,
          baseSanitizeConfig: {
            b: {},
          },
        },
        isEmpty: false,
        name: 'paragraph',
        currentInput: document.createElement('div'),
      };

      const dataTransfer = new MockDataTransfer(
        {
          'text/plain': '<b>Example</b>',
          'text/html': '<b>Example</b>',
        },
        { length: 0 } as FileList,
        ['text/plain', 'text/html']
      );

      await paste.processDataTransfer(dataTransfer);

      expect(cleanSpy).toHaveBeenCalled();
      expect(mocks.Caret.insertContentAtCaretPosition).toHaveBeenCalledWith('sanitized-content');
      expect(mocks.BlockManager.paste).not.toHaveBeenCalled();
    });
  });

  describe('BlokDataHandler', () => {
    it('inserts sanitized Blok data and updates caret position', async () => {
      const { paste, mocks } = createPaste();

      await paste.prepare();

      const sanitizeBlocksSpy = vi.spyOn(sanitizer, 'sanitizeBlocks').mockReturnValue([
        {
          tool: 'image',
          data: { src: 'image.png' },
        },
        {
          tool: 'paragraph',
          data: { text: 'Hello' },
        },
      ]);

      mocks.BlockManager.currentBlock = {
        tool: {
          isDefault: true,
        },
        isEmpty: true,
      };

      const insertedBlocks: Array<{ tool: string; data: unknown; replace: boolean }> = [];

      mocks.BlockManager.insert.mockImplementation((payload) => {
        insertedBlocks.push(payload);

        return { id: `${payload.tool}-id` };
      });

      const dataTransfer = new MockDataTransfer(
        {
          'application/x-blok': JSON.stringify([
            {
              id: '1',
              tool: 'image',
              data: { src: 'image.png' },
            },
            {
              id: '2',
              tool: 'paragraph',
              data: { text: 'Hello' },
            },
          ]),
          'text/plain': '',
        },
        { length: 0 } as FileList,
        ['application/x-blok', 'text/plain']
      );

      await paste.processDataTransfer(dataTransfer);

      expect(sanitizeBlocksSpy).toHaveBeenCalledTimes(1);
      expect(insertedBlocks).toEqual([
        {
          tool: 'image',
          data: { src: 'image.png' },
          replace: true,
        },
        {
          tool: 'paragraph',
          data: { text: 'Hello' },
          replace: false,
        },
      ]);
      expect(mocks.Caret.setToBlock).toHaveBeenNthCalledWith(1, { id: 'image-id' }, mocks.Caret.positions.END);
      expect(mocks.Caret.setToBlock).toHaveBeenNthCalledWith(2, { id: 'paragraph-id' }, mocks.Caret.positions.END);
    });

    it('checks patterns when pasting Blok data containing pattern-matching text', async () => {
      const { paste, mocks } = createPaste();

      const patternTool = {
        name: 'embed',
        pasteConfig: {
          patterns: {
            url: /^https:\/\/example\.com$/,
          },
        },
        baseSanitizeConfig: {},
        hasOnPasteHandler: true,
      } as unknown as BlockToolAdapter;

      mocks.Tools.blockTools.set('embed', patternTool);

      await paste.prepare();

      mocks.BlockManager.currentBlock = {
        tool: {
          isDefault: true,
          baseSanitizeConfig: {},
        },
        isEmpty: true,
        name: 'paragraph',
        currentInput: document.createElement('div'),
      };

      mocks.BlockManager.paste.mockReturnValue({ id: 'embed-block' });

      // Simulate pasting Blok data that contains a URL
      const dataTransfer = new MockDataTransfer(
        {
          'application/x-blok': JSON.stringify([
            {
              id: '1',
              tool: 'paragraph',
              data: { text: 'https://example.com' },
            },
          ]),
          'text/plain': 'https://example.com',
          'text/html': '',
        },
        { length: 0 } as FileList,
        ['application/x-blok', 'text/plain', 'text/html']
      );

      await paste.processDataTransfer(dataTransfer);

      // Should trigger pattern paste
      expect(mocks.BlockManager.paste).toHaveBeenCalledTimes(1);

      const [tool, event] = mocks.BlockManager.paste.mock.calls[0];

      expect(tool).toBe('embed');
      expect(event).toBeInstanceOf(CustomEvent);
      expect(event.type).toBe('pattern');
      expect(event.detail.data).toBe('https://example.com');
    });

    it('uses Blok data directly when no pattern matches', async () => {
      const { paste, mocks } = createPaste();

      const patternTool = {
        name: 'embed',
        pasteConfig: {
          patterns: {
            youtube: /^https:\/\/www\.youtube\.com\/watch/,
          },
        },
        baseSanitizeConfig: {},
        hasOnPasteHandler: true,
      } as unknown as BlockToolAdapter;

      mocks.Tools.blockTools.set('embed', patternTool);

      await paste.prepare();

      mocks.BlockManager.currentBlock = {
        tool: {
          isDefault: true,
        },
        isEmpty: true,
      };

      vi.spyOn(sanitizer, 'sanitizeBlocks').mockReturnValue([
        {
          tool: 'paragraph',
          data: { text: 'Hello world' },
        },
      ]);

      mocks.BlockManager.insert.mockReturnValue({ id: 'paragraph-id' });

      const dataTransfer = new MockDataTransfer(
        {
          'application/x-blok': JSON.stringify([
            {
              id: '1',
              tool: 'paragraph',
              data: { text: 'Hello world' },
            },
          ]),
          'text/plain': 'Hello world',
          'text/html': '',
        },
        { length: 0 } as FileList,
        ['application/x-blok', 'text/plain', 'text/html']
      );

      await paste.processDataTransfer(dataTransfer);

      expect(mocks.BlockManager.paste).not.toHaveBeenCalled();
      expect(mocks.BlockManager.insert).toHaveBeenCalledWith({
        tool: 'paragraph',
        data: { text: 'Hello world' },
        replace: true,
      });
    });

    it('uses Blok data when plain text does not match any pattern', async () => {
      const { paste, mocks } = createPaste();

      const patternTool = {
        name: 'embed',
        pasteConfig: {
          patterns: {
            url: /^https:\/\/example\.com$/,
          },
        },
        baseSanitizeConfig: {},
        hasOnPasteHandler: true,
      } as unknown as BlockToolAdapter;

      mocks.Tools.blockTools.set('embed', patternTool);

      await paste.prepare();

      mocks.BlockManager.currentBlock = {
        tool: {
          isDefault: true,
        },
        isEmpty: true,
      };

      vi.spyOn(sanitizer, 'sanitizeBlocks').mockReturnValue([
        {
          tool: 'paragraph',
          data: { text: 'First block' },
        },
        {
          tool: 'paragraph',
          data: { text: 'Second block' },
        },
      ]);

      mocks.BlockManager.insert.mockReturnValue({ id: 'block-id' });

      const dataTransfer = new MockDataTransfer(
        {
          'application/x-blok': JSON.stringify([
            {
              id: '1',
              tool: 'paragraph',
              data: { text: 'First block' },
            },
            {
              id: '2',
              tool: 'paragraph',
              data: { text: 'Second block' },
            },
          ]),
          'text/plain': 'First block\n\nSecond block',
          'text/html': '',
        },
        { length: 0 } as FileList,
        ['application/x-blok', 'text/plain', 'text/html']
      );

      await paste.processDataTransfer(dataTransfer);

      expect(mocks.BlockManager.paste).not.toHaveBeenCalled();
      expect(mocks.BlockManager.insert).toHaveBeenCalledTimes(2);

      const firstCall = mocks.BlockManager.insert.mock.calls[0][0];
      const secondCall = mocks.BlockManager.insert.mock.calls[1][0];

      expect(firstCall).toEqual({
        tool: 'paragraph',
        data: { text: 'First block' },
        replace: true,
      });
      expect(secondCall).toEqual({
        tool: 'paragraph',
        data: { text: 'Second block' },
        replace: false,
      });

      expect(mocks.Caret.setToBlock).toHaveBeenCalledWith({ id: 'block-id' }, mocks.Caret.positions.END);
    });
  });

  describe('TextHandler', () => {
    it('splits plain text by new lines and creates entries', async () => {
      const { paste, mocks } = createPaste();

      mocks.Tools.blockTools.set('paragraph', mocks.Tools.defaultTool);

      await paste.prepare();

      const textHandler = new TextHandler(
        paste as unknown as Paste['Blok'],
        (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
        (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder,
        { defaultBlock: 'paragraph' }
      );

      const result = (textHandler as unknown as { processPlain(plain: string): unknown[] }).processPlain('First\n\nSecond');

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        tool: 'paragraph',
      });
      expect((result[0] as { content: HTMLElement }).content).toHaveTextContent('First');
      expect((result[0] as { event: CustomEvent }).event.type).toBe('tag');
      expect((result[1] as { content: HTMLElement }).content).toHaveTextContent('Second');
    });

    it('filters out whitespace-only lines when processing plain text', async () => {
      const { paste, mocks } = createPaste();

      mocks.Tools.blockTools.set('paragraph', mocks.Tools.defaultTool);

      await paste.prepare();

      const textHandler = new TextHandler(
        paste as unknown as Paste['Blok'],
        (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
        (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder,
        { defaultBlock: 'paragraph' }
      );

      const result = (textHandler as unknown as { processPlain(plain: string): unknown[] }).processPlain('line1\n   \nline2\n\nline3');

      // Whitespace-only lines should be filtered out
      expect(result).toHaveLength(3);
      expect((result[0] as { content: HTMLElement }).content).toHaveTextContent('line1');
      expect((result[1] as { content: HTMLElement }).content).toHaveTextContent('line2');
      expect((result[2] as { content: HTMLElement }).content).toHaveTextContent('line3');
    });

    it('filters out tabs-only lines when processing plain text', async () => {
      const { paste, mocks } = createPaste();

      mocks.Tools.blockTools.set('paragraph', mocks.Tools.defaultTool);

      await paste.prepare();

      const textHandler = new TextHandler(
        paste as unknown as Paste['Blok'],
        (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
        (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder,
        { defaultBlock: 'paragraph' }
      );

      const result = (textHandler as unknown as { processPlain(plain: string): unknown[] }).processPlain('line1\n\t\t\nline2');

      expect(result).toHaveLength(2);
      expect((result[0] as { content: HTMLElement }).content).toHaveTextContent('line1');
      expect((result[1] as { content: HTMLElement }).content).toHaveTextContent('line2');
    });

    it('filters out mixed whitespace-only lines when processing plain text', async () => {
      const { paste, mocks } = createPaste();

      mocks.Tools.blockTools.set('paragraph', mocks.Tools.defaultTool);

      await paste.prepare();

      const textHandler = new TextHandler(
        paste as unknown as Paste['Blok'],
        (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
        (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder,
        { defaultBlock: 'paragraph' }
      );

      const result = (textHandler as unknown as { processPlain(plain: string): unknown[] }).processPlain('line1\n \t \nline2');

      expect(result).toHaveLength(2);
      expect((result[0] as { content: HTMLElement }).content).toHaveTextContent('line1');
      expect((result[1] as { content: HTMLElement }).content).toHaveTextContent('line2');
    });
  });

  describe('HtmlHandler', () => {
    it('processes HTML fragments, default block content and substituted tags', async () => {
      const { paste, mocks } = createPaste();

      const defaultTool = {
        name: 'paragraph',
        pasteConfig: {},
        baseSanitizeConfig: {},
        hasOnPasteHandler: true,
      } as unknown as BlockToolAdapter;

      const headingTool = {
        name: 'header',
        pasteConfig: {
          tags: ['h1'],
        },
        baseSanitizeConfig: {},
        hasOnPasteHandler: true,
      } as unknown as BlockToolAdapter;

      mocks.Tools.defaultTool = defaultTool;
      mocks.Tools.blockTools.set('paragraph', defaultTool);
      mocks.Tools.blockTools.set('header', headingTool);

      await paste.prepare();

      const cleanSpy = vi.spyOn(sanitizer, 'clean').mockImplementation((html: string) => html.replace(/<script>.*?<\/script>/g, ''));

      mocks.BlockManager.currentBlock = {
        tool: {
          isDefault: true,
        },
        isEmpty: true,
      };

      mocks.BlockManager.paste.mockReturnValue({ id: 'block-id' });

      const html = '<span>Inline</span><div>Content</div><h1><script>bad()</script>Heading</h1>';

      await paste.processText(html, true);

      expect(mocks.BlockManager.paste).toHaveBeenCalledTimes(3);
      expect(cleanSpy).toHaveBeenCalled();
    });
  });

  describe('Handler priority system', () => {
    it('uses correct handler priority for different data types', async () => {
      const { paste, mocks } = createPaste();

      mocks.Tools.blockTools.set('paragraph', mocks.Tools.defaultTool);

      await paste.prepare();

      const handlers = (paste as unknown as { handlers: unknown[] }).handlers;

      expect(handlers).toBeDefined();
      expect(handlers.length).toBeGreaterThan(0);

      // BlokDataHandler should have highest priority (100)
      const blokHandler = handlers.find((h): h is BlokDataHandler => h instanceof BlokDataHandler);
      expect(blokHandler).toBeDefined();

      // FilesHandler should have priority 80
      const filesHandler = handlers.find((h): h is FilesHandler => h instanceof FilesHandler);
      expect(filesHandler).toBeDefined();

      // PatternHandler should have priority 60
      const patternHandler = handlers.find((h): h is PatternHandler => h instanceof PatternHandler);
      expect(patternHandler).toBeDefined();

      // HtmlHandler should have priority 40
      const htmlHandler = handlers.find((h): h is HtmlHandler => h instanceof HtmlHandler);
      expect(htmlHandler).toBeDefined();

      // TextHandler should have lowest priority (10)
      const textHandler = handlers.find((h): h is TextHandler => h instanceof TextHandler);
      expect(textHandler).toBeDefined();

      // Verify order - highest priority first
      expect(handlers[0]).toBe(blokHandler);
      expect(handlers[1]).toBe(filesHandler);
      expect(handlers[2]).toBe(patternHandler);
      expect(handlers[3]).toBe(htmlHandler);
      expect(handlers[4]).toBe(textHandler);
    });

    it('BlokDataHandler returns priority 100 for valid JSON', () => {
      const { paste } = createPaste();

      const handler = new BlokDataHandler(
        paste as unknown as Paste['Blok'],
        (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
        (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder,
        {}
      );

      const validJson = JSON.stringify([{ tool: 'paragraph', data: { text: 'test' } }]);

      expect(handler.canHandle(validJson)).toBe(100);
      expect(handler.canHandle('not json')).toBe(0);
      expect(handler.canHandle(123)).toBe(0);
    });

    it('FilesHandler returns priority 80 for DataTransfer with files', () => {
      const { paste, mocks } = createPaste();

      mocks.Tools.blockTools.set('paragraph', mocks.Tools.defaultTool);

      const handler = new FilesHandler(
        paste as unknown as Paste['Blok'],
        (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
        (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder
      );

      const file = new File(['content'], 'test.png', { type: 'image/png' });
      const dataTransferWithFiles = new MockDataTransfer({}, {
        length: 1,
        0: file,
        item: (index: number) => index === 0 ? file : null,
      } as unknown as FileList, ['Files']);

      const dataTransferWithoutFiles = new MockDataTransfer({}, { length: 0 } as FileList, ['text/plain']);

      expect(handler.canHandle(dataTransferWithFiles)).toBe(80);
      expect(handler.canHandle(dataTransferWithoutFiles)).toBe(0);
      expect(handler.canHandle('string')).toBe(0);
    });

    it('PatternHandler returns priority 60 for matching patterns', async () => {
      const { paste, mocks } = createPaste();

      const patternTool = {
        name: 'link',
        pasteConfig: {
          patterns: {
            url: /^https:\/\/example\.com$/,
          },
        },
        baseSanitizeConfig: {},
        hasOnPasteHandler: true,
      } as unknown as BlockToolAdapter;

      mocks.Tools.blockTools.set('link', patternTool);

      await paste.prepare();

      const handler = new PatternHandler(
        paste as unknown as Paste['Blok'],
        (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
        (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder
      );

      expect(handler.canHandle('https://example.com')).toBe(60);
      expect(handler.canHandle('no match')).toBe(0);
      expect(handler.canHandle(123)).toBe(0);
    });

    it('HtmlHandler returns priority 40 for HTML strings', () => {
      const { paste } = createPaste();

      const handler = new HtmlHandler(
        paste as unknown as Paste['Blok'],
        (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
        (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder
      );

      expect(handler.canHandle('<p>Hello</p>')).toBe(40);
      expect(handler.canHandle('   <p>Hello</p>   ')).toBe(40);
      expect(handler.canHandle('plain text')).toBe(0);
      expect(handler.canHandle('')).toBe(0);
      expect(handler.canHandle(123)).toBe(0);
    });

    it('TextHandler returns priority 10 for any string', () => {
      const { paste } = createPaste();

      const handler = new TextHandler(
        paste as unknown as Paste['Blok'],
        (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
        (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder,
        { defaultBlock: 'paragraph' }
      );

      expect(handler.canHandle('any string')).toBe(10);
      expect(handler.canHandle('')).toBe(0);
      expect(handler.canHandle(123)).toBe(0);
    });
  });

  describe('SanitizerConfigBuilder', () => {
    let builder: SanitizerConfigBuilder;

    beforeEach(() => {
      builder = new SanitizerConfigBuilder(
        new Map() as unknown as SanitizerConfigBuilder['tools'],
        {} as SanitizerConfigBuilder['config']
      );
    });

    it('buildToolsTagsConfig creates config with lowercase tag names', () => {
      const toolsTags: { [tag: string]: TagSubstitute } = {
        'P': { tool: {} as BlockToolAdapter, sanitizationConfig: {} },
        'DIV': { tool: {} as BlockToolAdapter, sanitizationConfig: { class: 'test' } },
        'H1': { tool: {} as BlockToolAdapter },
      };

      const result = builder.buildToolsTagsConfig(toolsTags);

      expect(result).toEqual({
        'p': {},
        'div': { class: 'test' },
        'h1': {},
      });
    });

    it('buildToolsTagsConfig uses empty config when sanitizationConfig is undefined', () => {
      const toolsTags = {
        'SPAN': { tool: {} as BlockToolAdapter },
      };

      const result = builder.buildToolsTagsConfig(toolsTags);

      expect(result).toEqual({
        'span': {},
      });
    });

    it('getStructuralTagsConfig detects table tags in HTML', () => {
      const html = '<table><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Data</td></tr></tbody></table>';
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;

      const result = builder.getStructuralTagsConfig(wrapper);

      expect(result).toEqual({
        'table': {},
        'thead': {},
        'tbody': {},
        'tr': {},
        'th': {},
        'td': {},
      });
    });

    it('getStructuralTagsConfig detects list tags in HTML', () => {
      const html = '<ul><li>Item 1</li><li>Item 2</li></ul><ol><li>Ordered</li></ol>';
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;

      const result = builder.getStructuralTagsConfig(wrapper);

      expect(result).toEqual({
        'ul': {},
        'li': {},
        'ol': {},
      });
    });

    it('getStructuralTagsConfig detects definition list tags', () => {
      const html = '<dl><dt>Term</dt><dd>Definition</dd></dl>';
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;

      const result = builder.getStructuralTagsConfig(wrapper);

      expect(result).toEqual({
        'dl': {},
        'dt': {},
        'dd': {},
      });
    });

    it('getStructuralTagsConfig handles nested structural tags', () => {
      const html = '<table><tr><td><ul><li>Nested</li></ul></td></tr></table>';
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;

      const result = builder.getStructuralTagsConfig(wrapper);

      // Note: browser automatically adds tbody to tables
      expect(result).toEqual({
        'table': {},
        'tbody': {},
        'tr': {},
        'td': {},
        'ul': {},
        'li': {},
      });
    });

    it('getStructuralTagsConfig ignores non-structural tags', () => {
      const html = '<div><span>Text</span><p>Paragraph</p><b>Bold</b></div>';
      const wrapper = document.createElement('div');
      wrapper.innerHTML = html;

      const result = builder.getStructuralTagsConfig(wrapper);

      expect(result).toEqual({});
    });

    it('getStructuralTagsConfig handles empty element', () => {
      const emptyElement = document.createElement('div');

      const result = builder.getStructuralTagsConfig(emptyElement);

      expect(result).toEqual({});
    });

    it('buildToolConfig returns empty config when pasteConfig is false', () => {
      const tool = {
        pasteConfig: false,
      } as unknown as BlockToolAdapter;

      const result = builder.buildToolConfig(tool);

      expect(result).toEqual({});
    });

    it('buildToolConfig extracts tags from string array', () => {
      const tool = {
        pasteConfig: {
          tags: ['P', 'DIV', 'H1'],
        },
      } as unknown as BlockToolAdapter;

      const result = builder.buildToolConfig(tool);

      expect(result).toEqual({
        'p': {},
        'div': {},
        'h1': {},
      });
    });

    it('buildToolConfig extracts tags and sanitization configs from object', () => {
      const tool = {
        pasteConfig: {
          tags: [
            { 'p': { class: 'paragraph' } },
            { 'div': { id: true } },
          ],
        },
      } as unknown as BlockToolAdapter;

      const result = builder.buildToolConfig(tool);

      expect(result).toEqual({
        'p': { class: 'paragraph' },
        'div': { id: true },
      });
    });

    it('buildToolConfig handles mixed string and config array', () => {
      const tool = {
        pasteConfig: {
          tags: [
            'P',
            { 'div': { class: 'wrapper' } },
            'SPAN',
          ],
        },
      } as unknown as BlockToolAdapter;

      const result = builder.buildToolConfig(tool);

      expect(result).toEqual({
        'p': {},
        'div': { class: 'wrapper' },
        'span': {},
      });
    });

    it('buildToolConfig handles nested tag object with multiple tags', () => {
      const tool = {
        pasteConfig: {
          tags: [
            {
              'table': {
                'tr': {
                  'td': {},
                },
              },
            },
          ],
        },
      } as unknown as BlockToolAdapter;

      const result = builder.buildToolConfig(tool);

      // The function preserves nested structure: tag -> its sanitization config
      expect(result).toEqual({
        'table': {
          'tr': {
            'td': {},
          },
        },
      });
    });

    it('buildToolConfig returns empty object when pasteConfig has no tags', () => {
      const tool = {
        pasteConfig: {},
      } as unknown as BlockToolAdapter;

      const result = builder.buildToolConfig(tool);

      expect(result).toEqual({});
    });

    it('buildToolConfig converts tag names to lowercase', () => {
      const tool = {
        pasteConfig: {
          tags: ['P', 'DIV', 'CUSTOM-TAG'],
        },
      } as unknown as BlockToolAdapter;

      const result = builder.buildToolConfig(tool);

      expect(Object.keys(result)).toEqual(['p', 'div', 'custom-tag']);
    });

    it('composeConfigs merges multiple configs', () => {
      const config1 = { 'p': {} };
      const config2 = { 'div': { class: 'test' } };
      const config3 = { 'span': { id: true } };

      const result = builder.composeConfigs(config1, config2, config3);

      expect(result).toEqual({
        'p': {},
        'div': { class: 'test' },
        'span': { id: true },
      });
    });

    it('composeConfigs handles empty configs', () => {
      const result = builder.composeConfigs({}, {}, {});

      expect(result).toEqual({});
    });

    it('sanitizeTable cleans table HTML and returns sanitized element', () => {
      const table = document.createElement('table');
      table.innerHTML = '<tr><td><script>bad()</script>Data</td></tr>';

      const result = builder.sanitizeTable(table, { 'table': {}, 'tr': {}, 'td': {} });

      expect(result).toBeInstanceOf(HTMLElement);
      expect(result?.tagName.toLowerCase()).toBe('table');
      expect(result?.outerHTML).not.toContain('<script>');
    });

    it('sanitizeTable returns null when sanitization removes table', () => {
      const table = document.createElement('table');
      table.innerHTML = '<tr><td>Data</td></tr>';

      const result = builder.sanitizeTable(table, {}); // Empty config removes everything

      expect(result).toBeNull();
    });

    it('sanitizeTable returns null when result is not an element', () => {
      const table = document.createElement('table');
      table.innerHTML = '<tr><td>Data</td></tr>';

      // Empty config will remove the table element
      const result = builder.sanitizeTable(table, {});

      expect(result).toBeNull();
    });

    it('isStructuralTag returns true for table tags', () => {
      expect(builder.isStructuralTag('table')).toBe(true);
      expect(builder.isStructuralTag('thead')).toBe(true);
      expect(builder.isStructuralTag('tbody')).toBe(true);
      expect(builder.isStructuralTag('tfoot')).toBe(true);
      expect(builder.isStructuralTag('tr')).toBe(true);
      expect(builder.isStructuralTag('th')).toBe(true);
      expect(builder.isStructuralTag('td')).toBe(true);
      expect(builder.isStructuralTag('caption')).toBe(true);
      expect(builder.isStructuralTag('colgroup')).toBe(true);
      expect(builder.isStructuralTag('col')).toBe(true);
    });

    it('isStructuralTag returns true for list tags', () => {
      expect(builder.isStructuralTag('ul')).toBe(true);
      expect(builder.isStructuralTag('ol')).toBe(true);
      expect(builder.isStructuralTag('li')).toBe(true);
      expect(builder.isStructuralTag('dl')).toBe(true);
      expect(builder.isStructuralTag('dt')).toBe(true);
      expect(builder.isStructuralTag('dd')).toBe(true);
    });

    it('isStructuralTag returns false for non-structural tags', () => {
      expect(builder.isStructuralTag('div')).toBe(false);
      expect(builder.isStructuralTag('span')).toBe(false);
      expect(builder.isStructuralTag('p')).toBe(false);
      expect(builder.isStructuralTag('h1')).toBe(false);
      expect(builder.isStructuralTag('b')).toBe(false);
      expect(builder.isStructuralTag('i')).toBe(false);
    });

    it('isStructuralTag handles case insensitive input', () => {
      expect(builder.isStructuralTag('TABLE')).toBe(true);
      expect(builder.isStructuralTag('Table')).toBe(true);
      expect(builder.isStructuralTag('UL')).toBe(true);
      expect(builder.isStructuralTag('DIV')).toBe(false);
    });
  });
});
