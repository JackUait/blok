import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  applyMark,
  hasMark,
  markSanitizerConfig,
  readMark,
  removeMark,
  toggleMarkAtCaret,
} from '../../../../src/components/marks/mark-engine';
import type { MarkSpec } from '../../../../types/api/marks';
import type { TagConfig } from '../../../../types/configs/sanitizer-config';

const ZWSP = '\u200B';

/** Marker's text-colour mode: one family, one function-form property. */
const colorSpec: MarkSpec<string> = {
  tag: 'mark',
  style: { color: (value: string): string => value },
};

/** A span-family mark identified by tag alone, so foreign spans are family too. */
const spanBgSpec: MarkSpec<string> = {
  tag: 'span',
  style: { 'background-color': (value: string): string => value },
};

/** Class-identified family, so a bare span is NOT one of us. */
const hlBgSpec: MarkSpec<string> = {
  tag: 'span',
  className: 'hl',
  style: { 'background-color': (value: string): string => value },
};

/** Same, but colour-valued — used for the nested-family sweep. */
const hlColorSpec: MarkSpec<string> = {
  tag: 'span',
  className: 'hl',
  style: { color: (value: string): string => value },
};

/** Every declared value static: the branch that must NOT be called as a function. */
const staticSpec: MarkSpec = {
  tag: 'span',
  style: { 'font-weight': 'bold' },
  attributes: { 'data-kind': 'note' },
};

const attributeOnlySpec: MarkSpec = {
  tag: 'span',
  attributes: { 'data-kind': 'note' },
};

const dynamicAttributeSpec: MarkSpec<string> = {
  tag: 'span',
  attributes: { 'data-id': (value: string): string => value },
};

/** Marker's real shape: a dynamic colour plus a transparent UA-override filler. */
const fillerSpec: MarkSpec<string> = {
  tag: 'mark',
  style: {
    color: (value: string): string => value,
    'background-color': 'transparent',
  },
  attributes: { 'data-id': (value: string): string => value },
};

/*
 * Mutants this file deliberately leaves alive, with the reason each one cannot
 * change behaviour through the engine's own call sites:
 *
 * L161 `value !== null`      readMark reads only attributes the spec declares, and
 *                            matchesMarkFamily already required every one of them to
 *                            be present, so getAttribute never returns null here.
 * L236 `|| name === 'class'` dead operand: both isBareWrapper call sites run
 *                            stripSpecFrom first, which drops the class attribute
 *                            whenever classList is empty — and a non-empty classList
 *                            returns at L224 before this line.
 * L247 / L441 `if (!parent)` the unwrapped/split element always comes from the live
 *                            tree or from inside the freshly built wrapper.
 * L268 `start !== null`      `start === end` alone differs only when start is null,
 *                            and the ternary then yields start — the same null.
 * L353 `<` / L354 `>`        differ only when the comparison is exactly 0, i.e. the
 *                            range boundary IS the wrapper content boundary; the split
 *                            call that then runs extracts an empty range and re-pins
 *                            the offset the extraction already left.
 * L356 (four)                the `continue` is a pure short-circuit: it fires only when
 *                            startsBefore && endsAfter, and both following guards are
 *                            false in exactly that state. `!wrapper.parentNode` is dead.
 * L385/L386, L401/L402       the pins restore what the extraction already produced: the
 *                            pinned node IS the extraction range's own boundary
 *                            container, so extractContents truncates it to exactly that
 *                            offset (trailing) or clamps the live offset to 0 (leading).
 * L550 / L609 `?? ''`        Element.textContent is never null.
 * L578 `?.`                  Text.textContent is never null.
 * L612 `startIdx === -1`     unreachable: survivingParent is an ancestor of the whole
 *                            range and the removal surgery never deletes or reorders
 *                            text, so range.toString() is always a substring of it.
 * L618 `startNode && endNode` both are always found — the indices came from the very
 *                            subtree the walker then re-walks.
 * L648 ternary `true`        differs only when the common ancestor is a Text node with
 *                            no family ancestor; nothing is unwrapped then, the captured
 *                            anchors stay valid and survivingParent is never read.
 * L719 `catch {}`            falling out of the function returns undefined, falsy just
 *                            like the `false` it replaced.
 * L766 `first`/`last`        reselectAcrossHosts only runs with slices.length > 1.
 * L775 `catch {}`            unkilled rather than proven: both setStart/setEnd take live
 *                            slice ranges the DOM keeps valid, so neither throws.
 * L865 `caret.setEnd`        setStart on a fresh collapsed range already moves the end
 *                            to the same point.
 */
describe('mark-engine mutants', () => {
  const mounted: HTMLElement[] = [];

  const mount = (html: string, editable = true): HTMLElement => {
    const element = document.createElement('div');

    if (editable) {
      element.contentEditable = 'true';
    }
    element.innerHTML = html;
    document.body.appendChild(element);
    mounted.push(element);

    return element;
  };

  /**
   * A selection the engine did not create. Every assertion that the engine
   * left the selection alone needs one, and every assertion that it moved the
   * selection needs a value it could not have produced by accident.
   */
  const selectSentinel = (): void => {
    const sentinel = mount('sentinel', false);
    const range = document.createRange();

    range.selectNodeContents(sentinel);
    liveSelection().removeAllRanges();
    liveSelection().addRange(range);
  };

  const liveSelection = (): Selection => {
    const selection = window.getSelection();

    if (selection === null) {
      throw new Error('jsdom returned no selection');
    }

    return selection;
  };

  const elementIn = (root: ParentNode, selector: string): HTMLElement => {
    const found = root.querySelector(selector);

    if (!(found instanceof HTMLElement)) {
      throw new Error(`fixture is missing ${selector}`);
    }

    return found;
  };

  const firstText = (node: Node): Text => {
    const child = node.firstChild;

    if (!(child instanceof Text)) {
      throw new Error('fixture is missing a leading text node');
    }

    return child;
  };

  const rangeBetween = (startNode: Node, startOffset: number, endNode: Node, endOffset: number): Range => {
    const range = document.createRange();

    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);

    return range;
  };

  const contentsRange = (node: Node): Range => {
    const range = document.createRange();

    range.selectNodeContents(node);

    return range;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    while (mounted.length > 0) {
      mounted.pop()?.remove();
    }
    vi.restoreAllMocks();
  });

  describe('spec reading', () => {
    it('emits one sanitizer rule per declared tag and invents none', () => {
      expect(Object.keys(markSanitizerConfig(colorSpec))).toStrictEqual(['mark']);
    });

    it('writes static style and attribute values verbatim instead of calling them', () => {
      const host = mount('word');

      applyMark(staticSpec, undefined, contentsRange(host));

      expect(host.innerHTML).toBe('<span data-kind="note" style="font-weight: bold;">word</span>');
    });

    it('removes declared attributes and unwraps the wrapper left bare', () => {
      const host = mount('<span data-kind="note">word</span>');
      const survivors = removeMark(attributeOnlySpec, contentsRange(elementIn(host, 'span')));

      expect(host.innerHTML).toBe('word');
      expect(survivors).toStrictEqual([]);
    });

    it('reads declared properties, skipping transparent fillers', () => {
      const host = mount('<mark data-id="x1" style="color: red; background-color: transparent">read</mark>');
      const text = firstText(elementIn(host, 'mark'));
      const snapshot = readMark(fillerSpec, rangeBetween(text, 0, text, 4));

      expect(snapshot?.element).toBe(elementIn(host, 'mark'));
      expect(snapshot?.style).toStrictEqual({ color: 'red' });
      expect(snapshot?.attributes).toStrictEqual({ 'data-id': 'x1' });
    });
  });

  describe('stripping a spec off a wrapper', () => {
    it('drops the class attribute once the last declared class is gone', () => {
      const host = mount('<span class="hl" style="color: red; background-color: yellow">text</span>');
      const survivors = removeMark(hlBgSpec, contentsRange(elementIn(host, 'span')));

      expect(host.innerHTML).toBe('<span style="color: red;">text</span>');
      expect(survivors).toStrictEqual([elementIn(host, 'span')]);
    });

    it('keeps the class attribute while undeclared classes remain', () => {
      const host = mount('<span class="hl extra" style="background-color: yellow">text</span>');

      removeMark(hlBgSpec, contentsRange(elementIn(host, 'span')));

      expect(host.innerHTML).toBe('<span class="extra">text</span>');
    });

    it('drops the style attribute once the last declared property is gone', () => {
      const host = mount('<span class="keep" style="background-color: yellow">text</span>');
      const survivors = removeMark(spanBgSpec, contentsRange(elementIn(host, 'span')));

      expect(host.innerHTML).toBe('<span class="keep">text</span>');
      expect(survivors).toStrictEqual([elementIn(host, 'span')]);
    });

    it('treats a foreign attribute as identity, so the wrapper is not bare', () => {
      const host = mount('<span data-keep="1" style="background-color: yellow">text</span>');

      removeMark(spanBgSpec, contentsRange(elementIn(host, 'span')));

      expect(host.innerHTML).toBe('<span data-keep="1">text</span>');
    });
  });

  describe('choosing between an in-place update and a split', () => {
    it('updates a fully covered wrapper in place, returning that very element', () => {
      const host = mount('<mark style="color: red">tinted</mark>');
      const mark = elementIn(host, 'mark');

      selectSentinel();

      const applied = applyMark(colorSpec, 'blue', contentsRange(mark));

      expect(applied).toHaveLength(1);
      expect(applied[0]).toBe(mark);
      expect(host.innerHTML).toBe('<mark style="color: blue;">tinted</mark>');
      /* The in-place branch never touches the selection. */
      expect(liveSelection().toString()).toBe('sentinel');
    });

    it('splits when the range starts inside the wrapper but reaches its end', () => {
      const host = mount('<mark style="color: red">abcdef</mark>');
      const text = firstText(elementIn(host, 'mark'));

      selectSentinel();
      applyMark(colorSpec, 'blue', rangeBetween(text, 2, text, 6));

      expect(host.innerHTML).toBe('<mark style="color: red">ab</mark><mark style="color: blue;">cdef</mark>');
      /* The split branch selects the restyled middle segment. */
      expect(liveSelection().toString()).toBe('cdef');
    });

    it('splits when the range starts at the wrapper start but stops short of its end', () => {
      const host = mount('<mark style="color: red">abcdef</mark>');
      const text = firstText(elementIn(host, 'mark'));

      applyMark(colorSpec, 'blue', rangeBetween(text, 0, text, 4));

      expect(host.innerHTML).toBe('<mark style="color: blue;">abcd</mark><mark style="color: red">ef</mark>');
    });

    it('splits when the range ends ON the wrapper but starts inside it', () => {
      const host = mount('<mark style="color: red">abcdef</mark>');
      const mark = elementIn(host, 'mark');
      const applied = applyMark(colorSpec, 'blue', rangeBetween(firstText(mark), 2, mark, 1));

      /* Element-anchored, so the END boundary compares EQUAL to the wrapper end. */
      expect(host.innerHTML).toBe('<mark style="color: red">ab</mark><mark style="color: blue;">cdef</mark>');
      expect(applied[0]).not.toBe(mark);
    });

    it('splits when the range starts ON the wrapper but stops inside it', () => {
      const host = mount('<mark style="color: red">abcdef</mark>');
      const mark = elementIn(host, 'mark');
      const applied = applyMark(colorSpec, 'blue', rangeBetween(mark, 0, firstText(mark), 4));

      /* Element-anchored, so the START boundary compares EQUAL to the wrapper start. */
      expect(host.innerHTML).toBe('<mark style="color: blue;">abcd</mark><mark style="color: red">ef</mark>');
      expect(applied[0]).not.toBe(mark);
    });

    it('splits a wrapper into before, restyled and after when both boundaries sit inside it', () => {
      const host = mount('<mark style="color: red">ab<b>cd</b>ef</mark>');

      applyMark(colorSpec, 'blue', rangeBetween(firstText(elementIn(host, 'mark')), 1, firstText(elementIn(host, 'b')), 0));

      expect(host.innerHTML).toBe(
        '<mark style="color: red">a</mark><mark style="color: blue;">b<b></b></mark>' +
        '<mark style="color: red"><b>cd</b>ef</mark>'
      );
    });

    it('does not treat two different family wrappers as one containing wrapper', () => {
      const host = mount('<mark style="color: red">ab</mark><mark style="color: green">cd</mark>');
      const marks = host.querySelectorAll('mark');

      applyMark(colorSpec, 'blue', rangeBetween(firstText(marks[0]), 1, firstText(marks[1]), 1));

      expect(host.innerHTML).toBe(
        '<mark style="color: red">a</mark><mark style="color: blue;">bc</mark><mark style="color: green">d</mark>'
      );
    });

    it('returns an empty result and changes nothing for a collapsed range', () => {
      const host = mount('plain');
      const text = firstText(host);
      const applied = applyMark(colorSpec, 'red', rangeBetween(text, 2, text, 2));

      expect(applied).toStrictEqual([]);
      expect(host.innerHTML).toBe('plain');
    });

    it('leaves nested elements outside the family untouched', () => {
      const host = mount('plain <span style="color: green">x</span> tail');

      applyMark(hlColorSpec, 'blue', contentsRange(host));

      expect(host.innerHTML).toBe(
        '<span class="hl" style="color: blue;">plain <span style="color: green">x</span> tail</span>'
      );
    });
  });

  describe('splitting family wrappers at the range boundaries', () => {
    it('does not widen a range that already starts before the wrapper', () => {
      const host = mount('pre<mark style="color: red">mid</mark>post');

      applyMark(colorSpec, 'blue', rangeBetween(firstText(host), 1, firstText(elementIn(host, 'mark')), 2));

      expect(host.innerHTML).toBe(
        'p<mark style="color: blue;">remi</mark><mark style="color: red">d</mark>post'
      );
    });

    it('splits off the tail when the range start is anchored on the wrapper itself', () => {
      const host = mount('<mark style="color: red">abcdef</mark>');
      const mark = elementIn(host, 'mark');

      selectSentinel();

      const survivors = removeMark(colorSpec, rangeBetween(mark, 0, firstText(mark), 4));

      expect(host.innerHTML).toBe('abcd<mark style="color: red">ef</mark>');
      expect(survivors).toStrictEqual([]);
      expect(liveSelection().toString()).toBe('abcd');
    });

    it('splits the outer wrapper when the two boundaries sit in nested family wrappers', () => {
      const host = mount('<mark style="color: red">a<mark style="color: green">bc</mark>d</mark>');
      const outer = elementIn(host, 'mark');
      const inner = elementIn(host, 'mark mark');

      applyMark(colorSpec, 'blue', rangeBetween(firstText(outer), 0, firstText(inner), 1));

      /* Without the boundary split the new wrapper lands INSIDE the surviving outer one. */
      expect(host.innerHTML).toBe(
        '<mark style="color: red"><mark style="color: blue;">ab</mark></mark>' +
        '<mark style="color: red"><mark style="color: green">c</mark>d</mark>'
      );
    });

    it('keeps a range end that is anchored on the wrapper rather than on a text node', () => {
      const host = mount('pre<mark style="color: red">a<b>bc</b></mark>');

      applyMark(colorSpec, 'blue', rangeBetween(firstText(host), 1, elementIn(host, 'mark'), 1));

      expect(host.innerHTML).toBe(
        'p<mark style="color: blue;">rea</mark><mark style="color: red"><b>bc</b></mark>'
      );
    });

    it('splits off the wrapper tail when the range ends at the start of a nested text node', () => {
      const host = mount('pre<mark style="color: red">ab<b>cd</b></mark>');

      applyMark(colorSpec, 'blue', rangeBetween(firstText(host), 1, firstText(elementIn(host, 'b')), 0));

      expect(host.innerHTML).toBe(
        'p<mark style="color: blue;">reab<b></b></mark><mark style="color: red"><b>cd</b></mark>'
      );
    });
  });

  describe('a document with no selection', () => {
    it('applies a mark without one', () => {
      const host = mount('plain');
      const range = contentsRange(host);

      vi.spyOn(window, 'getSelection').mockReturnValue(null);
      applyMark(colorSpec, 'red', range);

      expect(host.innerHTML).toBe('<mark style="color: red;">plain</mark>');
    });

    it('removes a mark without one', () => {
      const host = mount('<mark style="color: red">tinted</mark>');
      const range = contentsRange(elementIn(host, 'mark'));

      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      const survivors = removeMark(colorSpec, range);

      expect(host.innerHTML).toBe('tinted');
      expect(survivors).toStrictEqual([]);
    });

    it('toggles a pending format at the caret without one', () => {
      const host = mount('hello');
      const text = firstText(host);

      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(toggleMarkAtCaret(colorSpec, 'red', rangeBetween(text, 2, text, 2))).toBe(true);
      expect(host.innerHTML).toBe(`he<mark style="color: red;">${ZWSP}</mark>llo`);
    });

    it('toggles a pending format OFF at the caret without one', () => {
      const host = mount('<mark style="color: red">hello</mark>');
      const text = firstText(elementIn(host, 'mark'));

      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(toggleMarkAtCaret(colorSpec, 'red', rangeBetween(text, 2, text, 2))).toBe(false);
      expect(host.innerHTML).toBe(
        `<mark style="color: red">he</mark>${ZWSP}<mark style="color: red">llo</mark>`
      );
    });

    it('applies across editing hosts without one', () => {
      const wrap = mount('<div contenteditable="true">abc</div>GAP<div contenteditable="true">def</div>', false);
      const hosts = wrap.querySelectorAll('div');
      const range = rangeBetween(firstText(hosts[0]), 1, firstText(hosts[1]), 2);

      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(applyMark(colorSpec, 'blue', range)).toHaveLength(2);
      expect(wrap.innerHTML).toBe(
        '<div contenteditable="true">a<mark style="color: blue;">bc</mark></div>' +
        'GAP<div contenteditable="true"><mark style="color: blue;">de</mark>f</div>'
      );
    });
  });

  describe('restoring the selection after a removal', () => {
    it('prefers the captured anchors over a text search that would find an earlier copy', () => {
      const host = mount('ab<mark style="color: red">ab</mark>');
      const text = firstText(elementIn(host, 'mark'));

      selectSentinel();
      removeMark(colorSpec, rangeBetween(text, 0, text, 2));

      expect(host.innerHTML).toBe('abab');
      expect(liveSelection().toString()).toBe('ab');
      expect(liveSelection().anchorNode).toBe(text);
      expect(liveSelection().anchorOffset).toBe(0);
    });

    it('falls back to the text search when one anchor was detached by the surgery', () => {
      const host = mount('<mark style="color: red">abc</mark>');
      const mark = elementIn(host, 'mark');

      selectSentinel();
      removeMark(colorSpec, rangeBetween(mark, 0, firstText(mark), 2));

      expect(host.innerHTML).toBe('ab<mark style="color: red">c</mark>');
      expect(liveSelection().toString()).toBe('ab');
    });

    it('falls back to the text search when the split invalidated the captured offsets', () => {
      const host = mount('<mark style="color: red">abcdef</mark>');
      const text = firstText(elementIn(host, 'mark'));

      selectSentinel();
      removeMark(colorSpec, rangeBetween(text, 2, text, 4));

      expect(host.innerHTML).toBe(
        '<mark style="color: red">ab</mark>cd<mark style="color: red">ef</mark>'
      );
      expect(liveSelection().toString()).toBe('cd');
    });

    it('locates selected text that spans several text nodes of the surviving parent', () => {
      const host = mount('x<mark style="color: red">ab</mark>Y<mark style="color: red">cd</mark>');
      const marks = host.querySelectorAll('mark');

      selectSentinel();
      removeMark(colorSpec, rangeBetween(marks[0], 0, marks[1], 1));

      expect(host.innerHTML).toBe('xabYcd');

      const selection = liveSelection();

      expect(selection.toString()).toBe('abYcd');
      expect(selection.anchorNode?.textContent).toBe('ab');
      expect(selection.anchorOffset).toBe(0);
      expect(selection.focusNode?.textContent).toBe('cd');
      expect(selection.focusOffset).toBe(2);
    });

    it('leaves the selection alone when the removed range carried no characters', () => {
      const host = mount('abc');
      const mark = document.createElement('mark');

      mark.style.setProperty('color', 'red');
      mark.appendChild(document.createTextNode(''));
      host.appendChild(mark);

      selectSentinel();
      removeMark(colorSpec, rangeBetween(mark, 0, mark, 1));

      expect(host.innerHTML).toBe('abc');
      expect(liveSelection().toString()).toBe('sentinel');
    });

    it('searches the element the range sits in, not that element parent', () => {
      const wrap = mount('<div>abYcd</div><div contenteditable="true">x<mark style="color: red">ab</mark>Y<mark style="color: red">cd</mark></div>', false);
      const host = elementIn(wrap, 'div[contenteditable]');
      const marks = host.querySelectorAll('mark');

      selectSentinel();
      removeMark(colorSpec, rangeBetween(marks[0], 0, marks[1], 1));

      expect(host.innerHTML).toBe('xabYcd');
      expect(liveSelection().toString()).toBe('abYcd');
      /* The decoy copy sitting before the host must not win the search. */
      expect(liveSelection().anchorNode?.parentElement).toBe(host);
    });
  });

  describe('ranges spanning two editing hosts', () => {
    const markedPair = (): HTMLElement => {
      return mount(
        '<div contenteditable="true"><mark style="color: red">abc</mark></div>' +
        'GAP<div contenteditable="true"><mark style="color: red">def</mark></div>',
        false
      );
    };

    it('reports the mark when every host share carries it, ignoring the gap between hosts', () => {
      const wrap = markedPair();
      const marks = wrap.querySelectorAll('mark');

      expect(hasMark(colorSpec, rangeBetween(firstText(marks[0]), 0, firstText(marks[1]), 3))).toBe(true);
    });

    it('reports no mark when one host share is bare', () => {
      const wrap = mount(
        '<div contenteditable="true"><mark style="color: red">abc</mark></div>' +
        'GAP<div contenteditable="true">def</div>',
        false
      );
      const mark = elementIn(wrap, 'mark');
      const hosts = wrap.querySelectorAll('div[contenteditable]');

      expect(hasMark(colorSpec, rangeBetween(firstText(mark), 0, firstText(hosts[1]), 3))).toBe(false);
    });

    it('marks each host share and re-selects the whole span', () => {
      const wrap = mount('<div contenteditable="true">abc</div>GAP<div contenteditable="true">def</div>', false);
      const hosts = wrap.querySelectorAll('div');
      const range = rangeBetween(firstText(hosts[0]), 1, firstText(hosts[1]), 2);

      selectSentinel();

      const applied = applyMark(colorSpec, 'blue', range);

      expect(applied.map((element) => element.outerHTML)).toStrictEqual([
        '<mark style="color: blue;">bc</mark>',
        '<mark style="color: blue;">de</mark>',
      ]);
      expect(wrap.innerHTML).toBe(
        '<div contenteditable="true">a<mark style="color: blue;">bc</mark></div>' +
        'GAP<div contenteditable="true"><mark style="color: blue;">de</mark>f</div>'
      );

      const selection = liveSelection();

      expect(selection.toString()).toBe('bcGAPde');
      expect(selection.anchorNode).toBe(hosts[0]);
      expect(selection.anchorOffset).toBe(1);
      expect(selection.focusNode).toBe(hosts[1]);
      expect(selection.focusOffset).toBe(1);
    });

    it('unmarks each host share and re-selects from the live slices', () => {
      const wrap = mount(
        '<div contenteditable="true">a<mark style="color: red">bc</mark></div>' +
        'GAP<div contenteditable="true"><mark style="color: red">de</mark>f</div>',
        false
      );
      const marks = wrap.querySelectorAll('mark');
      const hosts = wrap.querySelectorAll('div[contenteditable]');

      selectSentinel();

      const removed = removeMark(colorSpec, rangeBetween(firstText(marks[0]), 0, firstText(marks[1]), 2));

      expect(removed).toStrictEqual([]);
      expect(wrap.innerHTML).toBe(
        '<div contenteditable="true">abc</div>GAP<div contenteditable="true">def</div>'
      );

      /*
       * Pins a DEFECT, not an intent: the span is rebuilt from the LIVE slice
       * ranges, and unwrapping the first host wrapper collapses that slice onto
       * the host end, so the restored selection starts where the first host ends
       * instead of where the user dragged. Change the behaviour and update this.
       */
      const selection = liveSelection();

      expect(selection.toString()).toBe('GAPde');
      expect(selection.anchorNode).toBe(hosts[0]);
      expect(selection.anchorOffset).toBe(2);
      expect(selection.focusNode).toBe(hosts[1]);
      expect(selection.focusOffset).toBe(1);
    });

    it('does not treat a share carrying no characters as a second host', () => {
      const wrap = mount('<div contenteditable="true">abc</div><div contenteditable="true">def</div>', false);
      const hosts = wrap.querySelectorAll('div');

      selectSentinel();

      const applied = applyMark(colorSpec, 'blue', rangeBetween(firstText(hosts[0]), 1, firstText(hosts[1]), 0));

      /*
       * One share left means hostSlicesOf returns null and the caller runs the
       * single-host surgery on the FULL cross-host range — the one mark it makes
       * currently wraps both hosts. Asserted by count, not by shape, so fixing
       * that does not have to rewrite this test.
       */
      expect(applied).toHaveLength(1);
      expect(wrap.querySelectorAll('mark')).toHaveLength(1);
      expect(liveSelection().toString()).toBe('bc');
    });
  });

  describe('sanitizer rules for declared attributes', () => {
    const ruleFor = <State>(spec: MarkSpec<State>): ((element: Element) => TagConfig) => {
      const rule = markSanitizerConfig(spec)['span'];

      if (typeof rule !== 'function') {
        throw new Error('expected a function rule');
      }

      return rule;
    };

    it('allowlists a static attribute only when its value matches the spec', () => {
      const rule = ruleFor(attributeOnlySpec);
      const matching = document.createElement('span');
      const mismatched = document.createElement('span');

      matching.setAttribute('data-kind', 'note');
      mismatched.setAttribute('data-kind', 'evil');

      expect(rule(matching)).toStrictEqual({ 'data-kind': true });
      expect(rule(mismatched)).toStrictEqual({});
    });

    it('allowlists nothing for a declared attribute the element does not carry', () => {
      expect(ruleFor(dynamicAttributeSpec)(document.createElement('span'))).toStrictEqual({});
    });
  });
});
