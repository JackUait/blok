import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { SupSubInlineTool } from '../../../../src/components/inline-tools/inline-tool-sup-sub';
import { InlineToolEventManager } from '../../../../src/components/inline-tools/services/inline-tool-event-manager';
import { SelectionUtils } from '../../../../src/components/selection/index';
import { DATA_ATTR } from '../../../../src/components/constants';
import { IconSubscript, IconSuperscript } from '../../../../src/components/icons';

interface ModeItem {
  icon: string;
  name: string;
  title: string;
  closeOnActivate: boolean;
  isActive: () => boolean;
  onActivate: () => void;
}

interface SupSubMenu {
  isActive: () => boolean;
  children: {
    hideChevron: boolean;
    items: ModeItem[];
    onOpen: () => void;
    onClose: () => void;
  };
}

interface Harness {
  tool: SupSubInlineTool;
  menu: SupSubMenu;
  superscript: ModeItem;
  subscript: ModeItem;
  editor: HTMLElement;
  paragraph: HTMLElement;
}

const build = (html = 'x2 and y2'): Harness => {
  const editor = document.createElement('div');

  editor.setAttribute(DATA_ATTR.editor, '');

  const paragraph = document.createElement('div');

  paragraph.contentEditable = 'true';
  paragraph.innerHTML = html;
  editor.appendChild(paragraph);
  document.body.appendChild(editor);

  const tool = new SupSubInlineTool({
    api: { i18n: { t: (key: string) => key } } as never,
    config: undefined,
  });
  const menu = tool.render() as unknown as SupSubMenu;
  const [superscript, subscript] = menu.children.items;

  return { tool, menu, superscript, subscript, editor, paragraph };
};

const selectRange = (node: Node, start: number, end: number): void => {
  const range = document.createRange();

  range.setStart(node, start);
  range.setEnd(node, end);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};

const textOf = (root: Node, text: string): Text => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.textContent === text) {
      return node as Text;
    }
  }

  throw new Error(`no text node holding ${JSON.stringify(text)}`);
};

describe('SupSubInlineTool mutants', () => {
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

  describe('the two mode items', () => {
    it('offers superscript first and subscript second, each with its own icon and label', () => {
      const { superscript, subscript, menu } = build();

      expect(superscript.name).toBe('superscript');
      expect(superscript.icon).toBe(IconSuperscript);
      expect(superscript.title).toBe('tools.supSub.superscript');
      expect(subscript.name).toBe('subscript');
      expect(subscript.icon).toBe(IconSubscript);
      expect(subscript.title).toBe('tools.supSub.subscript');
      expect(menu.children.hideChevron).toBe(true);
    });

    it('closes the popover when a mode is picked', () => {
      const { superscript, subscript } = build();

      expect(superscript.closeOnActivate).toBe(true);
      expect(subscript.closeOnActivate).toBe(true);
    });

    it('reports the mode under the selection as active, and only that mode', () => {
      const { superscript, subscript, paragraph } = build('a<sup>2</sup>b');

      selectRange(textOf(paragraph, '2'), 0, 1);

      expect(superscript.isActive()).toBe(true);
      expect(subscript.isActive()).toBe(false);
    });

    it('reports no mode active with nothing selected', () => {
      const { superscript, subscript, menu } = build();

      window.getSelection()?.removeAllRanges();

      expect(superscript.isActive()).toBe(false);
      expect(subscript.isActive()).toBe(false);
      expect(menu.isActive()).toBe(false);
    });

    it('lights the toolbar button for either mode', () => {
      const superFixture = build('a<sup>2</sup>b');

      selectRange(textOf(superFixture.paragraph, '2'), 0, 1);
      expect(superFixture.menu.isActive()).toBe(true);

      document.body.innerHTML = '';

      const subFixture = build('a<sub>2</sub>b');

      selectRange(textOf(subFixture.paragraph, '2'), 0, 1);
      expect(subFixture.menu.isActive()).toBe(true);
    });
  });

  describe('applying a mode', () => {
    it('wraps the selected text in the mode tag', () => {
      const { superscript, paragraph } = build('x2');

      selectRange(textOf(paragraph, 'x2'), 1, 2);
      superscript.onActivate();

      expect(paragraph.querySelector('sup')?.textContent).toBe('2');
      expect(paragraph.textContent).toBe('x2');
    });

    it('removes the mode when it is already applied', () => {
      const { superscript, paragraph } = build('x<sup>2</sup>');

      selectRange(textOf(paragraph, '2'), 0, 1);
      superscript.onActivate();

      expect(paragraph.querySelector('sup')).toBeNull();
      expect(paragraph.textContent).toBe('x2');
    });

    it('replaces the opposite mode rather than nesting inside it', () => {
      const { subscript, paragraph } = build('x<sup>2</sup>');

      selectRange(textOf(paragraph, '2'), 0, 1);
      subscript.onActivate();

      expect(paragraph.querySelector('sup')).toBeNull();
      expect(paragraph.querySelector('sub')?.textContent).toBe('2');
    });

    it('does nothing with no selection at all', () => {
      const { superscript, paragraph } = build('x2');

      window.getSelection()?.removeAllRanges();

      expect(() => superscript.onActivate()).not.toThrow();
      expect(paragraph.querySelector('sup')).toBeNull();
    });
  });

  describe('a collapsed caret', () => {
    const putCaret = (node: Node, offset: number): void => selectRange(node, offset, offset);

    it('opens an empty mark at the caret', () => {
      const { superscript, paragraph } = build('x2');

      putCaret(textOf(paragraph, 'x2'), 1);
      superscript.onActivate();

      const mark = paragraph.querySelector('sup');

      expect(mark).not.toBeNull();
      expect(mark?.textContent).toBe('\u200B');
      expect(paragraph.querySelector('sub')).toBeNull();
    });

    it('leaves the opposite mark alone when the caret is in plain text', () => {
      const { subscript, paragraph } = build('x2');

      putCaret(textOf(paragraph, 'x2'), 1);
      subscript.onActivate();

      expect(paragraph.querySelector('sub')).not.toBeNull();
      expect(paragraph.querySelector('sup')).toBeNull();
    });

    it('steps out of the opposite mark before opening its own', () => {
      const { superscript, paragraph } = build('x<sub>2</sub>');

      putCaret(textOf(paragraph, '2'), 1);
      superscript.onActivate();

      const opened = paragraph.querySelector('sup');

      expect(opened).not.toBeNull();
      expect(opened?.closest('sub')).toBeNull();
    });

    it('steps out of its own mark rather than nesting', () => {
      const { superscript, paragraph } = build('x<sup>2</sup>');

      putCaret(textOf(paragraph, '2'), 1);
      superscript.onActivate();

      expect(paragraph.querySelectorAll('sup')).toHaveLength(1);
      expect(paragraph.textContent).toContain('\u200B');
    });
  });

  describe('the popover selection handshake', () => {
    it('paints and saves the selection when the popover opens', () => {
      const setFakeBackground = vi.spyOn(SelectionUtils.prototype, 'setFakeBackground')
        .mockImplementation(() => undefined);
      const save = vi.spyOn(SelectionUtils.prototype, 'save').mockImplementation(() => undefined);
      const { menu } = build();

      menu.children.onOpen();

      expect(setFakeBackground).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('unpaints, restores and forgets the selection when the popover closes', () => {
      const removeFakeBackground = vi.spyOn(SelectionUtils.prototype, 'removeFakeBackground')
        .mockImplementation(() => undefined);
      const restore = vi.spyOn(SelectionUtils.prototype, 'restore').mockImplementation(() => undefined);
      const clearSaved = vi.spyOn(SelectionUtils.prototype, 'clearSaved').mockImplementation(() => undefined);
      const { menu, paragraph } = build('x2');

      selectRange(textOf(paragraph, 'x2'), 1, 2);
      menu.children.onOpen();
      menu.children.onClose();

      expect(removeFakeBackground).toHaveBeenCalled();
      expect(restore).toHaveBeenCalledTimes(1);
      expect(clearSaved).toHaveBeenCalledTimes(1);
    });

    it('does not restore a selection that was never saved', () => {
      const restore = vi.spyOn(SelectionUtils.prototype, 'restore').mockImplementation(() => undefined);

      vi.spyOn(SelectionUtils.prototype, 'removeFakeBackground').mockImplementation(() => undefined);
      vi.spyOn(SelectionUtils.prototype, 'clearSaved').mockImplementation(() => undefined);

      const { menu } = build();

      menu.children.onClose();

      expect(restore).not.toHaveBeenCalled();
    });

    it('restores the saved selection before applying a mode', () => {
      const restore = vi.spyOn(SelectionUtils.prototype, 'restore');
      const clearSaved = vi.spyOn(SelectionUtils.prototype, 'clearSaved');

      vi.spyOn(SelectionUtils.prototype, 'setFakeBackground').mockImplementation(() => undefined);
      vi.spyOn(SelectionUtils.prototype, 'removeFakeBackground').mockImplementation(() => undefined);

      const { menu, superscript, paragraph } = build('x2');

      selectRange(textOf(paragraph, 'x2'), 1, 2);
      menu.children.onOpen();
      superscript.onActivate();

      expect(restore).toHaveBeenCalled();
      expect(clearSaved).toHaveBeenCalled();
      expect(paragraph.querySelector('sup')?.textContent).toBe('2');
    });

    it('leaves the selection alone when the popover never opened', () => {
      const restore = vi.spyOn(SelectionUtils.prototype, 'restore');
      const { superscript, paragraph } = build('x2');

      selectRange(textOf(paragraph, 'x2'), 1, 2);
      superscript.onActivate();

      expect(restore).not.toHaveBeenCalled();
    });
  });

  describe('the document-level shortcuts', () => {
    // The shared event manager reads navigator.userAgent to decide whether Cmd
    // or Ctrl is the primary modifier; jsdom reports neither platform.
    const onAMac = (): void => {
      vi.spyOn(window.navigator, 'userAgent', 'get')
        .mockReturnValue('mozilla/5.0 (macintosh; intel mac os x 10_15_7)');
    };

    it('registers one handler per mode', () => {
      build();

      const manager = InlineToolEventManager.getInstance();

      expect(manager.hasHandler('sup-sub:superscript')).toBe(true);
      expect(manager.hasHandler('sup-sub:subscript')).toBe(true);
    });

    it('applies the mode from a keystroke inside the editor', () => {
      onAMac();

      const { paragraph } = build('x2');

      selectRange(textOf(paragraph, 'x2'), 1, 2);
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: '.',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }));

      expect(paragraph.querySelector('sup')?.textContent).toBe('2');
    });

    it('registers each shortcut once however many tools are built', () => {
      const register = vi.spyOn(InlineToolEventManager.prototype, 'register');

      build();
      build();
      build();

      expect(register).toHaveBeenCalledTimes(2);
    });

    it('reads an element-anchored selection as inside the editor', () => {
      onAMac();

      const { paragraph, editor } = build('x2');

      selectRange(paragraph, 0, paragraph.childNodes.length);
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: '.',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }));

      expect(editor.querySelector('sup')).not.toBeNull();
    });

    it('ignores a keystroke outside any editor', () => {
      onAMac();
      build('x2');

      const outside = document.createElement('div');

      outside.contentEditable = 'true';
      outside.textContent = 'x2';
      document.body.appendChild(outside);
      selectRange(textOf(outside, 'x2'), 1, 2);

      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: '.',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }));

      expect(outside.querySelector('sup')).toBeNull();
    });
  });
});
