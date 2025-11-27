import { describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { API, BlockAPI } from '@/types';
import type { BlockToolConstructorOptions } from '@/types/tools/block-tool';
import Stub, { type StubData } from '../../../src/tools/stub';

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
    const titleEl = element.querySelector('.blok-stub__title');
    const subtitleEl = element.querySelector('.blok-stub__subtitle');

    expect(element.classList.contains('blok-stub')).toBe(true);
    expect(titleEl?.textContent).toBe('Broken block');
    expect(subtitleEl?.textContent).toBe('t:The block can not be displayed correctly.');
    expect(translator).toHaveBeenCalledTimes(1);
    expect(translator).toHaveBeenCalledWith('The block can not be displayed correctly.');
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
    const titleEl = element.querySelector('.blok-stub__title');

    expect(translator).toHaveBeenNthCalledWith(1, 'Error');
    expect(translator).toHaveBeenNthCalledWith(2, 'The block can not be displayed correctly.');
    expect(titleEl?.textContent).toBe('t:Error');
  });

  it('returns the original saved data reference', () => {
    const savedData = {
      id: 'block-1',
      type: 'unsupported',
      data: { text: 'legacy payload' },
    };
    const { stub } = createStub({
      data: {
        savedData,
      },
    });

    expect(stub.save()).toBe(savedData);
  });

  it('reuses the same wrapper element between renders', () => {
    const { stub } = createStub();

    const firstRender = stub.render();
    const secondRender = stub.render();

    expect(secondRender).toBe(firstRender);
  });
});
