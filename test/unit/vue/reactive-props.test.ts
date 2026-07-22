import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, nextTick, reactive } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import { useBlok } from '../../../packages/vue/src/useBlok';
import { BlokEditor } from '../../../packages/vue/src/BlokEditor';
import type { UseBlokConfig } from '../../../packages/vue/src/types';

/** Mounts useBlok over a reactive config and resolves the editor immediately. */
async function mountReady(initial: UseBlokConfig): Promise<{ config: UseBlokConfig; unmount: () => void }> {
  const config = reactive({ ...initial });

  const Harness = defineComponent({
    setup() {
      useBlok(() => config);

      return () => h('div');
    },
  });

  const wrapper = mount(Harness);

  blokRegistry.last!.resolveReady();
  await flushPromises();

  return { config, unmount: () => wrapper.unmount() };
}

describe('useBlok reactive props', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('syncs readOnly, coercing undefined to false', async () => {
    const { config } = await mountReady({ readOnly: false });
    const instance = blokRegistry.last!;

    expect(instance.readOnly.set).toHaveBeenCalledWith(false);

    config.readOnly = true;
    await nextTick();
    expect(instance.readOnly.set).toHaveBeenLastCalledWith(true);

    config.readOnly = undefined;
    await nextTick();
    expect(instance.readOnly.set).toHaveBeenLastCalledWith(false);
  });

  it('exposes the in-place toggle capability on the instance', async () => {
    await mountReady({});
    const instance = blokRegistry.last!;

    expect(instance.readOnly.togglesInPlace).toBe(true);
  });

  it('syncs the readOnly object form, passing hideControls without recreating the editor', async () => {
    const { config } = await mountReady({ readOnly: false });
    const instance = blokRegistry.last!;

    expect(instance.readOnly.set).toHaveBeenLastCalledWith(false);

    config.readOnly = { hideControls: true };
    await nextTick();
    expect(instance.readOnly.set).toHaveBeenLastCalledWith(true, { hideControls: true });

    config.readOnly = { hideControls: false };
    await nextTick();
    expect(instance.readOnly.set).toHaveBeenLastCalledWith(true, { hideControls: false });

    // Back to the boolean form — options must not be passed.
    config.readOnly = true;
    await nextTick();
    expect(instance.readOnly.set).toHaveBeenLastCalledWith(true);

    // In-place contract: still the same single instance.
    expect(blokRegistry.instances).toHaveLength(1);
  });

  it('syncs hideToolbar via toolbar.setHidden, coercing undefined to false, without recreation', async () => {
    const { config } = await mountReady({ hideToolbar: true });
    const instance = blokRegistry.last!;

    expect(instance.toolbar.setHidden).toHaveBeenLastCalledWith(true);

    config.hideToolbar = false;
    await nextTick();
    expect(instance.toolbar.setHidden).toHaveBeenLastCalledWith(false);

    config.hideToolbar = undefined;
    await nextTick();
    expect(instance.toolbar.setHidden).toHaveBeenLastCalledWith(false);

    expect(blokRegistry.instances).toHaveLength(1);
  });

  it('syncs inlineToolbar via tools.setInlineToolbar, deduping same-content arrays, without recreation', async () => {
    const { config } = await mountReady({ inlineToolbar: ['bold'] });
    const instance = blokRegistry.last!;

    expect(instance.tools.setInlineToolbar).toHaveBeenCalledTimes(1);
    expect(instance.tools.setInlineToolbar).toHaveBeenLastCalledWith(['bold']);

    // A FRESH array with the same content must not thrash the assignment.
    config.inlineToolbar = ['bold'];
    await nextTick();
    expect(instance.tools.setInlineToolbar).toHaveBeenCalledTimes(1);

    config.inlineToolbar = ['bold', 'italic'];
    await nextTick();
    expect(instance.tools.setInlineToolbar).toHaveBeenCalledTimes(2);
    expect(instance.tools.setInlineToolbar).toHaveBeenLastCalledWith(['bold', 'italic']);

    config.inlineToolbar = false;
    await nextTick();
    expect(instance.tools.setInlineToolbar).toHaveBeenCalledTimes(3);
    expect(instance.tools.setInlineToolbar).toHaveBeenLastCalledWith(false);

    expect(blokRegistry.instances).toHaveLength(1);
  });

  it('accepts the readOnly OBJECT form as a <BlokEditor> prop (no prop-type warning, options applied)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    mount(BlokEditor, { props: { readOnly: { hideControls: true } } });

    blokRegistry.last!.resolveReady();
    await flushPromises();

    const typeWarnings = warn.mock.calls.filter((call) => String(call[0]).includes('type check failed'));

    expect(typeWarnings).toEqual([]);
    expect(blokRegistry.last!.readOnly.set).toHaveBeenLastCalledWith(true, { hideControls: true });
  });

  it('does not call setInlineToolbar when inlineToolbar is not configured', async () => {
    await mountReady({});
    const instance = blokRegistry.last!;

    expect(instance.tools.setInlineToolbar).not.toHaveBeenCalled();
  });

  it('syncs theme only when defined', async () => {
    const { config } = await mountReady({});
    const instance = blokRegistry.last!;

    expect(instance.theme.set).not.toHaveBeenCalled();

    config.theme = 'dark';
    await nextTick();
    expect(instance.theme.set).toHaveBeenCalledWith('dark');
  });

  it('syncs width only when defined', async () => {
    const { config } = await mountReady({});
    const instance = blokRegistry.last!;

    expect(instance.width.set).not.toHaveBeenCalled();

    config.width = 'narrow';
    await nextTick();
    expect(instance.width.set).toHaveBeenCalledWith('narrow');
  });

  it('syncs placeholder, guarding on undefined (not falsiness)', async () => {
    const { config } = await mountReady({ placeholder: 'First' });
    const instance = blokRegistry.last!;

    expect(instance.placeholder.set).toHaveBeenCalledWith('First');

    // placeholder=false is a real value (clear) — must propagate.
    config.placeholder = false;
    await nextTick();
    expect(instance.placeholder.set).toHaveBeenLastCalledWith(false);
  });

  it('calls focus when autofocus is truthy, not when falsy', async () => {
    const { config } = await mountReady({ autofocus: false });
    const instance = blokRegistry.last!;

    expect(instance.focus).not.toHaveBeenCalled();

    config.autofocus = true;
    await nextTick();
    expect(instance.focus).toHaveBeenCalledTimes(1);
  });

  it('applies reactive props once after the instance appears (not before ready)', async () => {
    const config = reactive({ readOnly: true });

    const Harness = defineComponent({
      setup() {
        useBlok(() => config);

        return () => h('div');
      },
    });

    mount(Harness);
    const instance = blokRegistry.last!;

    // Editor not ready yet — nothing applied.
    expect(instance.readOnly.set).not.toHaveBeenCalled();

    instance.resolveReady();
    await flushPromises();

    // Applied exactly once when the instance became available.
    expect(instance.readOnly.set).toHaveBeenCalledTimes(1);
    expect(instance.readOnly.set).toHaveBeenCalledWith(true);
  });
});
