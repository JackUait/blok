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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toDOMRectList } from '../../../helpers/dom-rect-list';
import {
  measureLine,
  measureSelection,
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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  mounted.forEach((element) => element.remove());
  mounted.length = 0;
  vi.restoreAllMocks();
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

/**
 * The other direction of the same coordinate system: a peer's anchor and head
 * back into the boxes their selection covers, so the layer can shade them.
 *
 * One rect per WRAPPED LINE, which is what `getClientRects` reports and what a
 * shade drawn as absolutely-positioned divs needs — a single bounding box over
 * a two-line selection would paint the whole rectangle, including the empty
 * gutter to the left of the second line's start.
 */
describe('measureSelection', () => {
  it('measures the region between anchor and head', () => {
    const input = makeInput('hello world');

    vi.spyOn(Range.prototype, 'getClientRects')
      .mockReturnValue(toDOMRectList([new DOMRect(10, 20, 44, 18)]));

    expect(measureSelection(input, 2, 7)).toEqual([
      { left: 10, top: 20, width: 44, height: 18 },
    ]);
  });

  it('measures nothing when anchor and head are the same offset', () => {
    const input = makeInput('hello world');
    const rects = vi.spyOn(Range.prototype, 'getClientRects')
      .mockReturnValue(toDOMRectList([new DOMRect(10, 20, 44, 18)]));

    // A collapsed caret is the line the caret layer already draws. Shading it
    // would paint a sliver of colour over every peer who is merely parked.
    expect(measureSelection(input, 4, 4)).toEqual([]);
    expect(rects).not.toHaveBeenCalled();
  });

  it('reports one rect per wrapped line', () => {
    const input = makeInput('hello world');

    vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue(toDOMRectList([
      new DOMRect(30, 20, 70, 18),
      new DOMRect(0, 38, 25, 18),
    ]));

    expect(measureSelection(input, 1, 9)).toHaveLength(2);
  });

  it('drops a rect with no area, which could not paint either way', () => {
    const input = makeInput('hello world');

    vi.spyOn(Range.prototype, 'getClientRects').mockReturnValue(toDOMRectList([
      new DOMRect(30, 20, 70, 18),
      new DOMRect(0, 38, 0, 18),
    ]));

    // Chromium reports zero-width rects for two different things in one list:
    // the line-end artifact at a soft break, and the EMPTY line of a selection
    // that runs over a blank one. Width alone cannot tell them apart, and this
    // drops both. That costs no shading either way — a zero-width box paints
    // nothing — so what it buys is not pooling a div nobody can ever see.
    // Showing a sliver on a blank line would mean inventing a width, which is a
    // different feature from measuring one.
    expect(measureSelection(input, 1, 9)).toEqual([
      { left: 30, top: 20, width: 70, height: 18 },
    ]);
  });

  it('measures the same region when the selection runs backwards', () => {
    const input = makeInput('hello world');
    const covered: string[] = [];

    vi.spyOn(Range.prototype, 'getClientRects')
      .mockImplementation(function measured(this: Range): DOMRectList {
        covered.push(this.toString());

        return toDOMRectList([new DOMRect(10, 20, 44, 18)]);
      });

    const forwards = measureSelection(input, 2, 7);
    const backwards = measureSelection(input, 7, 2);

    // `head` is the end the peer is moving, so it is routinely BEFORE the
    // anchor. A Range built in publication order would collapse to nothing.
    expect(backwards).toEqual(forwards);
    expect(covered).toEqual(['llo w', 'llo w']);
  });

  it('clamps both ends against the text that is actually here', () => {
    const input = makeInput('hi');
    const covered: string[] = [];

    vi.spyOn(Range.prototype, 'getClientRects')
      .mockImplementation(function measured(this: Range): DOMRectList {
        covered.push(this.toString());

        return toDOMRectList([new DOMRect(0, 0, 12, 18)]);
      });

    measureSelection(input, -5, 99);

    // Both offsets arrived from another browser and the local text may have
    // shrunk since; an unclamped end throws IndexSizeError and takes the whole
    // drawing pass down with it.
    expect(covered).toEqual(['hi']);
  });

  it('measures nothing inside an empty input, where there is no text to cover', () => {
    const input = makeInput('');

    expect(measureSelection(input, 0, 4)).toEqual([]);
  });
});

/**
 * The line a peer's caret sits on.
 *
 * A collapsed Range is the obvious thing to measure and the one thing Chromium
 * will not always measure, so this pins what happens when it reports nothing.
 */
describe('measureLine', () => {
  /**
   * Answer `rects` for the one Range covering `text`, and nothing for any
   * other — which is how Chromium answers a collapsed Range it cannot place.
   * @param text - the probe range's contents
   * @param rects - the boxes reported for it
   */
  const onlyMeasure = (text: string, rects: DOMRect[]): void => {
    vi.spyOn(Range.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 0, 0));
    vi.spyOn(Range.prototype, 'getClientRects')
      .mockImplementation(function measured(this: Range): DOMRectList {
        return toDOMRectList(this.toString() === text ? rects : []);
      });
  };

  it('measures the next character when the caret itself measures nothing', () => {
    const input = makeInput('aaaa bbbb cccc dddd <b>eeee</b> ffff');

    vi.spyOn(input, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 3, 220, 72));
    onlyMeasure('e', [new DOMRect(0, 27, 9.61, 18)]);

    // Chromium reports an EMPTY rect list for a collapsed Range at a soft wrap
    // whose next text lives in another inline element. Falling back to the
    // input's box here draws the caret at the top-left of the WHOLE paragraph,
    // 72px tall, instead of on the line the offset names.
    expect(measureLine(input, 20)).toEqual({
      left: 0,
      top: 27,
      height: 18,
    });
  });

  it('takes the last rect, when the next character straddles the wrap', () => {
    const input = makeInput('aaaa bbbb cccc dddd <b>eeee</b> ffff');

    vi.spyOn(input, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 3, 220, 72));
    onlyMeasure('e', [new DOMRect(192, 3, 0, 18), new DOMRect(0, 27, 10, 18)]);

    // WebKit reports the zero-width line-end artifact FIRST and the
    // character's real box second. The first rect is the line the caret just
    // left.
    expect(measureLine(input, 20)).toEqual({
      left: 0,
      top: 27,
      height: 18,
    });
  });

  it('falls back to the input box for an empty input, which has no next character', () => {
    const input = makeInput('');

    vi.spyOn(input, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 72, 220, 24));
    onlyMeasure('e', [new DOMRect(0, 27, 9.61, 18)]);

    // An empty paragraph is the ordinary case the fallback exists for, and
    // nothing about probing forward may take it away.
    expect(measureLine(input, 0)).toEqual({
      left: 0,
      top: 72,
      height: 24,
    });
  });

  it('falls back to the input box at the very end of the text', () => {
    const input = makeInput('hi');

    vi.spyOn(input, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 72, 220, 24));
    onlyMeasure('e', [new DOMRect(0, 27, 9.61, 18)]);

    // There is no character after the last one, so the probe range collapses
    // and must not be measured — a collapsed probe reports the same nothing.
    expect(measureLine(input, 2)).toEqual({
      left: 0,
      top: 72,
      height: 24,
    });
  });

  it('measures the caret itself whenever the caret measures', () => {
    const input = makeInput('hello world');
    const rects = vi.spyOn(Range.prototype, 'getClientRects')
      .mockReturnValue(toDOMRectList([new DOMRect(0, 27, 9.61, 18)]));

    vi.spyOn(Range.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(30, 3, 0, 18));

    expect(measureLine(input, 2)).toEqual({
      left: 30,
      top: 3,
      height: 18,
    });
    // Carets reposition on every keystroke of every peer, so the extra Range
    // is built only where the cheap measurement came back empty.
    expect(rects).not.toHaveBeenCalled();
  });
});
