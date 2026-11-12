import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { IconAnnotation } from '../../../../src/components/icons';
import { AnnotationInlineTool } from '../../../../src/components/inline-tools/inline-tool-annotation';
import { PopoverItemType } from '../../../../src/components/utils/popover';
import type { PopoverItemHtmlParams } from '../../../../types/utils/popover';

const createMockApi = () => ({
  toolbar: {},
  inlineToolbar: { close: vi.fn() },
  notifier: {},
  i18n: { t: (key: string) => key },
  blocks: {},
  selection: {},
  caret: {},
  tools: {},
  config: {},
});

interface Menu {
  isActive: () => boolean;
  children: { items: PopoverItemHtmlParams[]; onOpen: () => void; onClose: () => void };
}

describe('AnnotationInlineTool', () => {
  let api: ReturnType<typeof createMockApi>;
  let container: HTMLDivElement;

  const create = (config?: unknown): { tool: AnnotationInlineTool; menu: Menu; ui: HTMLElement } => {
    const tool = new AnnotationInlineTool({ api: api as never, config: config as never });
    const menu = tool.render() as unknown as Menu;
    const ui = menu.children.items[0].element;

    document.body.appendChild(ui);

    return { tool, menu, ui };
  };

  const part = <T extends HTMLElement>(ui: HTMLElement, id: string): T => {
    const node = ui.querySelector<T>(`[data-blok-testid="inline-annotation-${id}"]`);

    if (node === null) {
      throw new Error(`inline-annotation-${id} is missing`);
    }

    return node;
  };

  /** Select the first occurrence of `text` inside the editable container. */
  const select = (text: string): void => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];

    while (walker.nextNode()) {
      nodes.push(walker.currentNode as Text);
    }

    const node = nodes.find(candidate => candidate.data.includes(text));

    if (node === undefined) {
      throw new Error(`"${text}" is not in one text node`);
    }

    const start = node.data.indexOf(text);
    const range = document.createRange();

    range.setStart(node, start);
    range.setEnd(node, start + text.length);

    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const caretIn = (element: Element): void => {
    const range = document.createRange();

    range.setStart(element.firstChild as Node, 1);
    range.collapse(true);

    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const type = (field: HTMLTextAreaElement | HTMLInputElement, value: string): void => {
    Object.assign(field, { value });
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    api = createMockApi();
    container = document.createElement('div');
    container.contentEditable = 'true';
    container.innerHTML = 'a phrase b';
    document.body.appendChild(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('is an inline tool named Hint that opens its own menu', () => {
    expect(AnnotationInlineTool.isInline).toBe(true);
    expect(AnnotationInlineTool.title).toBe('Hint');
    expect(AnnotationInlineTool.titleKey).toBe('annotation');
    expect(AnnotationInlineTool.replacesToolbar).toBe(true);
  });

  it('claims no span rule, so it cannot overwrite the equation rule', () => {
    expect(AnnotationInlineTool.sanitize).toEqual({});
  });

  it('renders a button with the card-over-dots icon and a menu holding its card', () => {
    const { tool } = create();
    const config = tool.render() as unknown as { icon: string; name: string; children: { items: PopoverItemHtmlParams[] } };

    expect(config.icon).toBe(IconAnnotation);
    expect(config.name).toBe('annotation');
    expect(config.children.items[0].type).toBe(PopoverItemType.Html);
  });

  describe('a new hint', () => {
    it('wraps the selected text on Done', () => {
      const { menu, ui } = create();

      select('phrase');
      menu.children.onOpen();
      type(part<HTMLTextAreaElement>(ui, 'text'), 'A quote');
      part(ui, 'done').click();

      expect(container.innerHTML).toBe('a <span data-blok-annotation="A quote">phrase</span> b');
      expect(api.inlineToolbar.close).toHaveBeenCalledTimes(1);
    });

    it('trims the text and keeps inner line breaks', () => {
      const { menu, ui } = create();

      select('phrase');
      menu.children.onOpen();
      type(part<HTMLTextAreaElement>(ui, 'text'), '  line one\nline two \n');
      part(ui, 'done').click();

      expect(container.querySelector('span')?.getAttribute('data-blok-annotation')).toBe('line one\nline two');
    });

    it('saves nothing when the text is empty', () => {
      const { menu, ui } = create();

      select('phrase');
      menu.children.onOpen();
      type(part<HTMLTextAreaElement>(ui, 'text'), '   ');
      part(ui, 'done').click();

      expect(container.innerHTML).toBe('a phrase b');
    });

    it('saves when the menu closes without Done', () => {
      const { menu, ui } = create();

      select('phrase');
      menu.children.onOpen();
      type(part<HTMLTextAreaElement>(ui, 'text'), 'A quote');
      menu.children.onClose();

      expect(container.innerHTML).toBe('a <span data-blok-annotation="A quote">phrase</span> b');
    });

    it('does not save twice when Done closes the menu', () => {
      const { menu, ui } = create();

      api.inlineToolbar.close.mockImplementation(() => menu.children.onClose());
      select('phrase');
      menu.children.onOpen();
      type(part<HTMLTextAreaElement>(ui, 'text'), 'A quote');
      part(ui, 'done').click();

      expect(container.querySelectorAll('span[data-blok-annotation]')).toHaveLength(1);
    });

    it('hides the remove button', () => {
      const { menu, ui } = create();

      select('phrase');
      menu.children.onOpen();

      expect(part(ui, 'remove').hidden).toBe(true);
    });

    it('replaces a hint the selection covers with one new hint', () => {
      container.innerHTML = 'a <span data-blok-annotation="Old">phrase</span> b';

      const { menu, ui } = create();
      const range = document.createRange();

      range.selectNodeContents(container);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      menu.children.onOpen();
      type(part<HTMLTextAreaElement>(ui, 'text'), 'New');
      part(ui, 'done').click();

      const hints = container.querySelectorAll('span[data-blok-annotation]');

      expect(hints).toHaveLength(1);
      expect(hints[0].getAttribute('data-blok-annotation')).toBe('New');
      expect(hints[0].textContent).toBe('a phrase b');
    });

    it('closes without a change when nothing is selected', () => {
      const { menu } = create();

      caretIn(container);
      menu.children.onOpen();

      expect(api.inlineToolbar.close).toHaveBeenCalledTimes(1);
      expect(container.innerHTML).toBe('a phrase b');
    });
  });

  describe('the subtitle', () => {
    it('is always shown, with no button to switch it', () => {
      const { menu, ui } = create();

      select('phrase');
      menu.children.onOpen();

      const subtitle = part<HTMLInputElement>(ui, 'subtitle');

      expect(ui.querySelector('[data-blok-testid="inline-annotation-subtitle-toggle"]')).toBeNull();
      expect(subtitle.hidden).toBe(false);
      expect(subtitle.style.display).toBe('');
      expect(subtitle.value).toBe('');
    });

    it('opens pre-filled with the configured default on a new hint', () => {
      const { menu, ui } = create({ defaultSubtitle: '  From the team interview ' });

      select('phrase');
      menu.children.onOpen();

      expect(part<HTMLInputElement>(ui, 'subtitle').value).toBe('From the team interview');
      expect(part(ui, 'text')).toHaveFocus();
    });

    it('opens empty when the configured default is not a string', () => {
      const { menu, ui } = create({ defaultSubtitle: 5 });

      select('phrase');
      menu.children.onOpen();

      expect(part<HTMLInputElement>(ui, 'subtitle').value).toBe('');
    });

    it('is saved next to the text', () => {
      const { menu, ui } = create({ defaultSubtitle: 'Anna' });

      select('phrase');
      menu.children.onOpen();
      type(part<HTMLTextAreaElement>(ui, 'text'), 'A quote');
      part(ui, 'done').click();

      expect(container.innerHTML)
        .toBe('a <span data-blok-annotation="A quote" data-blok-annotation-subtitle="Anna">phrase</span> b');
    });

    it('is not saved when left empty or cleared', () => {
      const { menu, ui } = create({ defaultSubtitle: 'Anna' });

      select('phrase');
      menu.children.onOpen();
      type(part<HTMLTextAreaElement>(ui, 'text'), 'A quote');
      type(part<HTMLInputElement>(ui, 'subtitle'), '  ');
      part(ui, 'done').click();

      expect(container.innerHTML).toBe('a <span data-blok-annotation="A quote">phrase</span> b');
    });

    it('fits the text field to one line at first', () => {
      const { ui } = create();

      expect(part<HTMLTextAreaElement>(ui, 'text').rows).toBe(1);
    });
  });

  describe('an existing hint', () => {
    beforeEach(() => {
      container.innerHTML = 'a <span data-blok-annotation="A quote" data-blok-annotation-subtitle="Anna">phrase</span> b';
    });

    const openOnHint = (config?: unknown): { menu: Menu; ui: HTMLElement } => {
      const made = create(config);

      caretIn(container.querySelector('span') as Element);
      made.menu.children.onOpen();

      return made;
    };

    it('is active under the caret', () => {
      const { menu } = create();

      caretIn(container.querySelector('span') as Element);

      expect(menu.isActive()).toBe(true);

      caretIn(container);

      expect(menu.isActive()).toBe(false);
    });

    it('opens with its text and subtitle', () => {
      const { ui } = openOnHint({ defaultSubtitle: 'Ignored' });

      expect(part<HTMLTextAreaElement>(ui, 'text').value).toBe('A quote');
      expect(part<HTMLInputElement>(ui, 'subtitle').value).toBe('Anna');
      expect(part(ui, 'remove').hidden).toBe(false);
    });

    it('does not take the default subtitle when it has none', () => {
      container.innerHTML = 'a <span data-blok-annotation="A quote">phrase</span> b';

      const { ui } = openOnHint({ defaultSubtitle: 'Ignored' });

      expect(part<HTMLInputElement>(ui, 'subtitle').value).toBe('');
    });

    it('updates the same span in place', () => {
      const span = container.querySelector('span');
      const { ui } = openOnHint();

      type(part<HTMLTextAreaElement>(ui, 'text'), 'Another quote');
      type(part<HTMLInputElement>(ui, 'subtitle'), '');
      part(ui, 'done').click();

      expect(container.innerHTML).toBe('a <span data-blok-annotation="Another quote">phrase</span> b');
      expect(container.querySelector('span')).toBe(span);
    });

    it('is removed when its text is emptied', () => {
      const { ui } = openOnHint();

      type(part<HTMLTextAreaElement>(ui, 'text'), '');
      part(ui, 'done').click();

      expect(container.innerHTML).toBe('a phrase b');
    });

    it('is removed by the remove button, and closing does not bring it back', () => {
      const { menu, ui } = openOnHint();

      part(ui, 'remove').click();
      menu.children.onClose();

      expect(container.innerHTML).toBe('a phrase b');
      expect(api.inlineToolbar.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('keyboard', () => {
    const openNew = (): HTMLElement => {
      const { menu, ui } = create();

      select('phrase');
      menu.children.onOpen();
      type(part<HTMLTextAreaElement>(ui, 'text'), 'A quote');

      return ui;
    };

    it.each([ { metaKey: true }, { ctrlKey: true } ])('saves on Enter with %o', (modifier) => {
      const ui = openNew();

      part(ui, 'text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...modifier }));

      expect(container.querySelector('span[data-blok-annotation]')).not.toBeNull();
    });

    it('keeps a plain Enter in the text as a line break', () => {
      const ui = openNew();
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });

      part(ui, 'text').dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(container.querySelector('span[data-blok-annotation]')).toBeNull();
    });

    it('saves on Enter in the subtitle', () => {
      const ui = openNew();

      part(ui, 'subtitle').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

      expect(container.querySelector('span[data-blok-annotation]')).not.toBeNull();
    });
  });
});
