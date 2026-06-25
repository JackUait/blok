import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import { BlokEditor } from '../../../src/vue/BlokEditor';

describe('BlokEditor ready emit', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits ready with the live instance once it becomes available', async () => {
    const wrapper = mount(BlokEditor, { attrs: { onReady: (): void => undefined } });

    expect(wrapper.emitted('ready')).toBeUndefined();

    blokRegistry.last!.resolveReady();
    await flushPromises();

    expect(wrapper.emitted('ready')?.[0]?.[0]).toBe(blokRegistry.last);
  });

  it('emits ready exactly once per instance', async () => {
    const wrapper = mount(BlokEditor, { attrs: { onReady: (): void => undefined } });

    blokRegistry.last!.resolveReady();
    await flushPromises();
    await flushPromises();

    expect(wrapper.emitted('ready')).toHaveLength(1);
  });

  it('does not forward onReady to the core config (adapter-owned)', async () => {
    mount(BlokEditor, { attrs: { onReady: (): void => undefined } });
    blokRegistry.last!.resolveReady();
    await flushPromises();

    expect((blokRegistry.last!.config as { onReady?: unknown }).onReady).toBeUndefined();
  });
});
