import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ClearFormatInlineTool } from '../../../../src/components/inline-tools/inline-tool-clear-format';
import { IconClearFormat } from '../../../../src/components/icons';
import type { PopoverItemDefaultBaseParams } from '../../../../types/utils/popover';

interface Fixture {
  host: HTMLElement;
  clear: () => void;
  isActive: () => boolean;
}

const mount = (html: string): Fixture => {
  const tool = new ClearFormatInlineTool();
  const config = tool.render() as PopoverItemDefaultBaseParams;
  const host = document.createElement('div');

  host.setAttribute('contenteditable', 'true');
  host.innerHTML = html;
  document.body.appendChild(host);

  const { onActivate, isActive } = config;

  if (typeof onActivate !== 'function' || typeof isActive !== 'function') {
    throw new Error('the clear-format tool did not expose its callbacks');
  }

  return { host, clear: () => onActivate(config), isActive: () => isActive() };
};

const textNodeOf = (root: Node, text: string): Text => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.textContent === text) {
      return node as Text;
    }
  }

  throw new Error(`no text node holding ${JSON.stringify(text)}`);
};

const select = (node: Node, start: number, end: number): void => {
  const range = document.createRange();

  range.setStart(node, start);
  range.setEnd(node, end);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};

const selectAll = (host: HTMLElement): void => select(host, 0, host.childNodes.length);

describe('ClearFormatInlineTool mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  describe('the toolbar button', () => {
    it('never lights up, because clearing has no state to be in', () => {
      const tool = new ClearFormatInlineTool();
      const config = tool.render() as PopoverItemDefaultBaseParams;

      expect(config.icon).toBe(IconClearFormat);
      expect(config.name).toBe('clearFormat');
      expect(typeof config.isActive === 'function' && config.isActive()).toBe(false);
    });

    it('introduces no tags of its own', () => {
      expect(ClearFormatInlineTool.sanitize).toStrictEqual({});
      expect(ClearFormatInlineTool.shortcut).toBe('CMD+BACKSLASH');
    });
  });

  describe('what it strips', () => {
    it.each([
      ['b', '<b>bold</b>'],
      ['strong', '<strong>bold</strong>'],
      ['i', '<i>italic</i>'],
      ['em', '<em>italic</em>'],
      ['u', '<u>under</u>'],
      ['s', '<s>struck</s>'],
      ['strike', '<strike>struck</strike>'],
      ['del', '<del>struck</del>'],
      ['code', '<code>code</code>'],
      ['mark', '<mark>marked</mark>'],
    ])('strips %s', (tag, html) => {
      const { host, clear } = mount(html);
      const text = host.textContent ?? '';

      selectAll(host);
      clear();

      expect(host.querySelector(tag)).toBeNull();
      expect(host.textContent).toBe(text);
    });

    it('keeps a link, so clearing format never destroys a url', () => {
      const { host, clear } = mount('<a href="https://example.test"><b>linked</b></a>');

      selectAll(host);
      clear();

      expect(host.querySelector('b')).toBeNull();
      expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.test');
      expect(host.textContent).toBe('linked');
    });

    it('strips formatting nested several deep', () => {
      const { host, clear } = mount('<b><i><u>deep</u></i></b>');

      selectAll(host);
      clear();

      expect(host.querySelectorAll('b, i, u')).toHaveLength(0);
      expect(host.textContent).toBe('deep');
    });

    it('removes a wrapper left with nothing in it', () => {
      const { host, clear } = mount('<b>gone</b>');

      selectAll(host);
      clear();

      expect(host.innerHTML).toBe('gone');
    });
  });

  describe('when it does nothing', () => {
    it('leaves the document alone for a collapsed caret', () => {
      const { host, clear } = mount('<b>bold</b>');

      select(textNodeOf(host, 'bold'), 2, 2);
      clear();

      expect(host.innerHTML).toBe('<b>bold</b>');
    });

    it('leaves the document alone with no selection', () => {
      const { host, clear } = mount('<b>bold</b>');

      window.getSelection()?.removeAllRanges();
      clear();

      expect(host.innerHTML).toBe('<b>bold</b>');
    });
  });

  describe('splitting a wrapper around the cleared part', () => {
    it('drops the wrapper when all of it is cleared', () => {
      const { host, clear } = mount('a<b>bcd</b>e');

      select(textNodeOf(host, 'bcd'), 0, 3);
      clear();

      expect(host.querySelector('b')).toBeNull();
      expect(host.textContent).toBe('abcde');
    });

    it('lifts the leading part out in front of the wrapper', () => {
      const { host, clear } = mount('a<b id="orig">bcd</b>e');
      const originalBold = host.querySelector('b');

      select(textNodeOf(host, 'bcd'), 0, 1);
      clear();

      const bold = host.querySelector('b');

      expect(bold).toBe(originalBold);
      expect(host.innerHTML).toBe('a' + 'b<b id="orig">cd</b>e');
      expect(bold?.previousSibling?.textContent).toBe('b');
    });

    it('lifts the trailing part out behind the wrapper', () => {
      const { host, clear } = mount('a<b>bcd</b>e');

      select(textNodeOf(host, 'bcd'), 2, 3);
      clear();

      const bold = host.querySelector('b');

      expect(host.innerHTML).toBe('a<b>bc</b>de');
      expect(bold?.nextSibling?.textContent).toBe('d');
    });

    it('splits the wrapper in two around a middle part', () => {
      const { host, clear } = mount('a<b>bcd</b>e');
      const originalBold = host.querySelector('b');

      select(textNodeOf(host, 'bcd'), 1, 2);
      clear();

      const bolds = host.querySelectorAll('b');

      expect(host.innerHTML).toBe('a<b>b</b>c<b>d</b>e');
      expect(bolds).toHaveLength(2);
      expect(bolds[0]).toBe(originalBold);
    });
  });

  describe('edge shapes of the wrapper walk', () => {
    it('clears a selection that extracts nothing without touching the selection', () => {
      const { host, clear } = mount('<b></b>');

      selectAll(host);
      clear();

      expect(host.innerHTML).toBe('');
      expect(window.getSelection()?.rangeCount).toBe(0);
    });

    it('deletes the wrappers the extraction emptied but left in place', () => {
      const { host, clear } = mount('<b>ab</b><i>cd</i>');
      const range = document.createRange();

      range.setStart(textNodeOf(host, 'ab'), 0);
      range.setEnd(textNodeOf(host, 'cd'), 2);

      const selection = window.getSelection();

      selection?.removeAllRanges();
      selection?.addRange(range);
      clear();

      expect(host.innerHTML).toBe('abcd');
    });

    it('keeps a childless element that only looks empty, like a line break', () => {
      const { host, clear } = mount('<b>ab<br>cd</b>');

      select(textNodeOf(host, 'ab'), 0, 1);
      clear();

      expect(host.innerHTML).toBe('a<b>b<br>cd</b>');
    });

    it('unwraps every wrapper when the marker is the sole child of each', () => {
      const { host, clear } = mount('<b><i>xy</i></b>');

      select(textNodeOf(host, 'xy'), 0, 2);
      clear();

      expect(host.innerHTML).toBe('xy');
    });

    it('splits a wrapper whose sole child is a plain element around the marker', () => {
      const { host, clear } = mount('<b><span>xy</span></b>');

      select(textNodeOf(host, 'xy'), 0, 2);
      clear();

      // The emptied outer <b> survives: only the nearest formatting ancestor of
      // each text node is collected for cleanup, and here that was <b> itself,
      // already detached by the split. Known stray-wrapper behaviour.
      expect(host.innerHTML).toBe('xy<b></b>');
    });
  });

  describe('the selection afterwards', () => {
    it('spans exactly the text that was cleared', () => {
      const { host, clear } = mount('a<b>bcd</b>e');

      select(textNodeOf(host, 'bcd'), 0, 3);
      clear();

      const selection = window.getSelection();

      expect(selection?.rangeCount).toBe(1);
      expect(selection?.getRangeAt(0).toString()).toBe('bcd');
    });
  });
});
