import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { Paste } from '../../../../src/components/modules/paste';
import { ToolRegistry } from '../../../../src/components/modules/paste/tool-registry';
import { SanitizerConfigBuilder } from '../../../../src/components/modules/paste/sanitizer-config';
import type { TagSubstitute } from '../../../../src/components/modules/paste/types';
import { collectTagNames, SAFE_STRUCTURAL_TAGS } from '../../../../src/components/modules/paste/constants';
import { BlokDataHandler } from '../../../../src/components/modules/paste/handlers/blok-data-handler';
import { FilesHandler } from '../../../../src/components/modules/paste/handlers/files-handler';
import { HtmlHandler } from '../../../../src/components/modules/paste/handlers/html-handler';
import { PatternHandler } from '../../../../src/components/modules/paste/handlers/pattern-handler';
import { TextHandler } from '../../../../src/components/modules/paste/handlers/text-handler';
import { ToolsCollection } from '../../../../src/components/tools/collection';
import type { BlockToolAdapter } from '../../../../src/components/tools/block';
import type { SanitizerConfig } from '../../../../types/configs/sanitizer-config';
import type { BlokConfig } from '../../../../types/configs/blok-config';
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
      const newData: Record<string, string> = {};
      Object.keys(this.data).forEach(key => {
        if (key !== format) {
          newData[key] = this.data[key];
        }
      });
      this.data = newData;
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

      expect(mocks.BlockManager.paste).toHaveBeenCalledTimes(1);

      const [tool, event, shouldReplace] = mocks.BlockManager.paste.mock.calls[0];

      expect(tool).toBe('paragraph');
      expect(event).toBeInstanceOf(CustomEvent);
      expect(event.type).toBe('tag');
      expect(shouldReplace).toBe(true);
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

      expect(mocks.BlockManager.paste).toHaveBeenCalledTimes(1);

      const [tool, event, shouldReplace] = mocks.BlockManager.paste.mock.calls[0];

      expect(tool).toBe('paragraph');
      expect(event).toBeInstanceOf(CustomEvent);
      expect(event.type).toBe('tag');
      expect(shouldReplace).toBe(true);
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

      const [tool, event, shouldReplace] = mocks.BlockManager.paste.mock.calls[0] as [string, CustomEvent, boolean];

      expect(tool).toBe('imageTool');
      expect(event).toBeInstanceOf(CustomEvent);
      expect(event.type).toBe('file');
      expect((event.detail as { file: File }).file).toBe(file);
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

      const [tool, event] = mocks.BlockManager.paste.mock.calls[0] as [string, CustomEvent];

      expect(tool).toBe('link');
      expect(event).toBeInstanceOf(CustomEvent);
      expect(event.type).toBe('pattern');
      expect((event.detail as { data: string; key: string }).data).toBe('https://example.com');
      expect((event.detail as { data: string; key: string }).key).toBe('link');
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
      if (event instanceof CustomEvent && event.detail) {
        const detail = event.detail as { data: unknown };
        expect(detail.data).toBe('https://example.com');
      } else {
        throw new Error('Event.detail is not accessible');
      }
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

      // Verify first call: inline span fragment (replaces default block)
      const [tool1, event1, shouldReplace1] = mocks.BlockManager.paste.mock.calls[0];
      expect(tool1).toBe('paragraph');
      expect(event1).toBeInstanceOf(CustomEvent);
      expect(event1.type).toBe('tag');
      expect(shouldReplace1).toBe(true);

      // Verify second call: div (inserted without replacement)
      const [tool2, event2] = mocks.BlockManager.paste.mock.calls[1];
      expect(tool2).toBe('paragraph');
      expect(event2).toBeInstanceOf(CustomEvent);
      expect(event2.type).toBe('tag');
      expect(mocks.BlockManager.paste.mock.calls[1].length).toBe(2);

      // Verify third call: h1 (substituted with header tool, inserted without replacement)
      const [tool3, event3] = mocks.BlockManager.paste.mock.calls[2];
      expect(tool3).toBe('header');
      expect(event3).toBeInstanceOf(CustomEvent);
      expect(event3.type).toBe('tag');
      expect(mocks.BlockManager.paste.mock.calls[2].length).toBe(2);
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

  describe('ToolRegistry edge cases', () => {
    it('returns undefined when finding tool for non-existent tag', async () => {
      const { paste } = createPaste();
      await paste.prepare();

      const toolRegistry = (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry;

      expect(toolRegistry.findToolForTag('NONEXISTENT')).toBeUndefined();
      expect(toolRegistry.findToolForTag('')).toBeUndefined();
    });

    it('returns undefined when finding tool for file with no matching tool', () => {
      const toolsCollection = new ToolsCollection<BlockToolAdapter>();
      const toolRegistry = new ToolRegistry(toolsCollection, {} as BlokConfig);

      const unknownFile = new File(['content'], 'unknown.xyz', { type: 'application/unknown' });
      expect(toolRegistry.findToolForFile(unknownFile)).toBeUndefined();
    });

    it('finds tool for file by extension only', async () => {
      const fileTool = {
        name: 'image',
        pasteConfig: {
          files: {
            extensions: ['png', 'jpg'],
            mimeTypes: [],
          },
        },
        baseSanitizeConfig: {},
        hasOnPasteHandler: true,
      } as unknown as BlockToolAdapter;

      const toolsCollection = new ToolsCollection<BlockToolAdapter>([['image', fileTool]]);
      const toolRegistry = new ToolRegistry(toolsCollection, {} as BlokConfig);

      await toolRegistry.processTools();

      const pngFile = new File(['content'], 'test.png', { type: 'image/png' });
      const jpgFile = new File(['content'], 'test.jpg', { type: 'image/jpeg' });
      const txtFile = new File(['content'], 'test.txt', { type: 'text/plain' });

      expect(toolRegistry.findToolForFile(pngFile)).toBe('image');
      expect(toolRegistry.findToolForFile(jpgFile)).toBe('image');
      expect(toolRegistry.findToolForFile(txtFile)).toBeUndefined();
    });

    it('finds tool for file by MIME type with wildcard', async () => {
      const fileTool = {
        name: 'image',
        pasteConfig: {
          files: {
            extensions: [],
            mimeTypes: ['image/*'],
          },
        },
        baseSanitizeConfig: {},
        hasOnPasteHandler: true,
      } as unknown as BlockToolAdapter;

      const toolsCollection = new ToolsCollection<BlockToolAdapter>([['image', fileTool]]);
      const toolRegistry = new ToolRegistry(toolsCollection, {} as BlokConfig);

      await toolRegistry.processTools();

      const pngFile = new File(['content'], 'test.png', { type: 'image/png' });
      const jpegFile = new File(['content'], 'test.jpg', { type: 'image/jpeg' });
      const txtFile = new File(['content'], 'test.txt', { type: 'text/plain' });

      expect(toolRegistry.findToolForFile(pngFile)).toBe('image');
      expect(toolRegistry.findToolForFile(jpegFile)).toBe('image');
      expect(toolRegistry.findToolForFile(txtFile)).toBeUndefined();
    });

    it('returns undefined when finding tool for non-existent pattern', async () => {
      const { paste } = createPaste();
      await paste.prepare();

      const toolRegistry = (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry;

      expect(toolRegistry.findToolForPattern('no match here')).toBeUndefined();
      expect(toolRegistry.findToolForPattern('')).toBeUndefined();
    });

    it('returns empty array for tool with no tags', async () => {
      const { paste, mocks } = createPaste();

      const tool = {
        name: 'no-tags',
        pasteConfig: {},
        baseSanitizeConfig: {},
        hasOnPasteHandler: true,
      } as unknown as BlockToolAdapter;

      mocks.Tools.blockTools.set('no-tags', tool);
      await paste.prepare();

      const toolRegistry = (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry;

      expect(toolRegistry.getToolTags('no-tags')).toEqual([]);
      expect(toolRegistry.getToolTags('nonexistent')).toEqual([]);
    });

    it('returns true for tool in exception list', async () => {
      const { paste, mocks } = createPaste();

      const tool = {
        name: 'exception-tool',
        pasteConfig: false,
        baseSanitizeConfig: {},
        hasOnPasteHandler: true,
      } as unknown as BlockToolAdapter;

      mocks.Tools.blockTools.set('exception-tool', tool);
      await paste.prepare();

      const toolRegistry = (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry;

      expect(toolRegistry.isException('exception-tool')).toBe(true);
      expect(toolRegistry.isException('nonexistent')).toBe(false);
    });
  });

  describe('Paste constants utilities', () => {
    describe('collectTagNames', () => {
      it('returns array with single tag name when input is string', () => {
        expect(collectTagNames('DIV')).toEqual(['DIV']);
        expect(collectTagNames('p')).toEqual(['p']);
      });

      it('returns array of keys when input is object', () => {
        const config1: SanitizerConfig = { 'p': {}, 'div': { class: 'test' } };
        const config2: SanitizerConfig = { 'table': {} };

        expect(collectTagNames(config1)).toEqual(['p', 'div']);
        expect(collectTagNames(config2)).toEqual(['table']);
      });

      it('returns empty array for null input at runtime', () => {
        expect(collectTagNames(null as unknown as SanitizerConfig)).toEqual([]);
      });

      it('returns empty array for undefined input at runtime', () => {
        expect(collectTagNames(undefined as unknown as SanitizerConfig)).toEqual([]);
      });

      it('returns empty array for non-object non-string input at runtime', () => {
        expect(collectTagNames(123 as unknown as SanitizerConfig)).toEqual([]);
        expect(collectTagNames(true as unknown as SanitizerConfig)).toEqual([]);
        expect(collectTagNames([] as unknown as SanitizerConfig)).toEqual([]);
      });
    });

    describe('SAFE_STRUCTURAL_TAGS', () => {
      it('contains all expected table tags', () => {
        expect(SAFE_STRUCTURAL_TAGS.has('table')).toBe(true);
        expect(SAFE_STRUCTURAL_TAGS.has('thead')).toBe(true);
        expect(SAFE_STRUCTURAL_TAGS.has('tbody')).toBe(true);
        expect(SAFE_STRUCTURAL_TAGS.has('tfoot')).toBe(true);
        expect(SAFE_STRUCTURAL_TAGS.has('tr')).toBe(true);
        expect(SAFE_STRUCTURAL_TAGS.has('th')).toBe(true);
        expect(SAFE_STRUCTURAL_TAGS.has('td')).toBe(true);
        expect(SAFE_STRUCTURAL_TAGS.has('caption')).toBe(true);
        expect(SAFE_STRUCTURAL_TAGS.has('colgroup')).toBe(true);
        expect(SAFE_STRUCTURAL_TAGS.has('col')).toBe(true);
      });

      it('contains all expected list tags', () => {
        expect(SAFE_STRUCTURAL_TAGS.has('ul')).toBe(true);
        expect(SAFE_STRUCTURAL_TAGS.has('ol')).toBe(true);
        expect(SAFE_STRUCTURAL_TAGS.has('li')).toBe(true);
        expect(SAFE_STRUCTURAL_TAGS.has('dl')).toBe(true);
        expect(SAFE_STRUCTURAL_TAGS.has('dt')).toBe(true);
        expect(SAFE_STRUCTURAL_TAGS.has('dd')).toBe(true);
      });

      it('does not contain non-structural tags', () => {
        expect(SAFE_STRUCTURAL_TAGS.has('div')).toBe(false);
        expect(SAFE_STRUCTURAL_TAGS.has('span')).toBe(false);
        expect(SAFE_STRUCTURAL_TAGS.has('p')).toBe(false);
        expect(SAFE_STRUCTURAL_TAGS.has('h1')).toBe(false);
        expect(SAFE_STRUCTURAL_TAGS.has('b')).toBe(false);
        expect(SAFE_STRUCTURAL_TAGS.has('i')).toBe(false);
        expect(SAFE_STRUCTURAL_TAGS.has('a')).toBe(false);
      });
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

  describe('Handler edge cases', () => {
    describe('BlokDataHandler edge cases', () => {
      it('returns priority 0 for non-string data', () => {
        const { paste } = createPaste();

        const handler = new BlokDataHandler(
          paste as unknown as Paste['Blok'],
          (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
          (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder,
          {}
        );

        expect(handler.canHandle(null)).toBe(0);
        expect(handler.canHandle(undefined)).toBe(0);
        expect(handler.canHandle(123)).toBe(0);
        expect(handler.canHandle({})).toBe(0);
        expect(handler.canHandle([])).toBe(0);
      });

      it('returns priority 0 for invalid JSON strings', () => {
        const { paste } = createPaste();

        const handler = new BlokDataHandler(
          paste as unknown as Paste['Blok'],
          (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
          (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder,
          {}
        );

        expect(handler.canHandle('not json')).toBe(0);
        expect(handler.canHandle('{invalid}')).toBe(0);
        expect(handler.canHandle('')).toBe(0);
      });

      it('handles empty Blok JSON array', async () => {
        const { paste, mocks } = createPaste();
        await paste.prepare();

        const sanitizeBlocksSpy = vi.spyOn(sanitizer, 'sanitizeBlocks').mockReturnValue([]);

        mocks.BlockManager.currentBlock = {
          tool: { isDefault: true },
          isEmpty: true,
        };

        const dataTransfer = new MockDataTransfer(
          {
            'application/x-blok': JSON.stringify([]),
            'text/plain': '',
          },
          { length: 0 } as FileList,
          ['application/x-blok', 'text/plain']
        );

        await paste.processDataTransfer(dataTransfer);

        // Verify sanitizer was called with the empty Blok blocks array
        expect(sanitizeBlocksSpy).toHaveBeenCalledWith(
          [],  // Empty Blok data array
          expect.any(Function),
          {}
        );
        // Verify no blocks were inserted since array was empty
        expect(mocks.BlockManager.insert).not.toHaveBeenCalled();
      });

      it('handles Blok data with missing required fields gracefully', async () => {
        const { paste, mocks } = createPaste();
        await paste.prepare();

        const malformedBlocks = [
          { id: '1', tool: 'paragraph', data: {} },
          { tool: 'paragraph', data: { text: 'hello' } },
          { tool: 'paragraph', data: { text: 'world' } },
        ] as Array<{ tool: string; data: Record<string, unknown>; id?: string }>;

        vi.spyOn(sanitizer, 'sanitizeBlocks').mockReturnValue(malformedBlocks);

        mocks.BlockManager.currentBlock = {
          tool: { isDefault: true },
          isEmpty: true,
        };

        const insertedBlocks: Array<{ tool: string; data: Record<string, unknown> }> = [];
        mocks.BlockManager.insert.mockImplementation((block) => {
          insertedBlocks.push({
            tool: (block as { tool: string }).tool,
            data: (block as { data: Record<string, unknown> }).data,
          });
          return { id: 'block-id' };
        });

        const dataTransfer = new MockDataTransfer(
          {
            'application/x-blok': JSON.stringify(malformedBlocks),
            'text/plain': '',
          },
          { length: 0 } as FileList,
          ['application/x-blok', 'text/plain']
        );

        await paste.processDataTransfer(dataTransfer);

        // Verify all 3 blocks were inserted despite missing id field
        expect(insertedBlocks).toHaveLength(3);
        expect(insertedBlocks[0]).toEqual({ tool: 'paragraph', data: {} });
        expect(insertedBlocks[1]).toEqual({ tool: 'paragraph', data: { text: 'hello' } });
        expect(insertedBlocks[2]).toEqual({ tool: 'paragraph', data: { text: 'world' } });
      });
    });

    describe('FilesHandler edge cases', () => {
      it('returns priority 0 for non-DataTransfer data', () => {
        const { paste } = createPaste();

        const handler = new FilesHandler(
          paste as unknown as Paste['Blok'],
          (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
          (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder
        );

        expect(handler.canHandle('string')).toBe(0);
        expect(handler.canHandle(null)).toBe(0);
        expect(handler.canHandle(undefined)).toBe(0);
        expect(handler.canHandle(123)).toBe(0);
        expect(handler.canHandle({})).toBe(0);
      });

      it('returns priority 0 for DataTransfer without files', async () => {
        const { paste, mocks } = createPaste();

        mocks.Tools.blockTools.set('paragraph', mocks.Tools.defaultTool);
        await paste.prepare();

        const handler = new FilesHandler(
          paste as unknown as Paste['Blok'],
          (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
          (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder
        );

        const dataTransferWithoutFiles = new MockDataTransfer({}, { length: 0 } as FileList, ['text/plain']);

        expect(handler.canHandle(dataTransferWithoutFiles)).toBe(0);
      });

      it('handles empty FileList', async () => {
        const { paste, mocks } = createPaste();
        await paste.prepare();

        const emptyFileList = {
          length: 0,
          item: () => null,
        } as unknown as FileList;

        const dataTransfer = new MockDataTransfer({}, emptyFileList, []);

        await paste.processDataTransfer(dataTransfer);

        expect(mocks.BlockManager.paste).not.toHaveBeenCalled();
      });
    });

    describe('PatternHandler edge cases', () => {
      it('returns priority 0 for text exceeding max length', async () => {
        const { paste, mocks } = createPaste();

        const patternTool = {
          name: 'link',
          pasteConfig: {
            patterns: {
              link: /https:\/\/example\.com/,
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

        const longText = 'a'.repeat(PatternHandler.PATTERN_PROCESSING_MAX_LENGTH + 1);

        expect(handler.canHandle(longText)).toBe(0);
      });

      it('returns priority 0 for empty string', async () => {
        const { paste, mocks } = createPaste();

        mocks.Tools.blockTools.set('paragraph', mocks.Tools.defaultTool);
        await paste.prepare();

        const handler = new PatternHandler(
          paste as unknown as Paste['Blok'],
          (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
          (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder
        );

        expect(handler.canHandle('')).toBe(0);
      });

      it('returns priority 0 for non-string data', async () => {
        const { paste } = createPaste();

        const handler = new PatternHandler(
          paste as unknown as Paste['Blok'],
          (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
          (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder
        );

        expect(handler.canHandle(null)).toBe(0);
        expect(handler.canHandle(undefined)).toBe(0);
        expect(handler.canHandle(123)).toBe(0);
        expect(handler.canHandle({})).toBe(0);
      });
    });

    describe('HtmlHandler edge cases', () => {
      it('returns priority 0 for empty string', () => {
        const { paste } = createPaste();

        const handler = new HtmlHandler(
          paste as unknown as Paste['Blok'],
          (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
          (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder
        );

        expect(handler.canHandle('')).toBe(0);
        expect(handler.canHandle('   ')).toBe(0);
      });

      it('returns priority 0 for non-HTML string', () => {
        const { paste } = createPaste();

        const handler = new HtmlHandler(
          paste as unknown as Paste['Blok'],
          (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
          (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder
        );

        expect(handler.canHandle('plain text')).toBe(0);
        expect(handler.canHandle('just words')).toBe(0);
      });

      it('returns priority 0 for non-string data', () => {
        const { paste } = createPaste();

        const handler = new HtmlHandler(
          paste as unknown as Paste['Blok'],
          (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
          (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder
        );

        expect(handler.canHandle(null)).toBe(0);
        expect(handler.canHandle(undefined)).toBe(0);
        expect(handler.canHandle(123)).toBe(0);
        expect(handler.canHandle({})).toBe(0);
      });
    });

    describe('TextHandler edge cases', () => {
      it('returns priority 0 for empty string', () => {
        const { paste } = createPaste();

        const handler = new TextHandler(
          paste as unknown as Paste['Blok'],
          (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
          (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder,
          { defaultBlock: 'paragraph' }
        );

        expect(handler.canHandle('')).toBe(0);
        // Note: TextHandler returns 10 for non-empty strings (including spaces)
        // The whitespace filtering happens in processPlain()
        expect(handler.canHandle('   ')).toBe(10);
      });

      it('returns priority 0 for non-string data', () => {
        const { paste } = createPaste();

        const handler = new TextHandler(
          paste as unknown as Paste['Blok'],
          (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
          (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder,
          { defaultBlock: 'paragraph' }
        );

        expect(handler.canHandle(null)).toBe(0);
        expect(handler.canHandle(undefined)).toBe(0);
        expect(handler.canHandle(123)).toBe(0);
        expect(handler.canHandle({})).toBe(0);
      });

      it('handles mixed line endings (\\r\\n and \\n)', async () => {
        const { paste, mocks } = createPaste();

        mocks.Tools.blockTools.set('paragraph', mocks.Tools.defaultTool);
        await paste.prepare();

        const textHandler = new TextHandler(
          paste as unknown as Paste['Blok'],
          (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
          (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder,
          { defaultBlock: 'paragraph' }
        );

        const result = (textHandler as unknown as { processPlain(plain: string): unknown[] }).processPlain('line1\r\nline2\nline3');

        expect(result).toHaveLength(3);
        expect((result[0] as { content: HTMLElement }).content).toHaveTextContent('line1');
        expect((result[1] as { content: HTMLElement }).content).toHaveTextContent('line2');
        expect((result[2] as { content: HTMLElement }).content).toHaveTextContent('line3');
      });

      it('handles string with only newlines', async () => {
        const { paste, mocks } = createPaste();

        mocks.Tools.blockTools.set('paragraph', mocks.Tools.defaultTool);
        await paste.prepare();

        const textHandler = new TextHandler(
          paste as unknown as Paste['Blok'],
          (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
          (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder,
          { defaultBlock: 'paragraph' }
        );

        const result = (textHandler as unknown as { processPlain(plain: string): unknown[] }).processPlain('\n\n\n');

        expect(result).toHaveLength(0);
      });

      it('handles Unicode and emoji characters', async () => {
        const { paste, mocks } = createPaste();

        mocks.Tools.blockTools.set('paragraph', mocks.Tools.defaultTool);
        await paste.prepare();

        const textHandler = new TextHandler(
          paste as unknown as Paste['Blok'],
          (paste as unknown as { toolRegistry: ToolRegistry }).toolRegistry,
          (paste as unknown as { sanitizerBuilder: SanitizerConfigBuilder }).sanitizerBuilder,
          { defaultBlock: 'paragraph' }
        );

        const text = 'Hello 🚀 World\n你好\nمرحبا';

        const result = (textHandler as unknown as { processPlain(plain: string): unknown[] }).processPlain(text);

        expect(result).toHaveLength(3);
        expect((result[0] as { content: HTMLElement }).content).toHaveTextContent('Hello 🚀 World');
        expect((result[1] as { content: HTMLElement }).content).toHaveTextContent('你好');
        expect((result[2] as { content: HTMLElement }).content).toHaveTextContent('مرحبا');
      });
    });
  });
});
