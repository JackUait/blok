import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  matchesMarkSpec,
  hasMark,
  findMark,
  readMark,
  applyMark,
  removeMark,
  toggleMark,
  toggleMarkAtCaret,
  markSanitizerConfig,
} from '../../../../src/components/marks/mark-engine';
import type { MarkSpec } from '../../../../types/api/marks';

/** Marker's text-color mode expressed as a spec: one mark that updates in place. */
const colorSpec: MarkSpec<string> = {
  tag: 'mark',
  style: { color: (value: string): string => value },
};

/** Marker's background mode — same family as colorSpec, so the two compose. */
const bgSpec: MarkSpec<string> = {
  tag: 'mark',
  style: { 'background-color': (value: string): string => value },
};

/** The degenerate consumer case: a single-class toggle with zero state. */
const classSpec: MarkSpec = {
  tag: 'span',
  className: 'hl-description',
};

describe('mark-engine', () => {
  let container: HTMLDivElement;

  const setContent = (html: string): void => {
    container.innerHTML = html;
  };

  const rangeOver = (node: Node, start: number, end: number): Range => {
    const range = document.createRange();

    range.setStart(node, start);
    range.setEnd(node, end);

    return range;
  };

  const rangeOverContents = (node: Node): Range => {
    const range = document.createRange();

    range.selectNodeContents(node);

    return range;
  };

  const selectRange = (range: Range): Selection => {
    const selection = window.getSelection();

    if (!selection) {
      throw new Error('jsdom returned no selection');
    }

    selection.removeAllRanges();
    selection.addRange(range);

    return selection;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    container.contentEditable = 'true';
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  describe('matchesMarkSpec', () => {
    it('matches by tag regardless of case and rejects other tags', () => {
      const mark = document.createElement('mark');

      mark.style.setProperty('color', 'red');

      expect(matchesMarkSpec(colorSpec, mark)).toBe(true);
      expect(matchesMarkSpec(colorSpec, document.createElement('span'))).toBe(false);
    });

    it('requires every declared className but tolerates extra classes', () => {
      const el = document.createElement('span');

      el.className = 'hl-description extra';
      expect(matchesMarkSpec(classSpec, el)).toBe(true);

      el.className = 'extra';
      expect(matchesMarkSpec(classSpec, el)).toBe(false);
    });

    it('includes static style values in identity', () => {
      const spec: MarkSpec = { tag: 'span', style: { 'font-weight': 'bold' } };
      const el = document.createElement('span');

      el.style.setProperty('font-weight', 'bold');
      expect(matchesMarkSpec(spec, el)).toBe(true);

      el.style.setProperty('font-weight', 'normal');
      expect(matchesMarkSpec(spec, el)).toBe(false);
    });

    it('excludes function-form style values from identity: any set value matches, unset or transparent does not', () => {
      const el = document.createElement('mark');

      expect(matchesMarkSpec(colorSpec, el)).toBe(false);

      el.style.setProperty('color', 'blue');
      expect(matchesMarkSpec(colorSpec, el)).toBe(true);

      const bgEl = document.createElement('mark');

      bgEl.style.setProperty('background-color', 'transparent');
      expect(matchesMarkSpec(bgSpec, bgEl)).toBe(false);
    });

    it('matches static attributes by value and function-form attributes by presence', () => {
      const staticSpec: MarkSpec = { tag: 'span', attributes: { 'data-kind': 'note' } };
      const dynamicSpec: MarkSpec<string> = {
        tag: 'span',
        attributes: { 'data-id': (value: string): string => value },
      };
      const el = document.createElement('span');

      el.setAttribute('data-kind', 'note');
      expect(matchesMarkSpec(staticSpec, el)).toBe(true);

      el.setAttribute('data-kind', 'other');
      expect(matchesMarkSpec(staticSpec, el)).toBe(false);

      expect(matchesMarkSpec(dynamicSpec, el)).toBe(false);
      el.setAttribute('data-id', 'anything');
      expect(matchesMarkSpec(dynamicSpec, el)).toBe(true);
    });
  });

  describe('hasMark', () => {
    it('is true when every text node in the range sits inside a matching wrapper', () => {
      setContent('<mark style="color: red">one</mark><mark style="color: blue">two</mark>');

      expect(hasMark(colorSpec, rangeOverContents(container))).toBe(true);
    });

    it('is false when any part of the range is uncovered (range-aware, not anchor-only)', () => {
      setContent('<mark style="color: red">one</mark> plain');

      expect(hasMark(colorSpec, rangeOverContents(container))).toBe(false);
    });

    it('is true at a collapsed caret inside a matching wrapper', () => {
      setContent('<mark style="color: red">word</mark>');

      const text = container.querySelector('mark')?.firstChild;

      if (!text) {
        throw new Error('fixture missing text node');
      }

      expect(hasMark(colorSpec, rangeOver(text, 2, 2))).toBe(true);
    });
  });

  describe('findMark', () => {
    it('returns the nearest matching ancestor and null when there is none', () => {
      setContent('<mark style="color: red"><b>deep</b></mark>');

      const deepText = container.querySelector('b')?.firstChild ?? null;

      expect(findMark(colorSpec, deepText)).toBe(container.querySelector('mark'));
      expect(findMark(classSpec, deepText)).toBeNull();
    });
  });

  describe('applyMark', () => {
    it('wraps a plain selection in an element built from the spec and state', () => {
      setContent('plain text');

      const text = container.firstChild;

      if (!text) {
        throw new Error('fixture missing text node');
      }

      const range = rangeOver(text, 0, 5);

      selectRange(range);

      const applied = applyMark(colorSpec, 'red', range);

      expect(applied).toHaveLength(1);

      const mark = container.querySelector('mark');

      expect(mark).not.toBeNull();
      expect(mark?.textContent).toBe('plain');
      expect(mark?.style.getPropertyValue('color')).toBe('red');

      /* The new contents stay selected. */
      expect(window.getSelection()?.toString()).toBe('plain');
    });

    it('builds className and static attributes into the wrapper', () => {
      setContent('described');

      const text = container.firstChild;

      if (!text) {
        throw new Error('fixture missing text node');
      }

      const range = rangeOver(text, 0, 9);

      selectRange(range);
      applyMark(classSpec, undefined, range);

      const span = container.querySelector('span');

      expect(span?.className).toBe('hl-description');
      expect(span?.textContent).toBe('described');
    });

    it('extends the range over browser-excluded trailing whitespace', () => {
      setContent('hello   ');

      const text = container.firstChild;

      if (!text) {
        throw new Error('fixture missing text node');
      }

      /* Chromium/WebKit Ctrl+A stops before trailing spaces — offset 5 of 8. */
      const range = rangeOver(text, 0, 5);

      selectRange(range);
      applyMark(colorSpec, 'red', range);

      expect(container.querySelector('mark')?.textContent).toBe('hello   ');
    });

    it('composes two specs of the same family on one element instead of nesting', () => {
      setContent('shared');

      const text = container.firstChild;

      if (!text) {
        throw new Error('fixture missing text node');
      }

      const range = rangeOver(text, 0, 6);

      selectRange(range);
      applyMark(colorSpec, 'red', range);

      const liveRange = window.getSelection()?.getRangeAt(0);

      if (!liveRange) {
        throw new Error('selection lost after first apply');
      }

      const applied = applyMark(bgSpec, 'yellow', liveRange);

      const marks = container.querySelectorAll('mark');

      expect(marks).toHaveLength(1);
      expect(marks[0].style.getPropertyValue('color')).toBe('red');
      expect(marks[0].style.getPropertyValue('background-color')).toBe('yellow');
      expect(applied).toEqual([marks[0]]);
    });

    it('updates a fully-covered wrapper in place — one mark, not N cancelling marks', () => {
      setContent('<mark style="color: red">tinted</mark>');

      const mark = container.querySelector('mark');

      if (!mark) {
        throw new Error('fixture missing mark');
      }

      const range = rangeOverContents(mark);

      selectRange(range);
      applyMark(colorSpec, 'blue', range);

      const marks = container.querySelectorAll('mark');

      expect(marks).toHaveLength(1);
      expect(marks[0].style.getPropertyValue('color')).toBe('blue');
      expect(container.textContent).toBe('tinted');
    });

    it('splits a wrapper when only part of it is re-styled', () => {
      setContent('<mark style="color: red">abcdef</mark>');

      const text = container.querySelector('mark')?.firstChild;

      if (!text) {
        throw new Error('fixture missing text node');
      }

      const range = rangeOver(text, 2, 4);

      selectRange(range);
      applyMark(colorSpec, 'blue', range);

      const marks = Array.from(container.querySelectorAll('mark'));

      expect(marks.map((el) => el.textContent)).toEqual(['ab', 'cd', 'ef']);
      expect(marks.map((el) => el.style.getPropertyValue('color'))).toEqual(['red', 'blue', 'red']);
    });

    it('splits at range boundaries when the selection crosses out of a wrapper', () => {
      setContent('<mark style="color: red">ab</mark>cd');

      const markText = container.querySelector('mark')?.firstChild;
      const tailText = container.lastChild;

      if (!markText || !tailText) {
        throw new Error('fixture missing text nodes');
      }

      const range = document.createRange();

      range.setStart(markText, 1);
      range.setEnd(tailText, 2);
      selectRange(range);
      applyMark(colorSpec, 'blue', range);

      const marks = Array.from(container.querySelectorAll('mark'));

      expect(marks.map((el) => el.textContent)).toEqual(['a', 'bcd']);
      expect(marks.map((el) => el.style.getPropertyValue('color'))).toEqual(['red', 'blue']);
      expect(container.textContent).toBe('abcd');
    });
  });

  describe('removeMark', () => {
    it('unwraps a wrapper left bare and keeps the text selected', () => {
      setContent('<mark style="color: red">tinted</mark>');

      const mark = container.querySelector('mark');

      if (!mark) {
        throw new Error('fixture missing mark');
      }

      const range = rangeOverContents(mark);

      selectRange(range);

      const survivors = removeMark(colorSpec, range);

      expect(container.querySelector('mark')).toBeNull();
      expect(container.textContent).toBe('tinted');
      expect(survivors).toHaveLength(0);
      expect(window.getSelection()?.toString()).toBe('tinted');
    });

    it('keeps the wrapper when another composed property remains', () => {
      setContent('<mark style="color: red; background-color: yellow">both</mark>');

      const mark = container.querySelector('mark');

      if (!mark) {
        throw new Error('fixture missing mark');
      }

      const range = rangeOverContents(mark);

      selectRange(range);

      const survivors = removeMark(bgSpec, range);

      const kept = container.querySelector('mark');

      expect(kept).not.toBeNull();
      expect(kept?.style.getPropertyValue('background-color')).toBe('');
      expect(kept?.style.getPropertyValue('color')).toBe('red');
      expect(survivors).toEqual([kept]);
    });

    it('treats a transparent-valued property as bare and unwraps', () => {
      setContent('<mark style="color: red; background-color: transparent">tinted</mark>');

      const mark = container.querySelector('mark');

      if (!mark) {
        throw new Error('fixture missing mark');
      }

      const range = rangeOverContents(mark);

      selectRange(range);
      removeMark(colorSpec, range);

      expect(container.querySelector('mark')).toBeNull();
      expect(container.textContent).toBe('tinted');
    });

    it('splits the wrapper when only part of the range is deformatted', () => {
      setContent('<mark style="color: red">abcdef</mark>');

      const text = container.querySelector('mark')?.firstChild;

      if (!text) {
        throw new Error('fixture missing text node');
      }

      const range = rangeOver(text, 2, 4);

      selectRange(range);
      removeMark(colorSpec, range);

      const marks = Array.from(container.querySelectorAll('mark'));

      expect(marks.map((el) => el.textContent)).toEqual(['ab', 'ef']);
      expect(container.textContent).toBe('abcdef');
    });

    it('removes the wrapper around a collapsed caret', () => {
      setContent('<mark style="color: red">word</mark>');

      const text = container.querySelector('mark')?.firstChild;

      if (!text) {
        throw new Error('fixture missing text node');
      }

      const range = rangeOver(text, 2, 2);

      selectRange(range);
      removeMark(colorSpec, range);

      expect(container.querySelector('mark')).toBeNull();
      expect(container.textContent).toBe('word');
    });

    it('removes declared classNames and unwraps a class-identified wrapper', () => {
      setContent('<span class="hl-description">note</span>');

      const span = container.querySelector('span');

      if (!span) {
        throw new Error('fixture missing span');
      }

      const range = rangeOverContents(span);

      selectRange(range);
      removeMark(classSpec, range);

      expect(container.querySelector('span')).toBeNull();
      expect(container.textContent).toBe('note');
    });
  });

  describe('toggleMark', () => {
    it('applies when absent (returns true) and removes when present (returns false)', () => {
      setContent('switch');

      const text = container.firstChild;

      if (!text) {
        throw new Error('fixture missing text node');
      }

      const range = rangeOver(text, 0, 6);

      selectRange(range);

      expect(toggleMark(colorSpec, 'red', range)).toBe(true);
      expect(container.querySelector('mark')).not.toBeNull();

      const liveRange = window.getSelection()?.getRangeAt(0);

      if (!liveRange) {
        throw new Error('selection lost after toggle on');
      }

      expect(toggleMark(colorSpec, 'red', liveRange)).toBe(false);
      expect(container.querySelector('mark')).toBeNull();
      expect(container.textContent).toBe('switch');
    });
  });

  describe('readMark', () => {
    it('returns current values of declared properties, omitting transparent fillers', () => {
      setContent('<mark style="color: red; background-color: transparent">read</mark>');

      const text = container.querySelector('mark')?.firstChild;

      if (!text) {
        throw new Error('fixture missing text node');
      }

      const range = rangeOver(text, 0, 4);

      const colorSnapshot = readMark(colorSpec, range);

      expect(colorSnapshot?.element).toBe(container.querySelector('mark'));
      expect(colorSnapshot?.style).toEqual({ color: 'red' });

      expect(readMark(bgSpec, range)).toBeNull();
    });

    it('returns null when the range is not inside a matching wrapper', () => {
      setContent('bare text');

      const text = container.firstChild;

      if (!text) {
        throw new Error('fixture missing text node');
      }

      expect(readMark(colorSpec, rangeOver(text, 0, 4))).toBeNull();
    });
  });

  describe('markSanitizerConfig', () => {
    it('keeps declared style properties and strips undeclared ones', () => {
      const config = markSanitizerConfig(colorSpec);
      const rule = config['mark'];

      expect(typeof rule).toBe('function');

      if (typeof rule !== 'function') {
        throw new Error('expected a function rule');
      }

      const el = document.createElement('mark');

      el.style.setProperty('color', 'red');
      el.style.setProperty('position', 'fixed');

      expect(rule(el)).toEqual({ style: true });
      expect(el.style.getPropertyValue('color')).toBe('red');
      expect(el.style.getPropertyValue('position')).toBe('');
    });

    it('drops the style attribute entirely when nothing declared remains', () => {
      const config = markSanitizerConfig(colorSpec);
      const rule = config['mark'];

      if (typeof rule !== 'function') {
        throw new Error('expected a function rule');
      }

      const el = document.createElement('mark');

      el.style.setProperty('position', 'fixed');

      expect(rule(el)).toEqual({});
    });

    it('keeps declared classes and strips undeclared ones', () => {
      const config = markSanitizerConfig(classSpec);
      const rule = config['span'];

      if (typeof rule !== 'function') {
        throw new Error('expected a function rule');
      }

      const el = document.createElement('span');

      el.className = 'hl-description sneaky';

      expect(rule(el)).toEqual({ class: true });
      expect(el.className).toBe('hl-description');

      const stranger = document.createElement('span');

      stranger.className = 'sneaky';
      expect(rule(stranger)).toEqual({});
    });

    it('allowlists declared attributes', () => {
      const spec: MarkSpec<string> = {
        tag: 'span',
        attributes: { 'data-id': (value: string): string => value },
      };
      const config = markSanitizerConfig(spec);
      const rule = config['span'];

      if (typeof rule !== 'function') {
        throw new Error('expected a function rule');
      }

      const el = document.createElement('span');

      el.setAttribute('data-id', 'x1');

      expect(rule(el)).toEqual({ 'data-id': true });
    });
  });

  describe('aliasTags', () => {
    /** Bold expressed as a spec: <b> is the same mark as <strong>. */
    const boldSpec: MarkSpec = {
      tag: 'strong',
      aliasTags: ['b'],
    };

    it('matches alias-tagged elements as the same mark', () => {
      const b = document.createElement('b');
      const strong = document.createElement('strong');
      const em = document.createElement('em');

      expect(matchesMarkSpec(boldSpec, strong)).toBe(true);
      expect(matchesMarkSpec(boldSpec, b)).toBe(true);
      expect(matchesMarkSpec(boldSpec, em)).toBe(false);
    });

    it('reports hasMark across a mix of canonical and alias wrappers', () => {
      setContent('<strong>one</strong> <b>two</b>');

      expect(hasMark(boldSpec, rangeOverContents(container))).toBe(true);
    });

    it('creates the canonical tag and strips nested alias wrappers on apply', () => {
      setContent('plain <b>bolded</b> tail');

      const range = rangeOverContents(container);

      selectRange(range);
      applyMark(boldSpec, undefined, range);

      expect(container.querySelectorAll('b').length).toBe(0);
      expect(container.querySelectorAll('strong').length).toBe(1);
      expect(container.querySelector('strong')?.textContent).toBe('plain bolded tail');
    });

    it('unwraps alias wrappers on remove', () => {
      setContent('<b>bolded</b>');

      const range = rangeOverContents(container);

      selectRange(range);
      removeMark(boldSpec, range);

      expect(container.querySelectorAll('b, strong').length).toBe(0);
      expect(container.textContent).toBe('bolded');
    });

    it('splits a partially-selected alias wrapper at the boundary', () => {
      setContent('<b>bolded</b>');

      const textNode = container.querySelector('b')?.firstChild;

      if (!textNode) {
        throw new Error('fixture text node missing');
      }

      const range = rangeOver(textNode, 0, 4);

      selectRange(range);
      removeMark(boldSpec, range);

      expect(container.textContent).toBe('bolded');
      expect(container.querySelector('b, strong')?.textContent).toBe('ed');
    });

    it('extends removal over browser-excluded trailing whitespace, symmetric with apply', () => {
      setContent('<strong>hello world </strong>');

      const textNode = container.querySelector('strong')?.firstChild;

      if (!textNode) {
        throw new Error('fixture text node missing');
      }

      /** Triple-click/Ctrl+A style selection stopping before the trailing space */
      const range = rangeOver(textNode, 0, 11);

      selectRange(range);
      removeMark(boldSpec, range);

      expect(container.querySelector('strong')).toBeNull();
      expect(container.textContent).toBe('hello world ');
    });

    it('does not extend an element-bounded range that stops short of the last child', () => {
      setContent('<strong>aa</strong><strong>bb </strong>');

      const range = document.createRange();

      /** Selection covering only the first wrapper, anchored on the container */
      range.setStart(container, 0);
      range.setEnd(container, 1);

      selectRange(range);
      removeMark(boldSpec, range);

      expect(container.innerHTML).toBe('aa<strong>bb </strong>');
    });

    it('emits sanitizer rules for the canonical tag and every alias', () => {
      const config = markSanitizerConfig(boldSpec);

      expect(Object.keys(config).sort()).toEqual(['b', 'strong']);
    });
  });

  describe('toggleMarkAtCaret', () => {
    it('inserts a pending-format wrapper holding a zero-width space at the caret', () => {
      setContent('hello');

      const textNode = container.firstChild;

      if (!textNode) {
        throw new Error('fixture text node missing');
      }

      const caret = rangeOver(textNode, 2, 2);

      selectRange(caret);

      const nowApplied = toggleMarkAtCaret(classSpec, undefined, caret);

      expect(nowApplied).toBe(true);

      const wrapper = container.querySelector('span.hl-description');

      expect(wrapper?.textContent).toBe('​');

      const selection = window.getSelection();

      expect(selection?.anchorNode).toBe(wrapper?.firstChild);
      expect(selection?.anchorOffset).toBe(1);
      expect(selection?.isCollapsed).toBe(true);
    });

    it('splits the wrapper around the caret when toggling off, leaving surrounding text formatted', () => {
      setContent('<span class="hl-description">hello</span>');

      const textNode = container.querySelector('span')?.firstChild;

      if (!textNode) {
        throw new Error('fixture text node missing');
      }

      const caret = rangeOver(textNode, 2, 2);

      selectRange(caret);

      const nowApplied = toggleMarkAtCaret(classSpec, undefined, caret);

      expect(nowApplied).toBe(false);

      const wrappers = Array.from(container.querySelectorAll('span.hl-description'));

      expect(wrappers.map((w) => w.textContent)).toEqual(['he', 'llo']);
      expect(container.textContent).toBe('he​llo');

      const selection = window.getSelection();

      expect(selection?.isCollapsed).toBe(true);
      expect(selection?.anchorNode?.parentElement?.closest('.hl-description')).toBeNull();
    });

    it('keeps the text after the caret formatted when the wrapper ends with whitespace', () => {
      setContent('<span class="hl-description">hello </span>');

      const textNode = container.querySelector('span')?.firstChild;

      if (!textNode) {
        throw new Error('fixture text node missing');
      }

      const caret = rangeOver(textNode, 2, 2);

      selectRange(caret);

      toggleMarkAtCaret(classSpec, undefined, caret);

      const wrappers = Array.from(container.querySelectorAll('span.hl-description'));

      expect(wrappers.map((w) => w.textContent)).toEqual(['he', 'llo ']);
    });
  });
});
