import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Blok from '../../../../src/blok';
import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';
import { Paragraph } from '../../../../src/tools/paragraph';
import type { Blok as PublicBlok, BlokConfig } from '../../../../types';

/**
 * An undo or redo key press says what it did in the polite live region, like
 * Notion: "Undone", "Redone", "Nothing to undo", "Nothing to redo".
 */
describe('undo and redo announcements', () => {
  let holder: HTMLDivElement;
  let blok: PublicBlok | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    blok?.destroy();
    blok = null;
    holder.remove();
    vi.restoreAllMocks();
  });

  // The src class gets its module APIs by a prototype swap at boot; the published type lists them.
  const boot = async (config: Partial<BlokConfig> = {}): Promise<PublicBlok> => {
    const booted = new Blok({
      holder,
      tools: { paragraph: { class: Paragraph } },
      data: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'hi' } }] },
      ...config,
    }) as unknown as PublicBlok;

    blok = booted;
    await booted.isReady;
    booted.history.clear();

    return booted;
  };

  /** The region writes on the next macrotask; read it after that. */
  const announced = async (): Promise<string> => {
    await new Promise((resolve) => setTimeout(resolve, 20));

    const region = document.getElementById('blok-announcer');

    if (region === null) {
      throw new Error('no live region');
    }

    return region.textContent;
  };

  /** Each press clears the region first; wait out the queue settle so presses do not merge. */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 200));

  const blockHolder = (): HTMLElement => {
    const found = holder.querySelector(`[${DATA_ATTR.element}]`);

    if (!(found instanceof HTMLElement)) {
      throw new Error('no block');
    }

    return found;
  };

  const press = (target: HTMLElement, init: KeyboardEventInit): void => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  };

  const editBlock = async (booted: PublicBlok): Promise<void> => {
    await booted.blocks.update('p1', { text: 'changed' });
  };

  it('says Undone, Redone, then Nothing to redo for Cmd+Z, Cmd+Shift+Z, Cmd+Shift+Z', async () => {
    const booted = await boot();

    await editBlock(booted);

    press(blockHolder(), { key: 'z', metaKey: true });
    expect(await announced()).toBe('Undone');
    await settle();

    press(blockHolder(), { key: 'z', metaKey: true, shiftKey: true });
    expect(await announced()).toBe('Redone');
    await settle();

    press(blockHolder(), { key: 'z', metaKey: true, shiftKey: true });
    expect(await announced()).toBe('Nothing to redo');
  });

  it('says Redone for Ctrl+Y', async () => {
    const booted = await boot();

    await editBlock(booted);
    press(blockHolder(), { key: 'z', ctrlKey: true });
    await settle();

    press(blockHolder(), { key: 'y', ctrlKey: true });
    expect(await announced()).toBe('Redone');
  });

  // Notion RM8: an empty undo with the caret in the page says so.
  it('says Nothing to undo for an undo press with nothing to undo', async () => {
    await boot();
    const range = document.createRange();

    range.selectNodeContents(blockHolder());
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    press(blockHolder(), { key: 'z', metaKey: true });
    expect(await announced()).toBe('Nothing to undo');
  });

  // Notion U121: with blocks block-selected the same press is silent.
  it('says nothing for an empty undo while blocks are selected', async () => {
    const booted = await boot();

    (booted as unknown as { module: { blockSelection: { selectBlockByIndex: (index: number) => void } } })
      .module.blockSelection.selectBlockByIndex(0);

    press(blockHolder(), { key: 'z', metaKey: true });
    expect(await announced()).toBe('');
  });

  it('says Nothing to undo for an empty undo in the page title', async () => {
    await boot({ pageTitle: true });
    const title = holder.querySelector(`[${DATA_ATTR.pageTitle}]`);

    if (!(title instanceof HTMLElement)) {
      throw new Error('no title');
    }

    press(title, { key: 'z', metaKey: true });
    expect(await announced()).toBe('Nothing to undo');
  });

  it('announces the browser Edit menu undo and redo too', async () => {
    const booted = await boot();

    await editBlock(booted);
    blockHolder().dispatchEvent(new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true }));
    expect(await announced()).toBe('Undone');
    await settle();

    // The undo re-rendered the block, so find its holder again.
    blockHolder().dispatchEvent(new InputEvent('beforeinput', { inputType: 'historyRedo', bubbles: true, cancelable: true }));
    expect(await announced()).toBe('Redone');
  });

  it('says what a press in the page title did', async () => {
    const booted = await boot({ pageTitle: true });
    const title = holder.querySelector(`[${DATA_ATTR.pageTitle}]`);

    if (!(title instanceof HTMLElement)) {
      throw new Error('no title');
    }
    booted.title.set('Plans');

    press(title, { key: 'z', metaKey: true });
    expect(await announced()).toBe('Undone');
    await settle();

    press(title, { key: 'z', metaKey: true, shiftKey: true });
    expect(await announced()).toBe('Redone');
    await settle();

    press(title, { key: 'z', metaKey: true, shiftKey: true });
    expect(await announced()).toBe('Nothing to redo');
  });

  it('keeps blok.history.undo() and redo() silent: the host made that call, not a key press', async () => {
    const booted = await boot();
    const { history } = booted;

    await editBlock(booted);
    history.undo();
    expect(await announced()).toBe('');

    history.redo();
    history.redo();
    expect(await announced()).toBe('');
  });
});
