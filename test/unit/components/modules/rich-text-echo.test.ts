/**
 * A host that feeds `onSave` output back into `blocks.render` must hit the
 * echo short-circuit, or the rebuild drops the caret.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Blok } from '../../../../src/blok';
import { BlockManager } from '../../../../src/components/modules/blockManager';
import { Renderer } from '../../../../src/components/modules/renderer';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { BlokConfig, OutputData } from '../../../../types';

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  render: (data: OutputData) => Promise<void>;
  destroy: () => void;
}

const editors: TestEditor[] = [];
const holders: HTMLElement[] = [];

const createEditor = async (config: Partial<BlokConfig>): Promise<TestEditor> => {
  const holder = document.createElement('div');

  document.body.appendChild(holder);
  holders.push(holder);

  const editor = new Blok({ holder, tools: { paragraph: Paragraph }, ...config }) as unknown as TestEditor;

  editors.push(editor);
  await editor.isReady;

  return editor;
};

/** Spies on both steps of a rebuild; the boot render has already run. */
const spyOnRebuild = (): { rendered: () => boolean } => {
  const render = vi.spyOn(Renderer.prototype, 'render');
  const clear = vi.spyOn(BlockManager.prototype, 'clear');

  return { rendered: () => render.mock.calls.length > 0 || clear.mock.calls.length > 0 };
};

describe('rich text segments — controlled-component echo', { timeout: 60_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    editors.splice(0).forEach(editor => editor.destroy());
    holders.splice(0).forEach(holder => holder.remove());
    vi.restoreAllMocks();
  });

  it('re-rendering the saved segments is a no-op', async () => {
    const editor = await createEditor({
      data: { blocks: [ { type: 'paragraph', data: { text: '<strong>a</strong> <mark style="color: var(--blok-color-red-text);">b</mark>' } } ] },
    });
    const saved = await editor.save();
    const rebuild = spyOnRebuild();

    await editor.render(saved);

    expect(rebuild.rendered()).toBe(false);
    expect(Array.isArray(saved.blocks[0].data.text)).toBe(true);
  });

  it('an editor booted from saved segments takes their echo without a rebuild', async () => {
    const source = await createEditor({
      data: { blocks: [ { type: 'paragraph', data: { text: '<strong>a</strong> <mark style="color: var(--blok-color-red-text);">b</mark>' } } ] },
    });
    const saved = await source.save();
    const editor = await createEditor({ data: saved });
    const rebuild = spyOnRebuild();

    await editor.render(saved);

    expect(rebuild.rendered()).toBe(false);
  });

  it('a changed document still rebuilds', async () => {
    const editor = await createEditor({ data: { blocks: [ { type: 'paragraph', data: { text: 'a' } } ] } });
    const rebuild = spyOnRebuild();

    await editor.render({ blocks: [ { type: 'paragraph', data: { text: [ { text: 'b' } ] } } ] });

    expect(rebuild.rendered()).toBe(true);
  });

  it('a raw hex colour\'s saved output echoes without a rebuild', async () => {
    const editor = await createEditor({});
    const input: OutputData = { blocks: [ { type: 'paragraph', data: { text: '<mark style="color: #d44c47;">b</mark>' } } ] };

    await editor.render(input);
    const saved = await editor.save();
    const rebuild = spyOnRebuild();

    await editor.render(saved);

    expect(rebuild.rendered()).toBe(false);
  });

  it('re-rendering the HTML the editor was booted with is a no-op', async () => {
    const input: OutputData = { blocks: [ { type: 'paragraph', data: { text: '<b>a</b> b' } } ] };
    const editor = await createEditor({ data: input });
    const rebuild = spyOnRebuild();

    await editor.render(input);

    expect(rebuild.rendered()).toBe(false);
  });

  it.each([
    ['split runs', [ { text: 'a' }, { text: 'b', marks: { bold: true } }, { text: 'c', marks: { bold: true } } ]],
    ['an off mark', [ { text: 'a', marks: { bold: false } }, { text: 'bc', marks: { bold: true } } ]],
    ['an empty run', [ { text: 'a' }, { text: '' }, { text: 'bc', marks: { bold: true } } ]],
  ])('host-built segments equal to the content echo without a rebuild (%s)', async (_label, text) => {
    const editor = await createEditor({ data: { blocks: [ { id: 'p', type: 'paragraph', data: { text: 'a<b>bc</b>' } } ] } });
    const input = { blocks: [ { id: 'p', type: 'paragraph', data: { text } } ] } as OutputData;
    const rebuild = spyOnRebuild();

    await editor.render(input);
    await editor.render(input);

    expect(rebuild.rendered()).toBe(false);
  });
});
