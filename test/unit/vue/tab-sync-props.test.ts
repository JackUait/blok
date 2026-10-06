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

describe('BlokEditor documentId / tabSync props', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes documentId and tabSync into the editor config, not onto the container', async () => {
    const wrapper = mount(BlokEditor, {
      props: { documentId: 'acme:42', tabSync: { settings: false } },
    });

    await flushPromises();

    expect(constructedConfig().documentId).toBe('acme:42');
    expect(constructedConfig().tabSync).toEqual({ settings: false });
    expect((wrapper.element as HTMLElement).hasAttribute('documentid')).toBe(false);
  });

  // Vue casts an absent Boolean prop to false; that would turn tab sync off by default.
  it('leaves tabSync out of the config when the prop is absent', async () => {
    mount(BlokEditor);

    await flushPromises();

    expect('tabSync' in constructedConfig()).toBe(false);
  });

  it('passes tabSync: false through', async () => {
    mount(BlokEditor, { props: { tabSync: false } });

    await flushPromises();

    expect(constructedConfig().tabSync).toBe(false);
  });
});
