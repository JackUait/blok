/**
 * Reactive `i18n` in the Vue adapter — parity with React/Angular.
 *
 * `config.i18n` was consumed once at boot, so a host with a language switcher
 * had to recreate the editor (losing caret, focus and undo stack) to relabel
 * the UI. The locale, host message overrides and direction now flow through
 * the runtime `editor.i18n.update` API.
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

describe('useBlok reactive i18n', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pushes a locale change through editor.i18n.update', async () => {
    const { config } = await mountReady({ i18n: { locale: 'en' } });
    const instance = blokRegistry.last!;

    expect(instance.i18n.update).not.toHaveBeenCalled();

    config.i18n = { locale: 'ru' };
    await nextTick();

    expect(instance.i18n.update).toHaveBeenLastCalledWith({ locale: 'ru' });
  });

  it('pushes changed host messages', async () => {
    const { config } = await mountReady({ i18n: { locale: 'en' } });
    const instance = blokRegistry.last!;

    config.i18n = { locale: 'en', messages: { 'a11y.insertBlock': 'Add' } };
    await nextTick();

    expect(instance.i18n.update).toHaveBeenLastCalledWith({
      locale: 'en',
      messages: { 'a11y.insertBlock': 'Add' },
    });
  });

  it('does not re-push an identical config', async () => {
    const { config } = await mountReady({ i18n: { locale: 'ru' } });
    const instance = blokRegistry.last!;

    config.i18n = { locale: 'ru' };
    await nextTick();

    expect(instance.i18n.update).not.toHaveBeenCalled();
  });

  it('leaves i18n alone when the key is absent', async () => {
    await mountReady({ placeholder: 'write…' });

    expect(blokRegistry.last!.i18n.update).not.toHaveBeenCalled();
  });
});
