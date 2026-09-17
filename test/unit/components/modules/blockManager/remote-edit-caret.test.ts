/**
 * The caret arithmetic that survives a remote peer's edit. The block-level
 * regression lives in
 * `test/unit/components/modules/collaboration/remote-update-caret.test.ts`;
 * this file pins the offset rule and the "is this caret even mine" guard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  adjustCaretOffset,
  captureCaretAcrossRewrite,
} from '../../../../../src/components/modules/blockManager/remote-edit-caret';

const hosts: HTMLElement[] = [];

/**
 * A stand-in for a Block: a holder with one contenteditable input.
 * @param text - the text the input starts with
 */
const makeBlock = (text: string): { id: string; inputs: HTMLElement[]; holder: HTMLElement } => {
  const holder = document.createElement('div');
  const input = document.createElement('div');

  input.setAttribute('contenteditable', 'true');
  input.textContent = text;
  holder.appendChild(input);
  document.body.appendChild(holder);
  hosts.push(holder);

  return {
    id: 'b1',
    holder,
    get inputs(): HTMLElement[] {
      return Array.from(holder.querySelectorAll<HTMLElement>('[contenteditable=true]'));
    },
  };
};

/**
 * Put a collapsed caret `offset` characters into the block's first input.
 * @param block - the block to put the caret in
 * @param offset - character offset
 */
const putCaret = (block: { inputs: HTMLElement[] }, offset: number): Selection => {
  const selection = document.getSelection();

  if (selection === null) {
    throw new Error('jsdom has no selection');
  }

  const firstChild = block.inputs[0]?.firstChild;

  if (firstChild === null || firstChild === undefined) {
    throw new Error('no text node to anchor into');
  }

  const range = document.createRange();

  range.setStart(firstChild, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);

  return selection;
};

describe('adjustCaretOffset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the offset when the peer edited after the caret', () => {
    expect(adjustCaretOffset('hello world', 'hello world!!!', 5)).toBe(5);
    expect(adjustCaretOffset('hello world', 'hello brave world', 5)).toBe(5);
  });

  it('moves the offset by the inserted length when the peer edited before the caret', () => {
    expect(adjustCaretOffset('hello world', 'XXhello world', 5)).toBe(7);
  });

  it('moves the offset back when the peer deleted before the caret', () => {
    expect(adjustCaretOffset('hello world', 'llo world', 5)).toBe(3);
  });

  it('parks the caret at the start of the changed region when the edit straddles it', () => {
    // 'hello world' -> 'heXXXrld': the character at offset 5 is gone, so there
    // is no honest answer — the documented best effort is the start of the
    // region the peer replaced.
    expect(adjustCaretOffset('hello world', 'heXXXrld', 5)).toBe(2);
  });

  it('leaves an equal-length replacement where it is instead of walking backwards', () => {
    // 'hello' -> 'heLLo': the caret at 3 is still a valid, still-surrounded-by-
    // the-same-amount-of-text position. Parking it at the start of the changed
    // region would move the user's caret backwards for nothing.
    expect(adjustCaretOffset('hello', 'heLLo', 3)).toBe(3);
  });

  it('leaves the offset alone when the text did not change', () => {
    expect(adjustCaretOffset('hello world', 'hello world', 5)).toBe(5);
  });

  it('does not count the same characters as both prefix and suffix', () => {
    // 'aaa' -> 'a': the single surviving 'a' can be read as the common prefix
    // or as the common suffix, not both. Counted twice, the caret at 2 looks
    // like it sits AFTER the deletion and lands at 0; counted once, the edit
    // straddles it and it parks at the start of the changed region.
    expect(adjustCaretOffset('aaa', 'a', 2)).toBe(1);
  });
});

describe('captureCaretAcrossRewrite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    hosts.splice(0).forEach((host) => host.remove());
    document.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
  });

  it('puts the caret back on a live text node after the input is rewritten', () => {
    const block = makeBlock('hello world');
    const selection = putCaret(block, 5);
    const restore = captureCaretAcrossRewrite(block, selection);

    if (restore === null) {
      throw new Error('the caret was not captured');
    }

    block.inputs[0].innerHTML = 'hello brave world';
    restore();

    const live = document.getSelection();

    expect({ node: live?.anchorNode?.nodeName ?? null,
      offset: live?.anchorOffset ?? null,
      attached: live?.anchorNode?.isConnected ?? false })
      .toEqual({ node: '#text',
        offset: 5,
        attached: true });
  });

  it('shifts the caret when the peer typed before it', () => {
    const block = makeBlock('hello world');
    const restore = captureCaretAcrossRewrite(block, putCaret(block, 5));

    block.inputs[0].innerHTML = 'XXhello world';
    restore?.();

    expect(document.getSelection()?.anchorOffset).toBe(7);
  });

  it('writes into the field the caret was in, not the one that took its index', () => {
    const block = makeBlock('hello world');
    const original = block.inputs[0];
    const restore = captureCaretAcrossRewrite(block, putCaret(block, 5));

    // A tool that grows a second field on update: the caret's field is still
    // there, but it is no longer input 0.
    const added = document.createElement('div');

    added.setAttribute('contenteditable', 'true');
    added.textContent = 'a caption';
    block.holder.insertBefore(added, original);
    original.innerHTML = 'hello brave world';
    restore?.();

    const live = document.getSelection();

    expect(original.contains(live?.anchorNode ?? null)).toBe(true);
    expect(live?.anchorOffset).toBe(5);
  });

  it('refuses rather than guesses when the field the caret was in is gone', () => {
    const block = makeBlock('hello world');
    const original = block.inputs[0];
    const restore = captureCaretAcrossRewrite(block, putCaret(block, 5));
    const replacement = document.createElement('div');

    replacement.setAttribute('contenteditable', 'true');
    replacement.textContent = 'something else entirely';
    block.holder.replaceChild(replacement, original);
    document.getSelection()?.removeAllRanges();
    restore?.();

    expect(document.getSelection()?.rangeCount ?? 0).toBe(0);
  });

  it('refuses when the field is still on the page but no longer in this block', () => {
    const block = makeBlock('hello world');
    const elsewhere = makeBlock('somewhere else');
    const original = block.inputs[0];
    const restore = captureCaretAcrossRewrite(block, putCaret(block, 5));

    // What a tool that rebuilt its DOM leaves behind: the selection collapsed
    // onto this block's holder, so the "user moved on" guard lets it through,
    // while the captured field now lives under another block. It is still
    // connected, so `isConnected` alone would not catch it, and restoring
    // would plant the caret inside that other block.
    elsewhere.holder.appendChild(original);

    const collapsed = document.createRange();

    collapsed.setStart(block.holder, 0);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(collapsed);

    restore?.();

    expect(document.getSelection()?.focusNode).toBe(block.holder);
  });

  it('captures nothing when the caret is not in this block', () => {
    const block = makeBlock('hello world');
    const elsewhere = makeBlock('somewhere else');

    putCaret(elsewhere, 3);

    expect(captureCaretAcrossRewrite(block, document.getSelection())).toBeNull();
  });

  it('leaves the caret where the user moved it during the update', () => {
    const block = makeBlock('hello world');
    const elsewhere = makeBlock('somewhere else');
    const restore = captureCaretAcrossRewrite(block, putCaret(block, 5));

    block.inputs[0].innerHTML = 'hello brave world';
    putCaret(elsewhere, 3);
    restore?.();

    const live = document.getSelection();

    expect({ inElsewhere: elsewhere.holder.contains(live?.anchorNode ?? null),
      offset: live?.anchorOffset ?? null })
      .toEqual({ inElsewhere: true,
        offset: 3 });
  });
});
