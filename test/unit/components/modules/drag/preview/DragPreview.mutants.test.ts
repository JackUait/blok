import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { Block } from '../../../../../../src/components/block';
import { DragPreview } from '../../../../../../src/components/modules/drag/preview/DragPreview';
import type * as DragConstantsModule from '../../../../../../src/components/modules/drag/utils/drag.constants';
import { DRAG_CONFIG } from '../../../../../../src/components/modules/drag/utils/drag.constants';

/**
 * Mutants proven equivalent, with the argument for each:
 *
 * - OptionalChaining at line 61 (`block?.contentIds?.length` losing its second
 *   `?.`): the leading `?.` is untouched, and it short-circuits the WHOLE chain
 *   when `block` is undefined, so the second link is only ever evaluated on a
 *   real Block. `Block.contentIds` is declared `string[]`, the constructor
 *   assigns `Array.isArray(contentIds) ? [...contentIds] : []` unconditionally,
 *   and every other write in src assigns an array too — it is never nullish, so
 *   the second `?.` cannot short-circuit.
 *
 * Two things make the remaining mutants visible. jsdom has no layout, so every rect the
 * preview measures is stubbed; and the CSSOM drops an invalid declaration, so a
 * mutant that computes NaN leaves the style at `''` rather than writing garbage.
 *
 * The real `previewOffsetY` is 0, which would make `clientY + offset` and
 * `clientY - offset` indistinguishable. The constants module is a dependency,
 * so the offset is mocked to a non-zero value and the sign becomes observable.
 */
vi.mock('../../../../../../src/components/modules/drag/utils/drag.constants', async (importOriginal) => {
  const actual = await importOriginal<typeof DragConstantsModule>();

  return {
    ...actual,
    DRAG_CONFIG: { ...actual.DRAG_CONFIG, previewOffsetY: 7 },
  };
});

const classTokens = (element: HTMLElement): string[] =>
  element.className.split(/\s+/).filter((token) => token !== '').sort();

const firstChildOf = (element: Element): HTMLElement => {
  const child = element.firstElementChild;

  if (!(child instanceof HTMLElement)) {
    throw new Error('expected an element child');
  }

  return child;
};

const queryOne = (root: Element, selector: string): HTMLElement => {
  const found = root.querySelector(selector);

  if (!(found instanceof HTMLElement)) {
    throw new Error(`expected ${selector} to match an element`);
  }

  return found;
};

const setRect = (element: Element, width: number, height: number): void => {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, width, height));
};

interface MultiBlockSpec {
  holderHeight: number;
  contentWidth?: number;
  contentHeight?: number;
  stretched?: boolean;
  withContent?: boolean;
  toolClass?: string;
}

const makeMultiBlock = (spec: MultiBlockSpec): Block => {
  const holder = document.createElement('div');

  setRect(holder, 0, spec.holderHeight);

  if (spec.withContent !== false) {
    const content = document.createElement('div');

    content.setAttribute('data-blok-element-content', '');

    if (spec.toolClass !== undefined) {
      const tool = document.createElement('p');

      tool.className = spec.toolClass;
      content.appendChild(tool);
    }

    holder.appendChild(content);
    setRect(content, spec.contentWidth ?? 0, spec.contentHeight ?? 0);
  }

  return {
    holder,
    stretched: spec.stretched ?? false,
  } as unknown as Block;
};

describe('DragPreview — recorded mutants', () => {
  let dragPreview: DragPreview;

  beforeEach(() => {
    vi.clearAllMocks();
    dragPreview = new DragPreview();
  });

  afterEach(() => {
    dragPreview.destroy();
    vi.restoreAllMocks();
  });

  describe('createSingle', () => {
    it('stamps the host attributes the body-mounted ghost needs', () => {
      const preview = dragPreview.createSingle(document.createElement('div'), false);

      expect(preview.getAttribute('data-blok-testid')).toBe('drag-preview');
      expect(preview.getAttribute('data-blok-interface')).toBe('drag-preview');
      expect(preview.getAttribute('aria-hidden')).toBe('true');
      expect(preview.getAttribute('inert')).toBe('');
    });

    it('keeps the content width cap on a normal block', () => {
      const preview = dragPreview.createSingle(document.createElement('div'), false);

      expect(classTokens(firstChildOf(preview))).toEqual(['max-w-blok-content', 'mx-auto', 'relative']);
    });

    it('lifts the content width cap on a stretched block', () => {
      const preview = dragPreview.createSingle(document.createElement('div'), true);

      expect(classTokens(firstChildOf(preview))).toEqual(['max-w-none', 'mx-auto', 'relative']);
    });

    it('leaves the clone width unset when the source has no measurable box', () => {
      const preview = dragPreview.createSingle(document.createElement('div'), false);

      expect(firstChildOf(preview).style.width).toBe('');
    });

    it('pins an explicit clone width when the source has one', () => {
      const content = document.createElement('div');

      setRect(content, 240, 80);

      const preview = dragPreview.createSingle(content, false);

      expect(firstChildOf(preview).style.width).toBe('240px');
    });

    it('zeroes the margin on the cloned tool element', () => {
      const content = document.createElement('div');
      const tool = document.createElement('p');

      tool.className = 'mt-4';
      content.appendChild(tool);

      const preview = dragPreview.createSingle(content, false);

      expect(classTokens(firstChildOf(firstChildOf(preview)))).toContain('m-0!');
    });

    it('badges a block that carries hidden children', () => {
      const block = { contentIds: ['one', 'two'] } as unknown as Block;
      const preview = dragPreview.createSingle(document.createElement('div'), false, block);
      const badge = queryOne(preview, '[data-blok-children-badge]');

      expect(badge.getAttribute('data-blok-children-badge')).toBe('');
      expect(badge.textContent).toBe('+2');
      expect(classTokens(badge)).toEqual([
        'absolute',
        'bg-white/80',
        'bottom-1',
        'px-1',
        'right-1',
        'rounded',
        'text-gray-400',
        'text-xs',
      ]);
    });
  });

  describe('createMulti', () => {
    it('stamps the host attributes the body-mounted ghost needs', () => {
      const preview = dragPreview.createMulti([makeMultiBlock({ holderHeight: 40 })]);

      expect(preview.getAttribute('data-blok-testid')).toBe('drag-preview');
      expect(preview.getAttribute('data-blok-interface')).toBe('drag-preview');
      expect(preview.getAttribute('aria-hidden')).toBe('true');
      expect(preview.getAttribute('inert')).toBe('');
    });

    it('collapses to nothing when there are no blocks', () => {
      const preview = dragPreview.createMulti([]);

      expect(preview.style.width).toBe('0px');
      expect(preview.style.height).toBe('0px');
    });

    it('sizes itself to a single block', () => {
      const preview = dragPreview.createMulti([
        makeMultiBlock({ holderHeight: 40, contentWidth: 100, contentHeight: 30 }),
      ]);

      expect(preview.style.width).toBe('100px');
      expect(preview.style.height).toBe('30px');
    });

    it('stacks later blocks by the holder heights above them', () => {
      const preview = dragPreview.createMulti([
        makeMultiBlock({ holderHeight: 40, contentWidth: 100, contentHeight: 30 }),
        makeMultiBlock({ holderHeight: 50, contentWidth: 60, contentHeight: 20 }),
      ]);

      const first = firstChildOf(preview);
      const second = preview.children[1];

      expect(first.style.position).toBe('absolute');
      expect(first.style.left).toBe('0px');
      expect(first.style.top).toBe('0px');
      expect(first.style.zIndex).toBe('2');

      if (!(second instanceof HTMLElement)) {
        throw new Error('expected a second clone');
      }

      expect(second.style.top).toBe('40px');
      expect(preview.style.width).toBe('100px');
      expect(preview.style.height).toBe('60px');
    });

    it('treats a block with no content element as taking no room', () => {
      const preview = dragPreview.createMulti([
        makeMultiBlock({ holderHeight: 40, withContent: false }),
        makeMultiBlock({ holderHeight: 50, contentWidth: 60, contentHeight: 20 }),
      ]);

      expect(preview.children).toHaveLength(1);
      expect(firstChildOf(preview).style.top).toBe('0px');
      expect(preview.style.width).toBe('60px');
      expect(preview.style.height).toBe('20px');
    });

    it('keeps the content width cap on a normal block', () => {
      const preview = dragPreview.createMulti([
        makeMultiBlock({ holderHeight: 40, contentWidth: 100, contentHeight: 30 }),
      ]);

      expect(classTokens(firstChildOf(preview))).toEqual(['max-w-blok-content', 'mx-auto', 'relative']);
    });

    it('lifts the content width cap on a stretched block', () => {
      const preview = dragPreview.createMulti([
        makeMultiBlock({ holderHeight: 40, contentWidth: 100, contentHeight: 30, stretched: true }),
      ]);

      expect(classTokens(firstChildOf(preview))).toEqual(['max-w-none', 'mx-auto', 'relative']);
    });

    it('zeroes the margin on each cloned tool element', () => {
      const preview = dragPreview.createMulti([
        makeMultiBlock({ holderHeight: 40, contentWidth: 100, contentHeight: 30, toolClass: 'mt-4' }),
      ]);

      expect(classTokens(firstChildOf(firstChildOf(preview)))).toContain('m-0!');
    });
  });

  describe('updatePosition', () => {
    it('offsets the ghost away from the cursor on both axes', () => {
      dragPreview.createSingle(document.createElement('div'), false);
      dragPreview.updatePosition(100, 200);

      const element = dragPreview.getElement();

      if (element === null) {
        throw new Error('expected a preview element');
      }

      expect(element.style.left).toBe(`${100 + DRAG_CONFIG.previewOffsetX}px`);
      expect(element.style.top).toBe(`${200 + DRAG_CONFIG.previewOffsetY}px`);
    });
  });
});
