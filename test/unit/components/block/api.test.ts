import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import BlockAPIConstructor from '../../../../src/components/block/api';
import type Block from '../../../../src/components/block';
import type { BlockToolData, ToolConfig, ToolboxConfigEntry } from '../../../../types/tools';
import type { SavedData } from '../../../../types/data-formats';
import type { BlockAPI as BlockAPIInterface } from '../../../../types/api';

type MockBlockShape = {
  id: string;
  name: string;
  config: ToolConfig;
  holder: HTMLElement;
  isEmpty: boolean;
  selected: boolean;
  stretched: boolean;
  focusable: boolean;
  setStretchState: (state: boolean) => void;
  call: (methodName: string, param?: object) => unknown;
  save: () => Promise<void | SavedData>;
  validate: (data: BlockToolData) => Promise<boolean>;
  dispatchChange: () => void;
  getActiveToolboxEntry: () => Promise<ToolboxConfigEntry | undefined>;
};

type MockFn<T> = T extends (...args: infer TArgs) => infer TReturn ? Mock<TArgs, TReturn> : never;

const createMockBlock = (): {
  block: Block;
  shape: MockBlockShape;
  mocks: {
    setStretchState: MockFn<MockBlockShape['setStretchState']>;
    call: MockFn<MockBlockShape['call']>;
    save: MockFn<MockBlockShape['save']>;
    validate: MockFn<MockBlockShape['validate']>;
    dispatchChange: MockFn<MockBlockShape['dispatchChange']>;
    getActiveToolboxEntry: MockFn<MockBlockShape['getActiveToolboxEntry']>;
  };
  config: ToolConfig;
  holder: HTMLElement;
  savedData: SavedData;
  toolboxEntry: ToolboxConfigEntry;
} => {
  const holder = document.createElement('div');
  const config: ToolConfig = { placeholder: 'Test placeholder' };
  const savedData: SavedData = {
    id: 'block-id',
    tool: 'paragraph',
    data: { text: 'saved text' } as BlockToolData,
    time: 42,
  };
  const toolboxEntry: ToolboxConfigEntry = {
    title: 'Paragraph',
    icon: '<svg></svg>',
    data: { preset: 'default' } as BlockToolData,
  };

  const callMock: MockFn<MockBlockShape['call']> = vi.fn<Parameters<MockBlockShape['call']>, ReturnType<MockBlockShape['call']>>()
    .mockReturnValue('call-result');
  const saveMock: MockFn<MockBlockShape['save']> = vi.fn<Parameters<MockBlockShape['save']>, ReturnType<MockBlockShape['save']>>()
    .mockResolvedValue(savedData);
  const validateMock: MockFn<MockBlockShape['validate']> = vi.fn<Parameters<MockBlockShape['validate']>, ReturnType<MockBlockShape['validate']>>()
    .mockResolvedValue(true);
  const dispatchChangeMock: MockFn<MockBlockShape['dispatchChange']> = vi.fn<Parameters<MockBlockShape['dispatchChange']>, ReturnType<MockBlockShape['dispatchChange']>>();
  const getActiveToolboxEntryMock: MockFn<MockBlockShape['getActiveToolboxEntry']> = vi.fn<Parameters<MockBlockShape['getActiveToolboxEntry']>, ReturnType<MockBlockShape['getActiveToolboxEntry']>>()
    .mockResolvedValue(toolboxEntry);
  const setStretchStateMock: MockFn<MockBlockShape['setStretchState']> = vi.fn<Parameters<MockBlockShape['setStretchState']>, ReturnType<MockBlockShape['setStretchState']>>();

  const shape: MockBlockShape = {
    id: 'block-id',
    name: 'paragraph',
    config,
    holder,
    isEmpty: false,
    selected: false,
    stretched: false,
    focusable: true,
    setStretchState: (state: boolean) => {
      shape.stretched = state;
    },
    call: callMock,
    save: saveMock,
    validate: validateMock,
    dispatchChange: dispatchChangeMock,
    getActiveToolboxEntry: getActiveToolboxEntryMock,
  };

  shape.setStretchState = setStretchStateMock.mockImplementation((state: boolean) => {
    shape.stretched = state;
  });

  return {
    block: shape as unknown as Block,
    shape,
    mocks: {
      setStretchState: setStretchStateMock,
      call: callMock,
      save: saveMock,
      validate: validateMock,
      dispatchChange: dispatchChangeMock,
      getActiveToolboxEntry: getActiveToolboxEntryMock,
    },
    config,
    holder,
    savedData,
    toolboxEntry,
  };
};

describe('BlockAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes block metadata and state properties', () => {
    const { block, config, holder, shape } = createMockBlock();
    const blockAPI = new BlockAPIConstructor(block);

    expect(blockAPI.id).toBe(shape.id);
    expect(blockAPI.name).toBe(shape.name);
    expect(blockAPI.config).toBe(config);
    expect(blockAPI.holder).toBe(holder);
    expect(blockAPI.isEmpty).toBe(shape.isEmpty);
    expect(blockAPI.selected).toBe(shape.selected);
    expect(blockAPI.focusable).toBe(shape.focusable);
    expect(blockAPI.stretched).toBe(shape.stretched);
  });

  it('updates stretch state through setter and reflects changes', () => {
    const { block, shape, mocks } = createMockBlock();
    const blockAPI = new BlockAPIConstructor(block);

    blockAPI.stretched = true;

    expect(mocks.setStretchState).toHaveBeenCalledWith(true);
    expect(shape.stretched).toBe(true);
    expect(blockAPI.stretched).toBe(true);
  });

  it('delegates method calls to the underlying block', async () => {
    const { block, mocks, savedData, toolboxEntry } = createMockBlock();
    const blockAPI = new BlockAPIConstructor(block);
    const callParams = { value: 123 };
    const methodName = 'method';
    const validationData = { text: 'validate' } as BlockToolData;

    const callResult = blockAPI.call(methodName, callParams);
    const saveResult = await blockAPI.save();
    const validationResult = await blockAPI.validate(validationData);

    blockAPI.dispatchChange();
    const activeToolboxEntry = await blockAPI.getActiveToolboxEntry();

    expect(mocks.call).toHaveBeenCalledWith(methodName, callParams);
    expect(callResult).toBe('call-result');

    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(saveResult).toBe(savedData);

    expect(mocks.validate).toHaveBeenCalledWith(validationData);
    expect(validationResult).toBe(true);

    expect(mocks.dispatchChange).toHaveBeenCalledTimes(1);

    expect(mocks.getActiveToolboxEntry).toHaveBeenCalledTimes(1);
    expect(activeToolboxEntry).toBe(toolboxEntry);
  });

  it('creates BlockAPI instances compatible with BlockAPIInterface', () => {
    const { block } = createMockBlock();
    const blockAPI = new BlockAPIConstructor(block);

    const apiInterface: BlockAPIInterface = blockAPI;

    expect(apiInterface.id).toBe(blockAPI.id);
    expect(apiInterface.name).toBe(blockAPI.name);
  });
});

