import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../../src/components/core';
import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';
import { Paragraph } from '../../../../../src/tools/paragraph';
import type { BlokConfig } from '../../../../../types';

describe('PageTitle undo and redo caret', () => {
  let holder: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    holder.remove();
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
  });

  const boot = async (title: string): Promise<{ core: Core; titleEl: HTMLElement }> => {
    const config: BlokConfig = {
      holder,
      pageTitle: true,
      tools: { paragraph: { class: Paragraph } },
      data: { title, blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Body' } }] },
    };
    const core = new Core(config);

    await core.isReady;
    const titleEl = holder.querySelector<HTMLElement>(`[${DATA_ATTR.pageTitle}]`);

    if (titleEl === null) {
      throw new Error('no title');
    }

    return { core, titleEl };
  };

  const caretAt = (titleEl: HTMLElement, offset: number): void => {
    titleEl.focus();
    window.getSelection()?.setPosition(titleEl.firstChild, offset);
  };

  const titleCaret = (titleEl: HTMLElement): number | null => {
    const selection = window.getSelection();

    return selection?.anchorNode === titleEl.firstChild ? selection?.anchorOffset ?? null : null;
  };

  /** One typed key, as the browser sends it: keydown, the DOM edit, then input. */
  const typeKey = (titleEl: HTMLElement, key: string): void => {
    const selection = window.getSelection();
    const text = titleEl.firstChild;

    if (selection === null || !(text instanceof Text)) {
      throw new Error('no caret in the title');
    }
    titleEl.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    const at = selection.anchorOffset;

    text.insertData(at, key);
    selection.setPosition(text, at + key.length);
    titleEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: key }));
  };

  it('undo puts the caret where the title was edited, and redo after the edit', async () => {
    const { core, titleEl } = await boot('Lab notes');
    const { YjsManager } = core.moduleInstances;

    caretAt(titleEl, 3);
    typeKey(titleEl, 'X');
    YjsManager.stopCapturing();

    YjsManager.undo();
    expect(titleEl.textContent).toBe('Lab notes');
    expect(titleCaret(titleEl)).toBe(3);

    YjsManager.redo();
    expect(titleEl.textContent).toBe('LabX notes');
    expect(titleCaret(titleEl)).toBe(4);
  });

  it('undo of an Enter split puts the caret at the split', async () => {
    const { core, titleEl } = await boot('Lab notes');
    const { YjsManager } = core.moduleInstances;

    caretAt(titleEl, 3);
    titleEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    YjsManager.stopCapturing();

    YjsManager.undo();
    expect(titleEl.textContent).toBe('Lab notes');
    expect(titleCaret(titleEl)).toBe(3);
  });

  it('a title step with no caret of its own still focuses the title end', async () => {
    const { core, titleEl } = await boot('Lab');
    const { YjsManager, PageTitle } = core.moduleInstances;

    PageTitle.setText('Lab notes', 'api');
    YjsManager.stopCapturing();

    YjsManager.undo();
    expect(titleEl.textContent).toBe('Lab');
    expect(titleCaret(titleEl)).toBe(3);
  });

  it('keys typed in the title in a row stay one step', async () => {
    const { core, titleEl } = await boot('Lab');
    const { YjsManager } = core.moduleInstances;

    caretAt(titleEl, 3);
    typeKey(titleEl, ' ');
    typeKey(titleEl, 'a');
    typeKey(titleEl, 'b');
    YjsManager.stopCapturing();

    YjsManager.undo();
    expect(titleEl.textContent).toBe('Lab');
  });
});
