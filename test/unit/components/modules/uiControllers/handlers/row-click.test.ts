import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import { placeCaretBesideRow } from '../../../../../../src/components/modules/uiControllers/handlers/row-click';

/**
 * Notion U179 (RM2 item 4): a click in the editor beside a block's row puts
 * the caret at the end of that row's line.
 */
describe('placeCaretBesideRow', () => {
  let redactor: HTMLElement;
  let holder: HTMLElement;
  let content: HTMLElement;
  let input: HTMLElement;
  let setToInput: ReturnType<typeof vi.fn>;
  let anyBlockSelected: boolean;
  let readOnly: boolean;

  const blok = (): BlokModules => ({
    BlockManager: {
      getBlockByChildNode: (node: Node) => (holder.contains(node) ? { id: 'b1', holder, inputs: [input] } : undefined),
      blocks: [{ id: 'b1', holder, inputs: [input], parentId: null }],
    },
    BlockSelection: {
      get anyBlockSelected() {
        return anyBlockSelected;
      },
    },
    ReadOnly: {
      get isEnabled() {
        return readOnly;
      },
    },
    Caret: { setToInput, positions: { END: 'end' } },
  } as unknown as BlokModules);

  const click = (target: Element, init: MouseEventInit = {}): MouseEvent => {
    const event = new MouseEvent('click', { bubbles: true, button: 0, clientX: 900, clientY: 10, ...init });

    Object.defineProperty(event, 'target', { value: target });

    return event;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    anyBlockSelected = false;
    readOnly = false;
    setToInput = vi.fn();
    redactor = document.createElement('div');
    holder = document.createElement('div');
    holder.setAttribute('data-blok-id', 'b1');
    content = document.createElement('div');
    content.setAttribute('data-blok-element-content', '');
    input = document.createElement('div');
    input.contentEditable = 'true';
    input.textContent = 'Alp xha';
    content.appendChild(input);
    holder.appendChild(content);
    redactor.appendChild(holder);
    document.body.appendChild(redactor);
  });

  afterEach(() => {
    redactor.remove();
    vi.restoreAllMocks();
  });

  it('puts the caret at the line end of the block whose holder was clicked beside its content', () => {
    expect(placeCaretBesideRow(blok(), redactor, click(holder))).toBe(true);
    expect(setToInput).toHaveBeenCalledWith(input, 'end');
  });

  it('leaves a click inside the block content to the browser', () => {
    expect(placeCaretBesideRow(blok(), redactor, click(input))).toBe(false);
    expect(setToInput).not.toHaveBeenCalled();
  });

  it('leaves a click outside the editor alone', () => {
    const outside = document.createElement('div');

    document.body.appendChild(outside);
    expect(placeCaretBesideRow(blok(), redactor, click(outside))).toBe(false);
    expect(setToInput).not.toHaveBeenCalled();
    outside.remove();
  });

  it.each([
    ['a Shift-click', { shiftKey: true }],
    ['a right click', { button: 2 }],
  ])('leaves %s alone', (_name, init) => {
    expect(placeCaretBesideRow(blok(), redactor, click(holder, init))).toBe(false);
    expect(setToInput).not.toHaveBeenCalled();
  });

  it('keeps a block selection a drag just made', () => {
    anyBlockSelected = true;
    expect(placeCaretBesideRow(blok(), redactor, click(holder))).toBe(false);
    expect(setToInput).not.toHaveBeenCalled();
  });

  it('places nothing in read-only mode', () => {
    readOnly = true;
    expect(placeCaretBesideRow(blok(), redactor, click(holder))).toBe(false);
    expect(setToInput).not.toHaveBeenCalled();
  });
});
