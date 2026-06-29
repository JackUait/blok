import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import { BlokEditor } from '../../../src/vue/BlokEditor';

/** Returns the handler registered for a core event via editor.on(name, handler). */
function registeredHandler(name: string): ((payload?: unknown) => void) | undefined {
  const call = blokRegistry.last!.on.mock.calls.find(([eventName]) => eventName === name);

  return call?.[1] as ((payload?: unknown) => void) | undefined;
}

describe('BlokEditor rendered-lifecycle events', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('subscribes to blocks:rendered only when a listener exists and forwards the payload', async () => {
    const wrapper = mount(BlokEditor, { attrs: { onBlocksRendered: (): void => undefined } });

    blokRegistry.last!.resolveReady();
    await flushPromises();

    const handler = registeredHandler('blocks:rendered');

    expect(handler).toBeTypeOf('function');

    const payload = { blocks: 3 };

    handler!(payload);

    expect(wrapper.emitted('blocks-rendered')?.[0]?.[0]).toBe(payload);
  });

  it('subscribes to block:rendered only when a listener exists and forwards the payload', async () => {
    const wrapper = mount(BlokEditor, { attrs: { onBlockRendered: (): void => undefined } });

    blokRegistry.last!.resolveReady();
    await flushPromises();

    const handler = registeredHandler('block:rendered');

    expect(handler).toBeTypeOf('function');

    const payload = { id: 'b1' };

    handler!(payload);

    expect(wrapper.emitted('block-rendered')?.[0]?.[0]).toBe(payload);
  });

  it('does NOT subscribe to rendered events when no listener exists', async () => {
    mount(BlokEditor);

    blokRegistry.last!.resolveReady();
    await flushPromises();

    expect(blokRegistry.last!.on).not.toHaveBeenCalled();
  });

  it('unsubscribes via editor.off on unmount', async () => {
    const wrapper = mount(BlokEditor, { attrs: { onBlocksRendered: (): void => undefined } });

    blokRegistry.last!.resolveReady();
    await flushPromises();

    const instance = blokRegistry.last!;
    const handler = registeredHandler('blocks:rendered');

    wrapper.unmount();

    expect(instance.off).toHaveBeenCalledWith('blocks:rendered', handler);
  });
});
