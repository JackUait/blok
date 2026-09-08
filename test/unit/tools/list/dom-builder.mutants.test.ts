import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  LIST_TEST_IDS,
  applyChecklistCheckedState,
  buildChecklistContent,
  buildListItem,
  buildSemanticListHtml,
  buildStandardContent,
  buildWrapper,
  createMarker,
  setPlaceholder,
  type DOMBuilderContext,
  type PlaceholderElement,
  type SemanticListItem,
} from '../../../../src/tools/list/dom-builder';
import type { ListItemData } from '../../../../src/tools/list/types';

const context = (data: Partial<ListItemData>, extra: Partial<DOMBuilderContext> = {}): DOMBuilderContext => ({
  data: { text: '', style: 'unordered', ...data },
  readOnly: false,
  placeholder: 'List item',
  ...extra,
});

const idSuffix = (el: Element | null): number => Number(el?.id.replace('blok-checklist-item-', ''));

/**
 * Nine mutants survive here, and every one is inert for a stated reason:
 *
 * - the four `if (itemColor)` / `if (itemSize)` guards forced true: the value is
 *   then `undefined`, and CSSOM rejects `undefined` as a property value, so the
 *   style stays unset exactly as if the branch had been skipped.
 * - the four `'always'` arguments blanked: getPlaceholderClasses falls through
 *   `default` to the same array it returns for `'always'`.
 * - the literal `'flex'` blanked on the standard row: LIST_ITEM_ROW_CLASSES
 *   already carries `flex`, so twMerge produces the same class list.
 * - the filler `<li>` in buildSemanticListHtml: a level's owning item is
 *   appended immediately after the level is created, so `lastItem` is never null
 *   by the time a deeper item looks for an anchor.
 */
describe('list dom-builder mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('applyChecklistCheckedState', () => {
    it('tolerates a missing checkbox', () => {
      const content = document.createElement('div');

      expect(() => applyChecklistCheckedState(null, content, true)).not.toThrow();
      expect(content.getAttribute('data-checked')).toBe('true');
    });
  });

  describe('setPlaceholder', () => {
    it('installs a getter that cannot be reassigned, redefined or hidden', () => {
      const el: HTMLElement = document.createElement('div');

      setPlaceholder(el, 'Type here');

      const descriptor = Object.getOwnPropertyDescriptor(el, 'getPlaceholder');

      expect(descriptor?.writable).toBe(false);
      expect(descriptor?.enumerable).toBe(true);
      expect(descriptor?.configurable).toBe(false);
      expect((el as PlaceholderElement).getPlaceholder()).toBe('Type here');
    });
  });

  describe('buildWrapper', () => {
    it('announces itself as a list and records style and depth', () => {
      const wrapper = buildWrapper(context({ style: 'ordered', depth: 2 }));

      expect(wrapper.getAttribute('role')).toBe('list');
      expect(wrapper.getAttribute('data-list-style')).toBe('ordered');
      expect(wrapper.getAttribute('data-list-depth')).toBe('2');
    });

    it('records a start value only when it is not the implicit one', () => {
      expect(buildWrapper(context({ style: 'ordered' })).hasAttribute('data-list-start')).toBe(false);
      expect(buildWrapper(context({ style: 'ordered', start: 1 })).hasAttribute('data-list-start')).toBe(false);
      expect(buildWrapper(context({ style: 'ordered', start: 7 })).getAttribute('data-list-start')).toBe('7');
    });
  });

  describe('buildStandardContent', () => {
    it('leaves the indent unset at the root depth', () => {
      const item = buildStandardContent(context({ depth: 0 }));

      expect(item.style.marginLeft).toBe('');
      expect(item.style.color).toBe('');
      expect(item.style.fontSize).toBe('');
    });

    it('indents by the ordered step for ordered items and the plain step otherwise', () => {
      expect(buildStandardContent(context({ style: 'ordered', depth: 2 })).style.marginLeft).not.toBe('');
      expect(buildStandardContent(context({ style: 'unordered', depth: 2 })).style.marginLeft)
        .not.toBe(buildStandardContent(context({ style: 'ordered', depth: 2 })).style.marginLeft);
    });

    it('applies the configured colour and size', () => {
      const item = buildStandardContent(context({}, { itemColor: 'rgb(1, 2, 3)', itemSize: '20px' }));

      expect(item.style.color).toBe('rgb(1, 2, 3)');
      expect(item.style.fontSize).toBe('20px');
    });

    it('marks itself a list item and stores the placeholder on the content cell', () => {
      const item = buildStandardContent(context({ text: 'hi' }));
      const content = item.querySelector<PlaceholderElement>(`[data-blok-testid="${LIST_TEST_IDS.contentContainer}"]`);

      expect(item.getAttribute('role')).toBe('listitem');
      expect(item.classList.contains('flex')).toBe(true);
      expect(content?.classList.contains('outline-hidden')).toBe(true);
      expect(content?.innerHTML).toBe('hi');
      expect(content?.contentEditable).toBe('true');
      expect(content?.getPlaceholder()).toBe('List item');
    });
  });

  describe('buildChecklistContent', () => {
    it('leaves the indent unset at the root depth', () => {
      const wrapper = buildChecklistContent(context({ style: 'checklist', depth: 0 }));

      expect(wrapper.style.marginLeft).toBe('');
      expect(wrapper.getAttribute('role')).toBe('listitem');
    });

    it('applies the configured colour and size', () => {
      const wrapper = buildChecklistContent(context({ style: 'checklist' }, { itemColor: 'rgb(4, 5, 6)', itemSize: '18px' }));

      expect(wrapper.style.color).toBe('rgb(4, 5, 6)');
      expect(wrapper.style.fontSize).toBe('18px');
    });

    it('labels the checkbox with the text it belongs to, and keeps ids climbing', () => {
      const first = buildChecklistContent(context({ style: 'checklist', text: 'a' }));
      const second = buildChecklistContent(context({ style: 'checklist', text: 'b' }));

      const firstContent = first.querySelector(`[data-blok-testid="${LIST_TEST_IDS.checklistContent}"]`);
      const secondContent = second.querySelector(`[data-blok-testid="${LIST_TEST_IDS.checklistContent}"]`);
      const firstBox = first.querySelector('input[type="checkbox"]');

      expect(firstBox?.getAttribute('aria-labelledby')).toBe(firstContent?.id);
      expect(idSuffix(secondContent)).toBeGreaterThan(idSuffix(firstContent));
    });

    it('makes the content editable and stores its placeholder', () => {
      const wrapper = buildChecklistContent(context({ style: 'checklist', text: 'todo' }));
      const content = wrapper.querySelector<PlaceholderElement>(`[data-blok-testid="${LIST_TEST_IDS.checklistContent}"]`);

      expect(content?.contentEditable).toBe('true');
      expect(content?.innerHTML).toBe('todo');
      expect(content?.getPlaceholder()).toBe('List item');
    });

    it('is not editable and its control is disabled in read-only mode', () => {
      const wrapper = buildChecklistContent(context({ style: 'checklist' }, { readOnly: true }));

      expect(wrapper.querySelector('input[type="checkbox"]')?.hasAttribute('disabled')).toBe(true);
      expect(wrapper.querySelector<HTMLElement>(`[data-blok-testid="${LIST_TEST_IDS.checklistContent}"]`)?.contentEditable)
        .toBe('false');
    });

    // Checking an item may only ADD the strike-through pair; nothing else about
    // the text cell's classes is allowed to move.
    it('differs from an unchecked item by exactly the checked classes', () => {
      const classesOf = (checked: boolean): string[] => {
        const cell = buildChecklistContent(context({ style: 'checklist', checked }))
          .querySelector(`[data-blok-testid="${LIST_TEST_IDS.checklistContent}"]`);

        return Array.from(cell?.classList ?? []);
      };

      const unchecked = classesOf(false);
      const checked = classesOf(true);

      expect(checked.filter((cls) => !unchecked.includes(cls))).toStrictEqual(['line-through', 'opacity-60']);
      expect(unchecked.filter((cls) => !checked.includes(cls))).toStrictEqual([]);
      expect(unchecked).toContain('outline-hidden');
    });

    it('records the checked state on both the control and the text', () => {
      const wrapper = buildChecklistContent(context({ style: 'checklist', checked: true }));
      const box = wrapper.querySelector<HTMLInputElement>('input[type="checkbox"]');
      const content = wrapper.querySelector(`[data-blok-testid="${LIST_TEST_IDS.checklistContent}"]`);

      expect(box?.checked).toBe(true);
      expect(box?.getAttribute('data-state')).toBe('checked');
      expect(content?.getAttribute('data-checked')).toBe('true');
    });
  });

  describe('buildListItem', () => {
    it('hands back the checklist text cell, not the row', () => {
      const built = buildListItem(context({ style: 'checklist', text: 'x' }));

      expect(built.contentElement.getAttribute('data-blok-testid')).toBe(LIST_TEST_IDS.checklistContent);
      expect(built.checkboxElement).not.toBeNull();
      expect(built.markerElement).toBeNull();
    });

    it('hands back the standard text cell for every other style', () => {
      const built = buildListItem(context({ style: 'unordered', text: 'x' }));

      expect(built.contentElement.getAttribute('data-blok-testid')).toBe(LIST_TEST_IDS.contentContainer);
      expect(built.checkboxElement).toBeNull();
      expect(built.markerElement).not.toBeNull();
    });
  });

  describe('createMarker', () => {
    it('gives the ordered marker its own right-aligned gutter', () => {
      const marker = createMarker('ordered', 0);

      expect(marker.textContent).toBe('1.');
      expect(marker.className).toBe('shrink-0 select-none text-right');
      expect(marker.style.paddingRight).toBe('0.6875em');
    });

    it('gives the bullet marker a centred em-relative box', () => {
      const marker = createMarker('unordered', 0);

      expect(marker.textContent).toBe('•');
      expect(marker.className).toBe('shrink-0 select-none w-[1em] text-center flex justify-center');
      expect(marker.style.fontSize).toBe('1.5em');
    });
  });

  describe('buildSemanticListHtml', () => {
    const item = (text: string, style: SemanticListItem['style'], depth = 0): SemanticListItem =>
      ({ text, style, depth });

    it('clamps a first item that claims to be nested', () => {
      const container = buildSemanticListHtml([item('a', 'unordered', 1)]);

      expect(container.innerHTML).toBe('<ul><li>a</li></ul>');
    });

    it('wraps a checklist item in a label rather than an id pairing', () => {
      const container = buildSemanticListHtml([item('a', 'checklist')]);

      expect(container.innerHTML).toBe('<ul><li><label><input type="checkbox"><span>a</span></label></li></ul>');
    });

    it('opens a new list when the style changes at the same depth', () => {
      const container = buildSemanticListHtml([item('a', 'unordered'), item('b', 'ordered')]);

      expect(container.innerHTML).toBe('<ul><li>a</li></ul><ol><li>b</li></ol>');
    });

    // Coming back out to depth 0 must CLOSE the deeper level, otherwise the next
    // item is allowed to nest from a level that is no longer open.
    it('closes deeper levels when the depth drops', () => {
      const container = buildSemanticListHtml([
        item('a', 'unordered', 0),
        item('b', 'unordered', 1),
        item('c', 'unordered', 0),
        item('d', 'unordered', 2),
      ]);

      expect(container.innerHTML)
        .toBe('<ul><li>a<ul><li>b</li></ul></li><li>c<ul><li>d</li></ul></li></ul>');
    });
  });
});
