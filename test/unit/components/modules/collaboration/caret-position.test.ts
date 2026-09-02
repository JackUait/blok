/**
 * The presence caret coordinate system.
 *
 * A published caret is `{blockId, inputIndex, anchor, head}` — plain character
 * offsets into ONE of a block's editable inputs. This file pins both directions
 * of that coordinate system, because they have to agree exactly: the publisher
 * reads a live selection into offsets, and every peer's renderer reads those
 * offsets back into a Range to measure. A disagreement between the two draws
 * every remote caret in the wrong place, with nothing failing loudly.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  readCaret,
  readCaretPosition,
  resolveCaretRange,
} from '../../../../../src/components/modules/collaboration/caret-position';

const mounted: HTMLElement[] = [];

/**
 * A contenteditable input holding `html`, mounted so a live Selection can
 * address it — jsdom refuses to select inside a detached tree.
 * @param html - the input's markup
 */
const makeInput = (html: string): HTMLElement => {
  const input = document.createElement('div');

  input.contentEditable = 'true';
  input.innerHTML = html;
  document.body.appendChild(input);
  mounted.push(input);

  return input;
};

/**
 * Point the live selection at a node pair.
 * @param anchorNode - where the selection started
 * @param anchorOffset - offset inside the anchor node
 * @param focusNode - where the caret is
 * @param focusOffset - offset inside the focus node
 */
const select = (anchorNode: Node, anchorOffset: number, focusNode: Node, focusOffset: number): Selection => {
  const selection = window.getSelection();

  if (selection === null) {
    throw new Error('jsdom provided no Selection');
  }

  selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);

  return selection;
};

/** The first text node under `root`, which is what a Selection has to address. */
const textNodeOf = (root: Node): Text => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();

  if (node === null) {
    throw new Error('no text node');
  }

  return node as Text;
};

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  mounted.forEach((element) => element.remove());
  mounted.length = 0;
});

describe('readCaretPosition', () => {
  it('reads a collapsed caret as equal anchor and head offsets', () => {
    const input = makeInput('hello');
    const text = textNodeOf(input);

    const position = readCaretPosition('block-1', [input], select(text, 3, text, 3));

    expect(position).toEqual({
      blockId: 'block-1',
      inputIndex: 0,
      anchor: 3,
      head: 3,
    });
  });

  it('names which of the block inputs the caret is in', () => {
    const first = makeInput('one');
    const second = makeInput('two');
    const text = textNodeOf(second);

    const position = readCaretPosition('block-1', [first, second], select(text, 2, text, 2));

    expect(position).toMatchObject({ inputIndex: 1, head: 2 });
  });

  it('counts offsets across inline markup, not inside one text node', () => {
    const input = makeInput('<b>bold</b> tail');
    const tail = input.lastChild as Text;

    // 4 characters of bold, then 3 into " tail".
    const position = readCaretPosition('block-1', [input], select(tail, 3, tail, 3));

    expect(position).toMatchObject({ anchor: 7, head: 7 });
  });

  it('keeps a backwards selection backwards, so head is where the caret is', () => {
    const input = makeInput('hello world');
    const text = textNodeOf(input);

    const position = readCaretPosition('block-1', [input], select(text, 9, text, 2));

    expect(position).toMatchObject({ anchor: 9, head: 2 });
  });

  it('publishes nothing when there is no selection', () => {
    const input = makeInput('hello');

    expect(readCaretPosition('block-1', [input], null)).toBeNull();
  });

  it('publishes nothing when the caret is outside every input of the block', () => {
    const input = makeInput('hello');
    const elsewhere = makeInput('other block');
    const text = textNodeOf(elsewhere);

    expect(readCaretPosition('block-1', [input], select(text, 2, text, 2))).toBeNull();
  });

  it('skips a native input, whose caret offsets cannot be drawn', () => {
    const field = document.createElement('input');

    field.value = 'hello';
    document.body.appendChild(field);
    mounted.push(field);

    // Addressing the field itself is the one way a Selection can land "on" a
    // native input — its text has no nodes to point at. Nothing may be
    // published for it: a peer cannot measure a position inside one.
    expect(readCaretPosition('block-1', [field], select(field, 0, field, 0))).toBeNull();
  });

  it('keeps looking past a native input to the one the caret is really in', () => {
    const field = document.createElement('input');
    const editable = makeInput('hello');
    const text = textNodeOf(editable);

    document.body.appendChild(field);
    mounted.push(field);

    const position = readCaretPosition('block-1', [field, editable], select(text, 2, text, 2));

    expect(position).toMatchObject({ inputIndex: 1, head: 2 });
  });

  it('collapses a selection that started in another input onto the caret', () => {
    const first = makeInput('one');
    const second = makeInput('two');
    const anchor = textNodeOf(first);
    const head = textNodeOf(second);

    const position = readCaretPosition('block-1', [first, second], select(anchor, 1, head, 2));

    // The anchor is unrepresentable in the head's coordinate system, so it
    // collapses rather than pointing at a character it does not name.
    expect(position).toEqual({
      blockId: 'block-1',
      inputIndex: 1,
      anchor: 2,
      head: 2,
    });
  });
});

describe('resolveCaretRange', () => {
  it('resolves offset zero to the start of the input', () => {
    const input = makeInput('hello');
    const range = resolveCaretRange(input, 0);

    expect(range?.collapsed).toBe(true);
    expect(range?.startContainer).toBe(textNodeOf(input));
    expect(range?.startOffset).toBe(0);
  });

  it('resolves an offset that falls past inline markup', () => {
    const input = makeInput('<b>bold</b> tail');
    const range = resolveCaretRange(input, 7);

    expect(range?.startContainer).toBe(input.lastChild);
    expect(range?.startOffset).toBe(3);
  });

  it('clamps an offset longer than the text to the end', () => {
    const input = makeInput('hi');
    const range = resolveCaretRange(input, 99);

    expect(range?.startContainer).toBe(textNodeOf(input));
    expect(range?.startOffset).toBe(2);
  });

  it('clamps a negative offset to the start', () => {
    const input = makeInput('hi');
    const range = resolveCaretRange(input, -5);

    expect(range?.startOffset).toBe(0);
  });

  it('resolves inside an empty input, where there is no text node to address', () => {
    const input = makeInput('');
    const range = resolveCaretRange(input, 0);

    expect(range?.collapsed).toBe(true);
    expect(range?.startContainer).toBe(input);
  });

  it('round-trips every offset of a marked-up input back to what was read', () => {
    const input = makeInput('<b>ab</b>cd<i>ef</i>');

    // The two directions have to agree at every boundary, not just at zero and
    // the end — an off-by-one anywhere in the middle misdraws silently.
    for (let offset = 0; offset <= 6; offset += 1) {
      const range = resolveCaretRange(input, offset);

      if (range === null) {
        throw new Error(`offset ${offset} did not resolve`);
      }

      const read = readCaretPosition(
        'block-1',
        [input],
        select(range.startContainer, range.startOffset, range.startContainer, range.startOffset)
      );

      expect(read?.head).toBe(offset);
    }
  });
});

describe('readCaret', () => {
  const valid = {
    blockId: 'block-1',
    inputIndex: 0,
    anchor: 2,
    head: 4,
  };

  it('accepts a well-formed position', () => {
    expect(readCaret(valid)).toEqual(valid);
  });

  it('drops fields the sender invented', () => {
    // Only the four known fields reach the renderer, so a peer cannot smuggle
    // anything past the drawing pass by hanging it off the caret.
    expect(readCaret({ ...valid, onerror: 'boom' })).toEqual(valid);
  });

  it.each([
    ['not an object', 'block-1'],
    ['null', null],
    ['no block id', { ...valid, blockId: undefined }],
    ['an empty block id', { ...valid, blockId: '' }],
    ['a non-string block id', { ...valid, blockId: 42 }],
    ['a negative input index', { ...valid, inputIndex: -1 }],
    ['a fractional input index', { ...valid, inputIndex: 1.5 }],
    ['a negative offset', { ...valid, head: -3 }],
    ['a fractional offset', { ...valid, anchor: 2.5 }],
    ['a string offset', { ...valid, head: '4' }],
    ['an infinite offset', { ...valid, head: Number.POSITIVE_INFINITY }],
    ['a NaN offset', { ...valid, head: Number.NaN }],
  ])('rejects %s', (_label, value) => {
    // Every field arrived from another browser. A malformed one is dropped
    // whole rather than repaired: a half-trusted position draws in the wrong
    // place, which is worse than not drawing.
    expect(readCaret(value)).toBeNull();
  });
});
