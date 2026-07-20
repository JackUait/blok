/**
 * Reactive `style.tokens` in the Vue adapter — parity with React/Angular.
 *
 * `style` was construction-only, so a host with a live light/dark toggle could
 * not drive Blok's theme tokens from Vue state and fell back to a hand-written
 * global stylesheet duplicating the one Blok injects. Tokens now flow through
 * the runtime `editor.tokens` API.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, nextTick, reactive } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import { useBlok } from '../../../packages/vue/src/useBlok';
import type { UseBlokConfig } from '../../../packages/vue/src/types';

async function mountReady(initial: UseBlokConfig): Promise<{ config: UseBlokConfig }> {
  const config = reactive({ ...initial });

  const Harness = defineComponent({
    setup() {
      useBlok(() => config);

      return () => h('div');
    },
  });

  mount(Harness);

  blokRegistry.last!.resolveReady();
  await flushPromises();

  return { config };
}

describe('useBlok reactive style.tokens', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pushes a changed token set through editor.tokens.set', async () => {
    const { config } = await mountReady({ style: { tokens: { '--blok-popover-bg': '#fff' } } });
    const instance = blokRegistry.last!;

    config.style = { tokens: { '--blok-popover-bg': '#1f1f1f' } };
    await nextTick();

    expect(instance.tokens.set).toHaveBeenLastCalledWith({ '--blok-popover-bg': '#1f1f1f' });
  });

  it('does not re-push an identical token set', async () => {
    const { config } = await mountReady({ style: { tokens: { '--blok-popover-bg': '#fff' } } });
    const instance = blokRegistry.last!;

    const callsBefore = instance.tokens.set.mock.calls.length;

    config.style = { tokens: { '--blok-popover-bg': '#fff' } };
    await nextTick();

    expect(instance.tokens.set.mock.calls.length).toBe(callsBefore);
  });

  it('applies an emptied token set so removed tokens stop applying', async () => {
    const { config } = await mountReady({ style: { tokens: { '--blok-popover-bg': '#fff' } } });
    const instance = blokRegistry.last!;

    config.style = { tokens: {} };
    await nextTick();

    expect(instance.tokens.set).toHaveBeenLastCalledWith({});
  });

  it('leaves tokens alone when style.tokens is absent', async () => {
    await mountReady({ style: { nativeSelection: true } });

    expect(blokRegistry.last!.tokens.set).not.toHaveBeenCalled();
  });
});
