import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { BoldInlineTool } from '../../../../src/components/inline-tools/inline-tool-bold';
import { InlineToolEventManager } from '../../../../src/components/inline-tools/services/inline-tool-event-manager';
import { IconBold } from '../../../../src/components/icons';
import type { PopoverItemDefaultBaseParams } from '../../../../types/utils/popover';

const MAC_AGENT = 'mozilla/5.0 (macintosh; intel mac os x 10_15_7)';

interface Fixture {
  editor: HTMLElement;
  paragraph: HTMLElement;
  button: HTMLElement;
  activate: () => void;
  isActive: () => boolean;
}

const mount = (html: string): Fixture => {
  const editor = document.createElement('div');

  editor.setAttribute('data-blok-editor', '');

  const toolbar = document.createElement('div');

  toolbar.setAttribute('data-blok-testid', 'inline-toolbar');

  const button = document.createElement('button');

  button.setAttribute('data-blok-item-name', 'bold');
  toolbar.appendChild(button);

  const paragraph = document.createElement('div');

  paragraph.contentEditable = 'true';
  paragraph.innerHTML = html;
  editor.append(toolbar, paragraph);
  document.body.appendChild(editor);

  const config = new BoldInlineTool().render() as PopoverItemDefaultBaseParams;
  const { onActivate, isActive } = config;

  if (typeof onActivate !== 'function' || typeof isActive !== 'function') {
    throw new Error('the bold tool did not expose its callbacks');
  }

  return { editor, paragraph, button, activate: () => onActivate(config), isActive: () => isActive() };
};

const textHolding = (root: Node, value: string): Text => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.textContent === value) {
      return node as Text;
    }
  }

  throw new Error(`no text node holding ${JSON.stringify(value)}`);
};

const select = (node: Node, start: number, end: number): void => {
  const range = document.createRange();

  range.setStart(node, start);
  range.setEnd(node, end);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};

const onAMac = (): void => {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(MAC_AGENT);
};

const boldShortcut = (): KeyboardEvent => new KeyboardEvent('keydown', {
  key: 'b',
  metaKey: true,
  bubbles: true,
  cancelable: true,
});

describe('BoldInlineTool mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    InlineToolEventManager.reset();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    InlineToolEventManager.reset();
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  describe('metadata', () => {
    it('keeps legacy b in the sanitizer beside canonical strong', () => {
      expect(BoldInlineTool.sanitize).toStrictEqual({ strong: {}, b: {} });
    });

    it('defers a collapsed-caret shortcut to the browser', () => {
      expect(BoldInlineTool.nativeCaretShortcut).toBe(true);
      expect(BoldInlineTool.shortcut).toBe('CMD+B');
      expect(BoldInlineTool.isInline).toBe(true);
      expect(BoldInlineTool.titleKey).toBe('bold');
    });

    it('renders the bold icon under its own name', () => {
      const config = new BoldInlineTool().render() as PopoverItemDefaultBaseParams;

      expect(config.icon).toBe(IconBold);
      expect(config.name).toBe('bold');
    });
  });

  describe('toggling', () => {
    it('wraps the selection in canonical strong', () => {
      const { paragraph, activate } = mount('x bold y');

      select(textHolding(paragraph, 'x bold y'), 2, 6);
      activate();

      expect(paragraph.querySelector('strong')?.textContent).toBe('bold');
      expect(paragraph.querySelector('b')).toBeNull();
      expect(paragraph.textContent).toBe('x bold y');
    });

    it('unwraps a selection that is already bold', () => {
      const { paragraph, activate } = mount('x<strong>bold</strong>y');

      select(textHolding(paragraph, 'bold'), 0, 4);
      activate();

      expect(paragraph.querySelector('strong')).toBeNull();
      expect(paragraph.textContent).toBe('xboldy');
    });

    it('does nothing at a collapsed caret, where the browser owns pending bold', () => {
      const { paragraph, activate } = mount('plain');

      select(textHolding(paragraph, 'plain'), 2, 2);
      activate();

      expect(paragraph.querySelector('strong')).toBeNull();
      expect(paragraph.innerHTML).toBe('plain');
    });

    it('does nothing with no selection at all', () => {
      const { paragraph, activate } = mount('plain');

      window.getSelection()?.removeAllRanges();

      expect(() => activate()).not.toThrow();
      expect(paragraph.innerHTML).toBe('plain');
    });
  });

  describe('isActive', () => {
    it('is true inside canonical strong', () => {
      const { paragraph, isActive } = mount('x<strong>bold</strong>y');

      select(textHolding(paragraph, 'bold'), 0, 4);

      expect(isActive()).toBe(true);
    });

    it('is true inside a legacy b, which is the same mark', () => {
      const { paragraph, isActive } = mount('x<b>bold</b>y');

      select(textHolding(paragraph, 'bold'), 0, 4);

      expect(isActive()).toBe(true);
    });

    it('is false in plain text', () => {
      const { paragraph, isActive } = mount('x<strong>bold</strong>y');

      select(textHolding(paragraph, 'y'), 0, 1);

      expect(isActive()).toBe(false);
    });

    it('is false with no selection at all', () => {
      const { isActive } = mount('x<strong>bold</strong>y');

      window.getSelection()?.removeAllRanges();

      expect(isActive()).toBe(false);
    });
  });

  describe('the toolbar button state', () => {
    it('marks the button active after a programmatic toggle', () => {
      const { paragraph, button, activate } = mount('x bold y');

      select(textHolding(paragraph, 'x bold y'), 2, 6);
      activate();

      expect(button.getAttribute('data-blok-popover-item-active')).toBe('true');
    });

    it('clears the mark when the toggle removed the bold', () => {
      const { paragraph, button, activate } = mount('x<strong>bold</strong>y');

      button.setAttribute('data-blok-popover-item-active', 'true');
      select(textHolding(paragraph, 'bold'), 0, 4);
      activate();

      expect(button.hasAttribute('data-blok-popover-item-active')).toBe(false);
    });

    it('leaves a toolbar in another editor alone', () => {
      const first = mount('x bold y');
      const second = mount('a bold b');

      select(textHolding(second.paragraph, 'a bold b'), 2, 6);
      second.activate();

      expect(second.button.getAttribute('data-blok-popover-item-active')).toBe('true');
      expect(first.button.hasAttribute('data-blok-popover-item-active')).toBe(false);
    });
  });

  describe('the document-level shortcut', () => {
    it('applies bold to a real selection inside the editor', () => {
      onAMac();

      const { paragraph } = mount('x bold y');

      select(textHolding(paragraph, 'x bold y'), 2, 6);
      document.dispatchEvent(boldShortcut());

      expect(paragraph.querySelector('strong')?.textContent).toBe('bold');
    });

    it('falls through to the browser at a collapsed caret', () => {
      onAMac();

      const { paragraph } = mount('x bold y');

      select(textHolding(paragraph, 'x bold y'), 2, 2);

      const event = boldShortcut();

      document.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(paragraph.querySelector('strong')).toBeNull();
    });

    it('ignores a selection outside any editor', () => {
      onAMac();
      mount('x bold y');

      const outside = document.createElement('div');

      outside.contentEditable = 'true';
      outside.textContent = 'a bold b';
      document.body.appendChild(outside);
      select(textHolding(outside, 'a bold b'), 2, 6);

      document.dispatchEvent(boldShortcut());

      expect(outside.querySelector('strong')).toBeNull();
    });

    it('registers its handler once however many tools are built', () => {
      const register = vi.spyOn(InlineToolEventManager.prototype, 'register');

      mount('a');
      mount('b');

      expect(register).toHaveBeenCalledTimes(1);
    });
  });
});
