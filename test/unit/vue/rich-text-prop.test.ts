import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import { BlokEditor } from '../../../packages/vue/src/BlokEditor';

const constructedConfig = (): Record<string, unknown> => {
  const last = blokRegistry.last;

  if (last === undefined || last === null) {
    throw new Error('no editor was constructed');
  }

  return last.config;
};

describe('BlokEditor richText prop', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes richText into the editor config, not onto the container', async () => {
    const wrapper = mount(BlokEditor, {
      props: { richText: 'segments' },
    });

    await flushPromises();

    expect(constructedConfig().richText).toBe('segments');
    expect((wrapper.element as HTMLElement).hasAttribute('richtext')).toBe(false);
  });

  it('leaves richText out of the config when the prop is absent', async () => {
    mount(BlokEditor);

    await flushPromises();

    expect('richText' in constructedConfig()).toBe(false);
  });
});
