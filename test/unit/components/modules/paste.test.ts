import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpyInstance } from 'vitest';

import Paste from '../../../../src/components/modules/paste';
import type BlockToolAdapter from '../../../../src/components/tools/block';
import type { SanitizerConfig } from '../../../../types';
import * as sanitizer from '../../../../src/components/utils/sanitizer';
import Listeners from '../../../../src/components/utils/listeners';
import * as utils from '../../../../src/components/utils';

interface CreatePasteOptions {
  defaultBlock?: string;
  sanitizer?: SanitizerConfig;
  defaultTool?: BlockToolAdapter;
}

type ListenersMock = {
  instance: Listeners;
  on: SpyInstance<
    Parameters<Listeners['on']> extends Array<unknown> ? Parameters<Listeners['on']> : never,
    ReturnType<Listeners['on']>
  >;
  off: SpyInstance<
    Parameters<Listeners['off']> extends Array<unknown> ? Parameters<Listeners['off']> : never,
    ReturnType<Listeners['off']>
  >;
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
  paste: ReturnType<typeof vi.fn<[string, CustomEvent, boolean?], unknown>>;
  insert: ReturnType<typeof vi.fn<[{ tool: string; data: unknown; replace: boolean }], unknown>>;
  setCurrentBlockByChildNode: ReturnType<typeof vi.fn<[HTMLElement], unknown>>;
};

type CaretMock = {
  positions: {
    END: string;
  };
  setToBlock: ReturnType<typeof vi.fn<[unknown, string], void>>;
  insertContentAtCaretPosition: ReturnType<typeof vi.fn<[string], void>>;
};

type ToolsMock = {
  blockTools: Map<string, BlockToolAdapter>;
  defaultTool: BlockToolAdapter;
  getAllInlineToolsSanitizeConfig: ReturnType<typeof vi.fn<[], SanitizerConfig>>;
};

type ToolbarMock = {
  close: ReturnType<typeof vi.fn<[], void>>;
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
    paste: vi.fn<[string, CustomEvent, boolean?], unknown>(),
    insert: vi.fn<[{ tool: string; data: unknown; replace: boolean }], unknown>(),
    setCurrentBlockByChildNode: vi.fn<[HTMLElement], unknown>(),
  };

  const caret: CaretMock = {
    positions: {
      END: 'end',
    },
    setToBlock: vi.fn<[unknown, string], void>(),
    insertContentAtCaretPosition: vi.fn<[string], void>(),
  };

  const tools: ToolsMock = {
    blockTools: new Map<string, BlockToolAdapter>(),
    defaultTool,
    getAllInlineToolsSanitizeConfig: vi.fn<[], SanitizerConfig>(() => ({})),
  };

  const toolbar: ToolbarMock = {
    close: vi.fn<[], void>(),
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

  const pasteWithInternals = paste as unknown as { listeners: Listeners; state: Paste['Editor'] };

  pasteWithInternals.listeners = listeners.instance;

  const editorState = {
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

  pasteWithInternals.state = editorState as unknown as Paste['Editor'];

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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('collects tool configurations during prepare', async () => {
    const { paste } = createPaste();
    const processToolsSpy = vi.spyOn(paste as unknown as { processTools(): void }, 'processTools');

    await paste.prepare();

    expect(processToolsSpy).toHaveBeenCalledTimes(1);
  });

  it('processes every tool registered in Tools collection', () => {
    const { paste, mocks } = createPaste();
    const firstTool = {
      name: 'first',
      create: vi.fn(() => ({ onPaste: vi.fn() })),
      pasteConfig: {},
      baseSanitizeConfig: {},
    } as unknown as BlockToolAdapter;
    const secondTool = {
      name: 'second',
      create: vi.fn(() => ({ onPaste: vi.fn() })),
      pasteConfig: {},
      baseSanitizeConfig: {},
    } as unknown as BlockToolAdapter;

    mocks.Tools.blockTools.set('first', firstTool);
    mocks.Tools.blockTools.set('second', secondTool);

    const processToolSpy = vi.spyOn(paste as unknown as { processTool(tool: BlockToolAdapter): void }, 'processTool');

    (paste as unknown as { processTools(): void }).processTools();

    expect(processToolSpy).toHaveBeenCalledTimes(2);
    expect(processToolSpy.mock.calls.map((args) => args[0])).toEqual([firstTool, secondTool]);
  });

  it('adds tools with disabled paste config to exception list and skips config collection', () => {
    const { paste } = createPaste();
    const tool = {
      name: 'skip-tool',
      create: vi.fn(() => ({ onPaste: vi.fn() })),
      pasteConfig: false,
      baseSanitizeConfig: {},
    } as unknown as BlockToolAdapter;

    const getTagsSpy = vi.spyOn(paste as unknown as { getTagsConfig(tool: BlockToolAdapter): void }, 'getTagsConfig');
    const getFilesSpy = vi.spyOn(paste as unknown as { getFilesConfig(tool: BlockToolAdapter): void }, 'getFilesConfig');
    const getPatternsSpy = vi.spyOn(paste as unknown as { getPatternsConfig(tool: BlockToolAdapter): void }, 'getPatternsConfig');

    (paste as unknown as { processTool(tool: BlockToolAdapter): void }).processTool(tool);

    const exceptionList = (paste as unknown as { exceptionList: string[] }).exceptionList;

    expect(exceptionList).toContain('skip-tool');
    expect(getTagsSpy).not.toHaveBeenCalled();
    expect(getFilesSpy).not.toHaveBeenCalled();
    expect(getPatternsSpy).not.toHaveBeenCalled();
  });

  it('skips tools without onPaste handler when processing paste config', () => {
    const { paste } = createPaste();
    const tool = {
      name: 'incompatible',
      create: vi.fn(() => ({})),
      pasteConfig: {},
      baseSanitizeConfig: {},
    } as unknown as BlockToolAdapter;

    const getTagsSpy = vi.spyOn(paste as unknown as { getTagsConfig(tool: BlockToolAdapter): void }, 'getTagsConfig');

    (paste as unknown as { processTool(tool: BlockToolAdapter): void }).processTool(tool);

    expect(getTagsSpy).not.toHaveBeenCalled();
  });

  it('collects tag, file and pattern configs for eligible tools', () => {
    const { paste } = createPaste();
    const tool = {
      name: 'handler',
      create: vi.fn(() => ({ onPaste: vi.fn() })),
      pasteConfig: {
        tags: [ 'P' ],
        files: {
          extensions: [ 'jpg' ],
          mimeTypes: [ 'image/png' ],
        },
        patterns: {
          link: /example/,
        },
      },
      baseSanitizeConfig: {},
    } as unknown as BlockToolAdapter;

    const getTagsSpy = vi.spyOn(paste as unknown as { getTagsConfig(tool: BlockToolAdapter): void }, 'getTagsConfig');
    const getFilesSpy = vi.spyOn(paste as unknown as { getFilesConfig(tool: BlockToolAdapter): void }, 'getFilesConfig');
    const getPatternsSpy = vi.spyOn(paste as unknown as { getPatternsConfig(tool: BlockToolAdapter): void }, 'getPatternsConfig');

    (paste as unknown as { processTool(tool: BlockToolAdapter): void }).processTool(tool);

    expect(getTagsSpy).toHaveBeenCalledWith(tool);
    expect(getFilesSpy).toHaveBeenCalledWith(tool);
    expect(getPatternsSpy).toHaveBeenCalledWith(tool);
  });

  it('registers and removes paste listener when toggling read-only state', () => {
    const { paste, mocks } = createPaste();

    paste.toggleReadOnly(false);

    expect(mocks.listeners.on).toHaveBeenCalledTimes(1);
    expect(mocks.listeners.on).toHaveBeenNthCalledWith(
      1,
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

  it('processes matched files via BlockManager and replaces current default block', async () => {
    const { paste, mocks } = createPaste();

    mocks.BlockManager.currentBlock = {
      tool: {
        isDefault: true,
      },
      isEmpty: true,
    };

    (paste as unknown as { toolsFiles: Record<string, { extensions: string[]; mimeTypes: string[] }> }).toolsFiles = {
      imageTool: {
        extensions: [ 'png' ],
        mimeTypes: [ 'image/*' ],
      },
    };

    const file = new File([ 'content' ], 'example.png', { type: 'image/png' });
    const fileList = {
      length: 1,
      item(index: number): File | null {
        return index === 0 ? file : null;
      },
      [0]: file,
    } as unknown as FileList;

    await (paste as unknown as { processFiles(items: FileList): Promise<void> }).processFiles(fileList);

    expect(mocks.BlockManager.paste).toHaveBeenCalledTimes(1);

    const [tool, event, shouldReplace] = mocks.BlockManager.paste.mock.calls[0];

    expect(tool).toBe('imageTool');
    expect(event).toBeInstanceOf(CustomEvent);
    expect(event.type).toBe('file');
    expect(event.detail.file).toBe(file);
    expect(shouldReplace).toBe(true);
  });

  it('collects tags from paste config and prevents duplicates', () => {
    const { paste } = createPaste();
    const logSpy = vi.spyOn(utils, 'log').mockImplementation(() => undefined);

    const firstTool = {
      name: 'first',
      pasteConfig: {
        tags: ['DIV', { table: { tr: {} } } ],
      },
    } as unknown as BlockToolAdapter;

    const secondTool = {
      name: 'second',
      pasteConfig: {
        tags: [ 'DIV' ],
      },
    } as unknown as BlockToolAdapter;

    (paste as unknown as { getTagsConfig(tool: BlockToolAdapter): void }).getTagsConfig(firstTool);
    (paste as unknown as { getTagsConfig(tool: BlockToolAdapter): void }).getTagsConfig(secondTool);

    const toolsTags = (paste as unknown as { toolsTags: Record<string, { tool: BlockToolAdapter }> }).toolsTags;
    const tagsByTool = (paste as unknown as { tagsByTool: Record<string, string[]> }).tagsByTool;

    expect(toolsTags.DIV.tool).toBe(firstTool);
    expect(toolsTags.TABLE.tool).toBe(firstTool);
    expect(tagsByTool[firstTool.name]).toEqual(['DIV', 'TABLE']);
    expect(tagsByTool[secondTool.name]).toEqual([ 'DIV' ]);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Paste handler for «second» Tool on «DIV» tag is skipped because it is already used by «first» Tool.'),
      'warn'
    );
  });

  it('normalizes file configurations and warns for invalid values', () => {
    const { paste } = createPaste();
    const logSpy = vi.spyOn(utils, 'log').mockImplementation(() => undefined);
    const tool = {
      name: 'files',
      pasteConfig: {
        files: {
          extensions: 'jpg' as unknown as string[],
          mimeTypes: ['image/png', 'invalid'],
        },
      },
    } as unknown as BlockToolAdapter;

    (paste as unknown as { getFilesConfig(tool: BlockToolAdapter): void }).getFilesConfig(tool);

    const filesConfig = (paste as unknown as {
      toolsFiles: Record<string, { extensions: string[]; mimeTypes: string[] }>;
    }).toolsFiles;

    expect(filesConfig[tool.name]).toEqual({
      extensions: [],
      mimeTypes: [ 'image/png' ],
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('«extensions» property of the onDrop config for «files» Tool should be an array')
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('MIME type value «invalid» for the «files» Tool is not a valid MIME type'),
      'warn'
    );
  });

  it('stores valid patterns and warns when non-RegExp values are provided', () => {
    const { paste } = createPaste();
    const logSpy = vi.spyOn(utils, 'log').mockImplementation(() => undefined);
    const tool = {
      name: 'patterns',
      pasteConfig: {
        patterns: {
          link: /example/,
          invalid: 'string' as unknown as RegExp,
        },
      },
    } as unknown as BlockToolAdapter;

    (paste as unknown as { getPatternsConfig(tool: BlockToolAdapter): void }).getPatternsConfig(tool);

    const registeredPatterns = (paste as unknown as {
      toolsPatterns: Array<{ key: string; pattern: RegExp; tool: BlockToolAdapter }>;
    }).toolsPatterns;

    expect(registeredPatterns).toHaveLength(2);
    expect(registeredPatterns[0]).toMatchObject({ key: 'link',
      tool });
    expect(registeredPatterns[1]).toMatchObject({ key: 'invalid',
      tool });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Pattern string for «patterns» Tool is skipped because it should be a Regexp instance.'),
      'warn'
    );
  });

  it('substitutes pattern matches on inline paste and replaces current default block', async () => {
    const { paste, mocks } = createPaste();

    const patternTool = {
      name: 'link',
      pasteConfig: {},
      baseSanitizeConfig: {},
    } as unknown as BlockToolAdapter;

    (paste as unknown as {
      toolsPatterns: Array<{
        key: string;
        pattern: RegExp;
        tool: BlockToolAdapter;
      }>;
    }).toolsPatterns = [
      {
        key: 'link',
        pattern: /^https:\/\/example\.com$/,
        tool: patternTool,
      },
    ];

    mocks.BlockManager.currentBlock = {
      tool: {
        isDefault: true,
        baseSanitizeConfig: {},
      },
      isEmpty: true,
      name: 'paragraph',
      currentInput: document.createElement('div'),
    };

    const content = document.createElement('div');

    content.textContent = 'https://example.com';

    mocks.BlockManager.paste.mockImplementation((_tool, _event, replace) => {
      expect(replace).toBe(true);

      return { id: 'link-block' };
    });

    await (paste as unknown as {
      processInlinePaste(data: {
        content: HTMLElement;
        tool: string;
        isBlock: boolean;
        event: CustomEvent;
      }): Promise<void>;
    }).processInlinePaste({
      content,
      tool: 'paragraph',
      isBlock: false,
      event: new CustomEvent('pattern'),
    });

    expect(mocks.BlockManager.paste).toHaveBeenCalledTimes(1);

    const [tool, event] = mocks.BlockManager.paste.mock.calls[0];

    expect(tool).toBe('link');
    expect(event).toBeInstanceOf(CustomEvent);
    expect(event.type).toBe('pattern');
    expect(event.detail.data).toBe('https://example.com');
    expect(event.detail.key).toBe('link');
    expect(mocks.Caret.setToBlock).toHaveBeenCalledWith({ id: 'link-block' }, mocks.Caret.positions.END);
    expect(mocks.Caret.insertContentAtCaretPosition).not.toHaveBeenCalled();
  });

  it('inserts sanitized inline content when no pattern matches and current input exists', async () => {
    const { paste, mocks } = createPaste();

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

    const content = document.createElement('div');

    content.innerHTML = '<b>Example</b>';

    await (paste as unknown as {
      processInlinePaste(data: {
        content: HTMLElement;
        tool: string;
        isBlock: boolean;
        event: CustomEvent;
      }): Promise<void>;
    }).processInlinePaste({
      content,
      tool: 'paragraph',
      isBlock: false,
      event: new CustomEvent('tag'),
    });

    expect(cleanSpy).toHaveBeenCalledWith(
      '<b>Example</b>',
      {
        b: {},
      }
    );
    expect(mocks.Caret.insertContentAtCaretPosition).toHaveBeenCalledWith('sanitized-content');
    expect(mocks.BlockManager.paste).not.toHaveBeenCalled();
  });

  it('inserts sanitized EditorJS data and updates caret position', () => {
    const { paste, mocks } = createPaste();

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

    (paste as unknown as {
      insertEditorJSData(blocks: Array<{ id: string; tool: string; data: unknown }>): void;
    }).insertEditorJSData([
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
    ]);

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

  it('splits plain text by new lines and creates PasteData entries', () => {
    const { paste } = createPaste({ defaultBlock: 'paragraph' });

    const result = (paste as unknown as {
      processPlain(data: string): Array<{ tool: string; content: HTMLElement; event: CustomEvent; isBlock: boolean }>;
    }).processPlain('First\n\nSecond');

    expect(result).toHaveLength(2);
    expect(result[0].tool).toBe('paragraph');
    expect(result[0].content.textContent).toBe('First');
    expect(result[0].event.type).toBe('tag');
    expect(result[1].content.textContent).toBe('Second');
  });

  it('inserts a new block when pasted tool differs from current block', async () => {
    const { paste, mocks } = createPaste();
    const insertBlockSpy = vi.spyOn(paste as unknown as { insertBlock(data: unknown, replace?: boolean): void }, 'insertBlock').mockImplementation(() => undefined);

    mocks.BlockManager.currentBlock = {
      tool: {
        isDefault: true,
      },
      isEmpty: true,
      name: 'paragraph',
    };

    const content = document.createElement('div');

    await (paste as unknown as {
      processSingleBlock(data: { content: HTMLElement; tool: string; isBlock: boolean; event: CustomEvent }): Promise<void>;
    }).processSingleBlock({
      content,
      tool: 'quote',
      isBlock: true,
      event: new CustomEvent('tag'),
    });

    expect(insertBlockSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'quote' }),
      true
    );
    expect(mocks.Caret.insertContentAtCaretPosition).not.toHaveBeenCalled();
  });

  it('merges pasted single block content into the current block when possible', async () => {
    const { paste, mocks } = createPaste();

    mocks.BlockManager.currentBlock = {
      tool: {
        isDefault: false,
      },
      isEmpty: false,
      name: 'paragraph',
    };

    const content = document.createElement('div');

    content.innerHTML = '<span>Inline</span>';

    await (paste as unknown as {
      processSingleBlock(data: { content: HTMLElement; tool: string; isBlock: boolean; event: CustomEvent }): Promise<void>;
    }).processSingleBlock({
      content,
      tool: 'paragraph',
      isBlock: true,
      event: new CustomEvent('tag'),
    });

    expect(mocks.Caret.insertContentAtCaretPosition).toHaveBeenCalledWith('<span>Inline</span>');
    expect(mocks.BlockManager.paste).not.toHaveBeenCalled();
  });

  it('processes HTML fragments, default block content and substituted tags', () => {
    const defaultTool = {
      name: 'paragraph',
      pasteConfig: {},
      baseSanitizeConfig: {},
    } as unknown as BlockToolAdapter;
    const { paste } = createPaste({ defaultBlock: 'paragraph',
      defaultTool });
    const headingTool = {
      name: 'header',
      pasteConfig: {
        tags: [ 'h1' ],
      },
      baseSanitizeConfig: {},
    } as unknown as BlockToolAdapter;

    (paste as unknown as { getTagsConfig(tool: BlockToolAdapter): void }).getTagsConfig(headingTool);

    const cleanSpy = vi.spyOn(sanitizer, 'clean').mockImplementation((html: string) => html.replace(/<script>.*?<\/script>/g, ''));
    const html = '<span>Inline</span><div>Content</div><h1><script>bad()</script>Heading</h1>';

    const result = (paste as unknown as {
      processHTML(innerHTML: string): Array<{ content: HTMLElement; isBlock: boolean; tool: string; event: CustomEvent }>;
    }).processHTML(html);

    expect(result).toHaveLength(3);

    expect(result[0]).toMatchObject({
      isBlock: false,
      tool: 'paragraph',
    });
    expect(result[1]).toMatchObject({
      isBlock: true,
      tool: 'paragraph',
    });
    expect(result[2]).toMatchObject({
      isBlock: true,
      tool: 'header',
    });
    expect(result[2].content.tagName).toBe('H1');
    expect(result[2].event.type).toBe('tag');
    expect(cleanSpy).toHaveBeenCalled();
  });

  it('flattens nested block elements when fetching nodes', () => {
    const { paste } = createPaste();
    const wrapper = document.createElement('div');

    wrapper.innerHTML = '<div><p>Paragraph</p></div>';

    const nodes = (paste as unknown as { getNodes(wrapper: Node): Node[] }).getNodes(wrapper);

    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toBeInstanceOf(DocumentFragment);
    expect(nodes[1]).toBeInstanceOf(HTMLElement);
    expect((nodes[1] as HTMLElement).tagName).toBe('P');
  });

  it('appends inline elements to document fragments when processing element nodes', () => {
    const { paste } = createPaste();
    const fragment = document.createDocumentFragment();
    const span = document.createElement('span');
    const nodes: Node[] = [];

    span.textContent = 'inline';

    const processed = (paste as unknown as {
      processElementNode(node: Node, nodes: Node[], destNode: Node): Node[] | void;
    }).processElementNode(span, nodes, fragment);

    expect(processed).toEqual([ fragment ]);
    expect(fragment.childNodes[0]).toBe(span);
  });

  it('returns block elements separately when processing element nodes', () => {
    const { paste } = createPaste();
    const fragment = document.createDocumentFragment();
    const paragraph = document.createElement('p');

    const processed = (paste as unknown as {
      processElementNode(node: Node, nodes: Node[], destNode: Node): Node[] | void;
    }).processElementNode(paragraph, [], fragment);

    expect(processed).toEqual([fragment, paragraph]);
  });

  it('detects native inputs when checking for native behaviour', () => {
    const { paste } = createPaste();
    const input = document.createElement('input');
    const div = document.createElement('div');

    expect((paste as unknown as { isNativeBehaviour(element: EventTarget): boolean }).isNativeBehaviour(input)).toBe(true);
    expect((paste as unknown as { isNativeBehaviour(element: EventTarget): boolean }).isNativeBehaviour(div)).toBe(false);
  });
});
