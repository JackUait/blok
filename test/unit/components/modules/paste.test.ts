import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpyInstance } from 'vitest';

import Paste from '../../../../src/components/modules/paste';
import type BlockToolAdapter from '../../../../src/components/tools/block';
import type { SanitizerConfig } from '../../../../types';
import * as sanitizer from '../../../../src/components/utils/sanitizer';
import Listeners from '../../../../src/components/utils/listeners';

interface CreatePasteOptions {
  defaultBlock?: string;
  sanitizer?: SanitizerConfig;
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
  defaultTool: string;
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
    defaultTool: options?.defaultBlock ?? 'paragraph',
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
});


