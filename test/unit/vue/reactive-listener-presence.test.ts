/**
 * Reactive LISTENER presence on `<BlokEditor>` (Vue adapter).
 *
 * `reactive-handlers.test.ts` pins the `useBlok` half: a config whose callback
 * set changes is pushed onto the SAME editor through `handlers.set`. This file
 * pins the `<BlokEditor>` half, which is where the signal used to die.
 *
 * `@change` / `@save` / `v-model:data` / `@after-render` are emit-mapped
 * listeners, not declared props, so they exist only on the component's
 * `vnode.props` — a plain object Vue swaps out on each patch, never a reactive
 * source. A host that toggled a listener WITHOUT also changing a reactive prop
 * therefore left the handler watcher untriggered: the config it re-read on the
 * next unrelated prop change was correct, but nothing asked it to re-read.
 *
 * The host components below flip exactly one listener and touch no prop, which
 * is the shape that used to be invisible.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, ref, type Ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import { BlokEditor } from '../../../packages/vue/src/BlokEditor';
import type { LiveHandlers } from '@/types';

/** Merge of every `handlers.set` payload pushed so far (last write wins). */
function appliedHandlers(): LiveHandlers {
  const calls = blokRegistry.last?.handlers.set.mock.calls ?? [];

  return calls.reduce<LiveHandlers>(
    (merged, [payload]) => ({ ...merged, ...(payload as LiveHandlers) }),
    {}
  );
}

/** Handler registered for a core event via `editor.on(name, handler)`. */
function registeredHandler(name: string): ((payload?: unknown) => void) | undefined {
  const call = blokRegistry.last?.on.mock.calls.find(([eventName]) => eventName === name);

  return call?.[1] as ((payload?: unknown) => void) | undefined;
}

/**
 * Mounts `<BlokEditor>` under a host that adds `listeners` only while the
 * returned flag is true. Nothing else about the vnode changes, so the flag is
 * the sole signal a listener appeared or vanished.
 * @param listeners - the emit listeners to toggle
 * @param initiallyListening - whether they are present at construction
 * @returns the toggle flag, live once the editor has resolved
 */
async function mountToggleHost(
  listeners: Record<string, (...args: never[]) => void>,
  initiallyListening = false
): Promise<Ref<boolean>> {
  const listening = ref(initiallyListening);

  mount(
    defineComponent({
      setup() {
        return () => h(BlokEditor, listening.value ? { ...listeners } : {});
      },
    })
  );

  blokRegistry.last?.resolveReady();
  await flushPromises();

  return listening;
}

describe('BlokEditor reactive listener presence', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('arms core onSave when a @save listener appears with no prop change', async () => {
    const onSave = vi.fn();
    const listening = await mountToggleHost({ onSave });

    expect(blokRegistry.last?.config.onSave).toBeUndefined();

    listening.value = true;
    await flushPromises();

    expect(blokRegistry.instances).toHaveLength(1);
    expect(appliedHandlers().onSave).toBeTypeOf('function');
  });

  it('arms core onSave when a v-model:data binding appears with no prop change', async () => {
    const listening = await mountToggleHost({ 'onUpdate:data': vi.fn() });

    listening.value = true;
    await flushPromises();

    expect(appliedHandlers().onSave).toBeTypeOf('function');
  });

  it('arms core onChange when a @change listener appears with no prop change', async () => {
    const listening = await mountToggleHost({ onChange: vi.fn() });

    listening.value = true;
    await flushPromises();

    expect(appliedHandlers().onChange).toBeTypeOf('function');
  });

  it('arms core onAfterRender when an @after-render listener appears with no prop change', async () => {
    const listening = await mountToggleHost({ onAfterRender: vi.fn() });

    listening.value = true;
    await flushPromises();

    expect(appliedHandlers().onAfterRender).toBeTypeOf('function');
  });

  it('clears core onChange on the SAME instance when the @change listener disappears', async () => {
    const listening = await mountToggleHost({ onChange: vi.fn() }, true);

    expect(blokRegistry.last?.config.onChange).toBeTypeOf('function');

    listening.value = false;
    await flushPromises();

    expect(blokRegistry.instances).toHaveLength(1);
    expect(appliedHandlers()).toHaveProperty('onChange', undefined);
  });

  it('forwards through the emit channel after a late @save listener is armed', async () => {
    const onSave = vi.fn();
    const listening = await mountToggleHost({ onSave });

    listening.value = true;
    await flushPromises();

    const payload = { time: 1, blocks: [], version: '1' };

    appliedHandlers().onSave?.(payload, {} as never);

    expect(onSave).toHaveBeenCalledWith(payload);
  });

  it('subscribes to blocks:rendered when the listener appears after mount', async () => {
    const listening = await mountToggleHost({ onBlocksRendered: vi.fn() });

    expect(blokRegistry.last?.on).not.toHaveBeenCalled();

    listening.value = true;
    await flushPromises();

    expect(registeredHandler('blocks:rendered')).toBeTypeOf('function');
  });

  it('pushes exactly one handler update per presence flip', async () => {
    // The reactive source is READ by the config snapshot, so writing it from
    // there would make the read its own write. Vue would surface that as
    // "Maximum recursive updates exceeded"; a quieter version of the same bug
    // is an extra push per flip, which this count catches.
    const listening = await mountToggleHost({ onChange: vi.fn() });

    expect(blokRegistry.last?.handlers.set.mock.calls).toHaveLength(0);

    listening.value = true;
    await flushPromises();

    expect(blokRegistry.last?.handlers.set.mock.calls).toHaveLength(1);

    listening.value = false;
    await flushPromises();

    expect(blokRegistry.last?.handlers.set.mock.calls).toHaveLength(2);
  });

  it('does not re-push handlers when a re-render leaves listener presence unchanged', async () => {
    const listening = await mountToggleHost({ onChange: vi.fn() }, true);
    const callsAfterMount = blokRegistry.last?.handlers.set.mock.calls.length ?? 0;

    // Same presence, new vnode: the host re-renders with a fresh listener
    // identity. Presence did not change, so nothing may be pushed.
    listening.value = false;
    listening.value = true;
    await flushPromises();

    expect(blokRegistry.last?.handlers.set.mock.calls.length ?? 0).toBe(callsAfterMount);
  });
});
