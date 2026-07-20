import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import type { API, BlockAPI } from '@/types';
import type { BlockToolConstructorOptions } from '@/types/tools/block-tool';
import { Stub, type StubData } from '../../../src/tools/stub';
import { Blok } from '../../../src/blok';
import type { BlokConfig, OutputData } from '../../../types';

interface CreateStubOptions {
  data?: Partial<StubData>;
  translator?: MockInstance<(key: string) => string>;
}

const createStub = (
  options: CreateStubOptions = {}
): {
  stub: Stub;
  translator: MockInstance<(key: string) => string>;
  data: StubData;
  savedData: StubData['savedData'];
} => {
  const translator = options.translator ?? vi.fn((key: string) => `translated:${key}`);
  const savedData = options.data?.savedData ?? {
    type: 'missing-tool',
    data: { payload: true },
  };
  const stubData: StubData = {
    title: 'Unavailable tool',
    savedData,
    ...options.data,
  };

  const stub = new Stub({
    data: stubData,
    api: {
      i18n: {
        t: translator,
      },
    } as unknown as API,
    block: {} as BlockAPI,
    readOnly: false,
  } as BlockToolConstructorOptions<StubData>);

  return {
    stub,
    translator,
    data: stubData,
    savedData,
  };
};

describe('Stub tool', () => {
  it('exposes read-only capability flag', () => {
    expect(Stub.isReadOnlySupported).toBe(true);
  });

  it('renders provided title along with translated subtitle', () => {
    const translator = vi.fn((key: string) => `t:${key}`);
    const { stub } = createStub({
      data: {
        title: 'Broken block',
      },
      translator,
    });

    const element = stub.render();
    const titleEl = element.querySelector('[data-blok-stub-title]');
    const subtitleEl = element.querySelector('[data-blok-stub-subtitle]');

    expect(element).toHaveAttribute('data-blok-tool', 'stub');
    expect(titleEl?.textContent).toBe('Broken block');
    expect(subtitleEl?.textContent).toBe('t:tools.stub.blockCannotBeDisplayed');
    expect(translator).toHaveBeenCalledTimes(1);
    expect(translator).toHaveBeenCalledWith('tools.stub.blockCannotBeDisplayed');
  });

  it('falls back to translated error title when data title is missing', () => {
    const translator = vi.fn((key: string) => `t:${key}`);
    const { stub } = createStub({
      data: {
        title: '',
      },
      translator,
    });

    const element = stub.render();
    const titleEl = element.querySelector('[data-blok-stub-title]');

    expect(translator).toHaveBeenNthCalledWith(1, 'tools.stub.error');
    expect(translator).toHaveBeenNthCalledWith(2, 'tools.stub.blockCannotBeDisplayed');
    expect(titleEl?.textContent).toBe('t:tools.stub.error');
  });

  it('returns a deep copy of the saved data, never the retained reference', () => {
    const savedData = {
      id: 'block-1',
      type: 'unsupported',
      data: { text: 'legacy payload', nested: { list: [ 'a' ] } },
    };
    const { stub } = createStub({
      data: {
        savedData,
      },
    });

    const output = stub.save();

    expect(output).toEqual(savedData);
    expect(output).not.toBe(savedData);
    expect(output.data).not.toBe(savedData.data);
    expect(output.data.nested).not.toBe(savedData.data.nested);
  });

  it('reuses the same wrapper element between renders', () => {
    const { stub } = createStub();

    const firstRender = stub.render();
    const secondRender = stub.render();

    expect(secondRender).toBe(firstRender);
  });

  it('has setReadOnly method that does not throw', () => {
    const { stub } = createStub();

    expect(() => stub.setReadOnly(true)).not.toThrow();
    expect(() => stub.setReadOnly(false)).not.toThrow();
  });
});

/**
 * Regression: editor.save() output for stub-substituted blocks (unregistered
 * tool types) must not alias the stub's retained internals — a consumer that
 * mutates a save() result must not corrupt subsequent saves.
 */
describe('Stub tool save output through editor.save()', () => {
  let holder: HTMLElement;
  let editor: Blok | null = null;

  const buildDocument = (): OutputData => ({
    blocks: [
      {
        id: 'mystery-1',
        type: 'mystery',
        data: {
          text: 'original',
          nested: { deep: { value: 'keep' }, list: [ 'a', 'b' ] },
        },
      },
    ],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (editor !== null) {
      await editor.isReady;
      editor.destroy();
      editor = null;
    }
    holder.remove();
  });

  const createEditor = (data: OutputData): Blok => {
    return new Blok({
      holder,
      data,
    } as unknown as BlokConfig);
  };

  it('mutating a save() result does not corrupt subsequent saves', async () => {
    editor = createEditor(buildDocument());
    await editor.isReady;

    const first = await editor.save();
    const firstBlock = first.blocks[0];

    expect(firstBlock.type).toBe('mystery');
    expect(firstBlock.data.text).toBe('original');

    // Consumer mutates the returned object — top-level and deeply nested.
    firstBlock.data.text = 'TAMPERED';
    (firstBlock.data.nested as { deep: { value: string } }).deep.value = 'TAMPERED-DEEP';
    (firstBlock.data.nested as { list: string[] }).list.push('TAMPERED-ITEM');

    const second = await editor.save();
    const secondBlock = second.blocks[0];

    expect(secondBlock.data.text).toBe('original');
    expect(secondBlock.data.nested).toEqual({
      deep: { value: 'keep' },
      list: [ 'a', 'b' ],
    });
  });

  it('two consecutive saves return structurally equal but not identity-shared data', async () => {
    editor = createEditor(buildDocument());
    await editor.isReady;

    const first = await editor.save();
    const second = await editor.save();

    expect(second.blocks[0].data).toEqual(first.blocks[0].data);
    expect(second.blocks[0].data).not.toBe(first.blocks[0].data);
    expect(second.blocks[0].data.nested).not.toBe(first.blocks[0].data.nested);
  });
});
