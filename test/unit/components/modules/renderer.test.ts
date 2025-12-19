import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { Renderer } from '../../../../src/components/modules/renderer';
import type { OutputBlockData } from '../../../../types';
import type { StubData } from '../../../../src/tools/stub';
import * as utils from '../../../../src/components/utils';

type RendererBlok = Renderer['Blok'];
type RendererBlockManager = RendererBlok['BlockManager'];
type BlockManagerInsert = RendererBlockManager['insert'];
type BlockManagerInsertMany = RendererBlockManager['insertMany'];
type BlockManagerComposeBlock = RendererBlockManager['composeBlock'];
type ComposeBlockArgs = Parameters<BlockManagerComposeBlock>[0];
type ComposeBlockReturn = ReturnType<BlockManagerComposeBlock>;
type RequestIdleCallbackFn = Window['requestIdleCallback'];

interface MockBlockManager {
  insert: MockInstance<BlockManagerInsert>;
  insertMany: MockInstance<BlockManagerInsertMany>;
  composeBlock: MockInstance<BlockManagerComposeBlock>;
}

interface MockTools {
  available: Map<string, unknown>;
  unavailable: Map<string, { toolbox?: Array<{ title?: string }> }>;
  stubTool: string;
}

interface RendererTestContext {
  renderer: Renderer;
  blockManager: MockBlockManager;
  tools: MockTools;
}

const createMockBlock = ({ id, tool, marker }: { id?: string; tool: string; marker?: string }): ComposeBlockReturn => {
  return {
    id,
    tool,
    marker,
  } as unknown as ComposeBlockReturn;
};

const createRenderer = (
  options?: {
    blockManager?: Partial<MockBlockManager>;
    tools?: Partial<MockTools>;
  }
): RendererTestContext => {
  const defaultBlockManager: MockBlockManager = {
    insert: vi.fn<BlockManagerInsert>((insertOptions) => {
      const { id, tool = 'default' } = insertOptions ?? {};

      return createMockBlock({
        id,
        tool,
      });
    }),
    insertMany: vi.fn<BlockManagerInsertMany>(() => undefined),
    composeBlock: vi.fn<BlockManagerComposeBlock>((composeOptions) => {
      const { id, tool } = composeOptions;

      return createMockBlock({
        id,
        tool,
      });
    }),
  };

  const blockManager: MockBlockManager = {
    ...defaultBlockManager,
    ...options?.blockManager,
  };

  const defaultTools: MockTools = {
    available: new Map<string, unknown>(),
    unavailable: new Map<string, { toolbox?: Array<{ title?: string }> }>(),
    stubTool: 'stub-tool',
  };

  const tools: MockTools = {
    ...defaultTools,
    ...options?.tools,
  };

  const renderer = new Renderer({
    config: {},
    eventsDispatcher: {
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as Renderer['eventsDispatcher'],
  });

  const blokState = {
    BlockManager: blockManager,
    Tools: tools,
  };

  renderer.state = blokState as unknown as RendererBlok;

  return {
    renderer,
    blockManager,
    tools,
  };
};

let originalRequestIdleCallback: RequestIdleCallbackFn;

type RequestIdleCallbackMock = MockInstance<RequestIdleCallbackFn>;
let requestIdleCallbackMock: RequestIdleCallbackMock;

beforeAll(() => {
  originalRequestIdleCallback = window.requestIdleCallback;
});

beforeEach(() => {
  requestIdleCallbackMock = vi.fn<RequestIdleCallbackFn>((callback) => {
    callback({
      didTimeout: false,
      timeRemaining: () => 0,
    });

    return 0;
  });

  Object.defineProperty(window, 'requestIdleCallback', {
    configurable: true,
    writable: true,
    value: requestIdleCallbackMock,
  });
});

afterEach(() => {
  vi.restoreAllMocks();

  Object.defineProperty(window, 'requestIdleCallback', {
    configurable: true,
    writable: true,
    value: originalRequestIdleCallback,
  });
});

afterAll(() => {
  Object.defineProperty(window, 'requestIdleCallback', {
    configurable: true,
    writable: true,
    value: originalRequestIdleCallback,
  });
});

describe('Renderer module', () => {
  it('inserts a default block when render receives an empty array', async () => {
    const { renderer, blockManager } = createRenderer();

    await renderer.render([]);

    expect(blockManager.insert).toHaveBeenCalledTimes(1);
    expect(blockManager.insertMany).not.toHaveBeenCalled();
  });

  it('composes and inserts blocks when tools are available', async () => {
    const { renderer, blockManager, tools } = createRenderer();

    tools.available.set('paragraph', {});

    const composeBlock: MockBlockManager['composeBlock'] = vi.fn<BlockManagerComposeBlock>((options) => {
      const { id, tool } = options;

      return createMockBlock({
        id,
        tool,
        marker: 'block-instance',
      });
    });

    blockManager.composeBlock = composeBlock;

    const blockData: OutputBlockData = {
      id: 'block-1',
      type: 'paragraph',
      data: { text: 'Hello' },
      tunes: { alignment: 'left' },
    };

    await renderer.render([ blockData ]);

    expect(composeBlock).toHaveBeenCalledTimes(1);
    expect(composeBlock).toHaveBeenCalledWith({
      id: 'block-1',
      tool: 'paragraph',
      data: blockData.data,
      tunes: blockData.tunes,
    });
    expect(blockManager.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'block-1',
        tool: 'paragraph',
        marker: 'block-instance',
      }),
    ]);
    expect(blockManager.insert).not.toHaveBeenCalled();
  });

  it('replaces missing tools with stub blocks and logs a warning', async () => {
    const { renderer, blockManager, tools } = createRenderer({
      tools: {
        stubTool: 'stub-tool',
      },
    });

    const logLabeledSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => {});

    const blockData: OutputBlockData = {
      id: 'missing-tool-block',
      type: 'unsupported',
      data: { payload: true },
    };

    await renderer.render([ blockData ]);

    expect(logLabeledSpy).toHaveBeenCalledTimes(1);
    const [message, level] = logLabeledSpy.mock.calls[0];

    expect(level).toBe('warn');
    expect(message).toContain('Tool «unsupported» is not found');

    expect(blockManager.composeBlock).toHaveBeenCalledTimes(1);
    const [ composeArgs ] = blockManager.composeBlock.mock.calls[0];

    expect(composeArgs.tool).toBe(tools.stubTool);

    const stubData = composeArgs.data as StubData;

    expect(stubData.title).toBe('unsupported');
    expect(stubData.savedData).toEqual({
      id: 'missing-tool-block',
      type: 'unsupported',
      data: blockData.data,
    });
  });

  it('renders stub blocks when a tool throws during composition', async () => {
    const failingTool = 'unstable';

    const composeBlock: MockBlockManager['composeBlock'] = vi.fn<BlockManagerComposeBlock>(() => {
      throw new Error('Tool error');
    });

    composeBlock.mockImplementationOnce(() => {
      throw new Error('Tool error');
    });

    composeBlock.mockImplementation((options: ComposeBlockArgs) => {
      return createMockBlock({
        id: options.id,
        tool: options.tool,
      });
    });

    const { renderer, tools } = createRenderer({
      blockManager: {
        composeBlock,
      },
    });

    tools.available.set(failingTool, {});
    tools.stubTool = 'stub-tool';

    const logSpy = vi.spyOn(utils, 'log').mockImplementation(() => {});

    const blockData: OutputBlockData = {
      id: 'failing-tool-block',
      type: failingTool,
      data: { payload: true },
    };

    await renderer.render([ blockData ]);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [message, level, details] = logSpy.mock.calls[0];

    expect(level).toBe('error');
    expect(message).toContain(`Block «${failingTool}» skipped because of plugins error`);
    expect(details).toEqual({
      data: blockData.data,
      error: expect.any(Error),
    });

    expect(composeBlock).toHaveBeenCalledTimes(2);
    const secondCall = composeBlock.mock.calls[1];

    expect(secondCall).toBeDefined();

    if (secondCall === undefined) {
      throw new Error('Expected composeBlock to be called twice with arguments.');
    }

    const [ secondCallArgs ] = secondCall;

    expect(secondCallArgs).toBeDefined();

    if (secondCallArgs === undefined) {
      throw new Error('Expected composeBlock second call to receive arguments.');
    }

    expect(secondCallArgs.tool).toBe(tools.stubTool);


    const stubData = secondCallArgs.data as StubData;

    expect(stubData.savedData.type).toBe(failingTool);
  });

  it('derives stub title from the unavailable tools registry when available', () => {
    const customTitle = 'Custom tool title';

    const toolsOverrides: Partial<MockTools> = {
      unavailable: new Map<string, { toolbox?: Array<{ title?: string }> }>([
        ['missing', { toolbox: [ { title: customTitle } ] } ],
      ]),
    };

    const { renderer, tools } = createRenderer({
      tools: toolsOverrides,
    });

    const composeStubDataForTool = (renderer as unknown as {
      composeStubDataForTool: (tool: string, data: OutputBlockData['data'], id?: string) => StubData;
    }).composeStubDataForTool.bind(renderer);

    const stubData = composeStubDataForTool('missing', { payload: true }, 'id-1');

    expect(stubData.title).toBe(customTitle);
    expect(stubData.savedData).toEqual({
      id: 'id-1',
      type: 'missing',
      data: { payload: true },
    });

    expect(tools.unavailable.has('missing')).toBe(true);
  });

  it('falls back to the tool name when toolbox metadata is missing', () => {
    const { renderer } = createRenderer();

    const composeStubDataForTool = (renderer as unknown as {
      composeStubDataForTool: (tool: string, data: OutputBlockData['data'], id?: string) => StubData;
    }).composeStubDataForTool.bind(renderer);

    const stubData = composeStubDataForTool('fallback', { value: 1 }, 'block-id');

    expect(stubData.title).toBe('fallback');
    expect(stubData.savedData).toEqual({
      id: 'block-id',
      type: 'fallback',
      data: { value: 1 },
    });
  });
});

