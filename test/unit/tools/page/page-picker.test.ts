import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { popovers, MockPopover } = vi.hoisted(() => {
  type Params = {
    items: Array<{ element?: HTMLElement }>;
    listbox?: boolean;
    listboxId?: string;
  };
  const instances: Array<{
    params: Params;
    closeFromOutside: () => void;
    preserveRootOnDestroy: boolean;
  }> = [];

  class PopoverDouble {
    public readonly params: Params;
    private root: HTMLElement | null = null;
    private closed: (() => void) | null = null;
    public preserveRootOnDestroy = false;

    constructor(params: Params) {
      this.params = params;
      instances.push(this);
    }

    show(): void {
      const root = document.createElement('div');
      const list = document.createElement('div');

      list.setAttribute('role', this.params.listbox === true ? 'listbox' : 'menu');
      if (this.params.listboxId !== undefined) {
        list.id = this.params.listboxId;
      }
      this.params.items.forEach((item) => {
        if (item.element !== undefined) {
          list.append(item.element);
        }
      });
      root.append(list);
      document.body.append(root);
      this.root = root;
    }

    on(_event: string, callback: () => void): void {
      this.closed = callback;
    }

    closeFromOutside(): void {
      this.closed?.();
    }

    destroy(): void {
      if (!this.preserveRootOnDestroy) {
        this.root?.remove();
      }
      this.root = null;
    }
  }

  return { popovers: instances, MockPopover: PopoverDouble };
});

vi.mock('../../../../src/components/utils/popover', () => ({
  PopoverDesktop: MockPopover,
}));

import { PagePicker } from '../../../../src/tools/page/page-picker';

describe('PagePicker', () => {
  let anchor: HTMLElement;
  let picker: PagePicker;
  let onPick: ReturnType<typeof vi.fn<(pageId: string) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    popovers.length = 0;
    anchor = document.createElement('div');
    anchor.contentEditable = 'true';
    anchor.tabIndex = 0;
    document.body.append(anchor);
    onPick = vi.fn<(pageId: string) => void>();
    picker = new PagePicker('Pages', 'Page');
  });

  afterEach(() => {
    picker.close();
    anchor.remove();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('exposes a labelled listbox whose first real option is the active descendant', () => {
    picker.open('road', anchor, onPick);
    picker.setResults([{ pageId: 'p1', title: 'Roadmap' }, { pageId: 'p2', title: 'Roadwork' }]);

    const list = document.querySelector<HTMLElement>('[role="listbox"]');
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));

    expect(list?.getAttribute('aria-label')).toBe('Pages');
    expect(options.map((option) => option.textContent)).toEqual(['Roadmap', 'Roadwork']);
    expect(anchor.getAttribute('aria-controls')).toBe(list?.id);
    expect(anchor.getAttribute('aria-activedescendant')).toBe(options[0]?.id);
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('moves the active descendant with arrows and commits that option on Enter', () => {
    picker.open('road', anchor, onPick);
    picker.setResults([{ pageId: 'p1', title: 'Roadmap' }, { pageId: 'p2', title: 'Roadwork' }]);
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));

    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });

    expect(picker.handleKeydown(down)).toBe(true);
    expect(down.defaultPrevented).toBe(true);
    expect(anchor.getAttribute('aria-activedescendant')).toBe(options[1]?.id);
    expect(options[1]?.getAttribute('aria-selected')).toBe('true');
    expect(options[0]?.getAttribute('aria-selected')).toBe('false');

    expect(picker.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))).toBe(true);
    expect(onPick).toHaveBeenCalledExactlyOnceWith('p2');
  });

  it.each(['Enter', 'ArrowDown', 'ArrowUp', 'Home', 'End'])(
    'claims %s while the page list is empty',
    (key) => {
      picker.open('missing', anchor, onPick);
      picker.setResults([]);
      const event = new KeyboardEvent('keydown', { key, cancelable: true });

      expect(picker.handleKeydown(event)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      expect(picker.opened).toBe(true);
      expect(onPick).not.toHaveBeenCalled();
    }
  );

  it('shows a focus ring only after keyboard navigation', () => {
    picker.open('', anchor, onPick);
    picker.setResults([{ pageId: 'p1', title: 'One' }, { pageId: 'p2', title: 'Two' }]);
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));

    expect(options[0]?.style.outline).toBe('');
    expect(options[1]?.style.outline).toBe('');
    picker.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    expect(options[0]?.style.outline).toBe('');
    expect(options[1]?.style.outline).toContain('var(--blok-focus-ring)');
  });

  it('does not give the highlighted row a blue fill or different ink', () => {
    picker.open('', anchor, onPick);
    picker.setResults([{ pageId: 'p1', title: 'One' }, { pageId: 'p2', title: 'Two' }]);
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));

    expect(options[0]?.style.backgroundColor).toBe('');
    expect(options[0]?.style.color).toBe(options[1]?.style.color);
  });

  it('does not paint or select malformed and inaccessible results', () => {
    picker.open('', anchor, onPick);
    picker.setResults([
      { pageId: 'secret', title: 'Secret', access: 'none' },
      { pageId: '', title: 'Broken' },
      { pageId: 'p1', title: 'Roadmap' },
    ]);

    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(document.body.textContent).not.toContain('Secret');
    expect(document.body.textContent).not.toContain('Broken');
  });

  it('drops results with malformed access or title values', () => {
    picker.open('', anchor, onPick);
    picker.setResults([
      { pageId: 'bad-access', title: 'Hidden', access: 42 },
      { pageId: 'bad-title', title: { text: 'Wrong' } },
      { pageId: 'p1', title: 'Roadmap' },
    ]);

    expect(Array.from(document.querySelectorAll('[role="option"]')).map((option) => option.textContent)).toEqual(['Roadmap']);
  });

  it('commits a pointer-selected option without moving editor focus', () => {
    picker.open('road', anchor, onPick);
    picker.setResults([{ pageId: 'p1', title: 'Roadmap' }]);
    anchor.focus();
    const option = document.querySelector<HTMLElement>('[role="option"]');

    const pointerDown = new Event('pointerdown', { bubbles: true, cancelable: true });

    option?.dispatchEvent(pointerDown);
    option?.click();

    expect(pointerDown.defaultPrevented).toBe(true);
    expect(onPick).toHaveBeenCalledExactlyOnceWith('p1');
    expect(anchor).toHaveFocus();
  });

  it('closes on Escape without touching a second layer', () => {
    picker.open('', anchor, onPick);
    const otherLayer = document.createElement('div');

    otherLayer.setAttribute('data-blok-other-layer', '');
    document.body.append(otherLayer);

    expect(picker.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe(true);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(otherLayer.isConnected).toBe(true);
    expect(anchor.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('lets Tab leave the editor and ignores IME keydown', () => {
    picker.open('', anchor, onPick);
    picker.setResults([{ pageId: 'p1', title: 'Roadmap' }]);
    const composing = new KeyboardEvent('keydown', { key: 'ArrowDown', isComposing: true, cancelable: true });

    expect(picker.handleKeydown(composing)).toBe(false);
    expect(composing.defaultPrevented).toBe(false);

    const tab = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });

    expect(picker.handleKeydown(tab)).toBe(false);
    expect(tab.defaultPrevented).toBe(false);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('clears sensitive option text while the popover exit animation is pending', () => {
    picker.open('', anchor, onPick);
    picker.setResults([{ pageId: 'p1', title: 'Secret' }]);
    if (popovers[0] === undefined) {
      throw new Error('missing popover');
    }
    popovers[0].preserveRootOnDestroy = true;

    picker.close();

    expect(document.body.textContent).not.toContain('Secret');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('restores existing editor semantics after close', () => {
    anchor.setAttribute('role', 'textbox');
    anchor.setAttribute('aria-label', 'Document body');
    anchor.setAttribute('aria-controls', 'existing-controls');
    picker.open('', anchor, onPick);

    picker.close();

    expect(anchor.getAttribute('role')).toBe('textbox');
    expect(anchor.getAttribute('aria-label')).toBe('Document body');
    expect(anchor.getAttribute('aria-controls')).toBe('existing-controls');
  });

  it('releases combobox attributes when the popover closes from outside', () => {
    picker.open('', anchor, onPick);
    expect(popovers).toHaveLength(1);

    popovers[0]?.closeFromOutside();

    expect(anchor.hasAttribute('aria-controls')).toBe(false);
    expect(anchor.hasAttribute('aria-expanded')).toBe(false);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });
});
