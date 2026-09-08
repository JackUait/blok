/**
 * Mutation-targeted tests for popover-item-html.ts.
 *
 * Equivalence proofs for the mutants that stay alive on purpose:
 *
 * - `nodes = { root: null }` -> `nodes = {}`.
 *   The field initializer runs, then the constructor immediately overwrites
 *   `nodes.root` with the element `createRootElement` returns. Nothing reads
 *   the field in between, and no code asks whether the `root` key exists.
 *
 * - `isHidden = false` -> `true`.
 *   `isHidden` is read in exactly one place, `updateRootClasses`, which is
 *   called from exactly one place, `toggleHidden`, and only after
 *   `this.isHidden = isHidden` has already replaced the initial value.
 *   `createRootElement` builds the first className without consulting it.
 *
 * - The whole `this.nodes.root` null-guard family: the emptied bodies at the
 *   top of `toggleHidden`, `getControls` and `updateRootClasses`, their
 *   `if (...) -> false` variants, and the `return []` array literal inside
 *   `getControls`.
 *   `nodes.root` is assigned `createRootElement(...)` in the constructor, and
 *   that method always returns `document.createElement('div')`. The field is
 *   private, never reassigned, and PopoverItemHtml has no subclass. So the
 *   guards never fire: dropping their bodies, or making the condition
 *   permanently false, cannot change what runs. The `return []` value is dead
 *   for the same reason. Only the mutants that make a guard fire when the root
 *   IS present are observable, and those are killed below.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../../../src/components/utils/tooltip', () => ({
  onHover: vi.fn(),
  hide: vi.fn(),
}));

import { DATA_ATTR } from '../../../../../src/components/constants/data-attributes';
import { PopoverItemHtml } from '../../../../../src/components/utils/popover/components/popover-item/popover-item-html/popover-item-html';
import { PopoverItemType, type PopoverItemHtmlParams, type PopoverItemRenderParamsMap } from '../../../../../src/components/utils/popover/components/popover-item';
import * as tooltip from '../../../../../src/components/utils/tooltip';

type HtmlRenderParams = PopoverItemRenderParamsMap[PopoverItemType.Html];

/**
 * Builds item params with a fresh custom element.
 * @param overrides - fields to replace on the default params
 */
const htmlParams = (overrides: Partial<PopoverItemHtmlParams> = {}): PopoverItemHtmlParams => {
  return {
    type: PopoverItemType.Html,
    element: document.createElement('div'),
    name: 'custom-html-item',
    ...overrides,
  };
};

/**
 * Constructs the item and returns it together with its root element.
 * @param params - item params
 * @param renderParams - popover item render params
 */
const createItem = (
  params: PopoverItemHtmlParams = htmlParams(),
  renderParams?: HtmlRenderParams
): { item: PopoverItemHtml; root: HTMLElement } => {
  const item = new PopoverItemHtml(params, renderParams);
  const root = item.getElement();

  if (!(root instanceof HTMLElement)) {
    throw new Error('PopoverItemHtml did not create a root element');
  }

  return {
    item,
    root,
  };
};

/**
 * Returns the hint element handed to the tooltip on the most recent call.
 */
const lastHintElement = (): HTMLElement => {
  const call = vi.mocked(tooltip.onHover).mock.calls.at(-1);

  if (call === undefined) {
    throw new Error('onHover was never called');
  }

  const content = call[1];

  if (!(content instanceof HTMLElement)) {
    throw new Error('Hint content is not an element');
  }

  return content;
};

describe('PopoverItemHtml mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('root classes', () => {
    it('carries no classes when render params are absent', () => {
      const { root } = createItem();

      expect(root.className).toBe('');
    });

    it('carries the inline classes when render params mark the item inline', () => {
      const { root } = createItem(htmlParams(), { isInline: true });

      expect(root.className).toBe('flex items-center');
    });

    it('adds only the hidden class when a plain item is hidden', () => {
      const { item, root } = createItem();

      item.toggleHidden(true);

      expect(root.className).toBe('hidden');
    });

    it('keeps the inline classes when an inline item is hidden', () => {
      const { item, root } = createItem(htmlParams(), { isInline: true });

      item.toggleHidden(true);

      // twMerge treats `flex` and `hidden` as the same display group, so only
      // `hidden` survives out of the two.
      expect(root.className).toBe('hidden items-center');
    });

    it('drops the hidden class again when the item is shown', () => {
      const { item, root } = createItem();

      item.toggleHidden(true);
      item.toggleHidden(false);

      expect(root.className).toBe('');
    });
  });

  describe('root attributes', () => {
    it('marks the root with an empty popover-item-html attribute', () => {
      const { root } = createItem();

      expect(root.getAttribute(DATA_ATTR.popoverItemHtml)).toBe('');
    });

    it('leaves the item-name attribute off when the params carry no name', () => {
      const { root } = createItem({
        type: PopoverItemType.Html,
        element: document.createElement('div'),
      });

      expect(root.hasAttribute('data-blok-item-name')).toBe(false);
    });
  });

  describe('hint', () => {
    it('registers no hint when the item has none', () => {
      createItem();

      expect(tooltip.onHover).not.toHaveBeenCalled();
    });

    it('registers a hint when render params carry no hint config at all', () => {
      const { root } = createItem(
        htmlParams({ hint: { title: 'Custom hint' } }),
        { isInline: true }
      );

      expect(tooltip.onHover).toHaveBeenCalledTimes(1);
      expect(tooltip.onHover).toHaveBeenCalledWith(
        root,
        expect.any(HTMLElement),
        expect.objectContaining({ placement: 'right' })
      );
    });

    it('centres the hint content when render params omit the alignment', () => {
      createItem(htmlParams({ hint: { title: 'Custom hint' } }));

      expect(lastHintElement().getAttribute('data-alignment')).toBe('center');
    });

    it('honours an explicit start alignment from render params', () => {
      createItem(
        htmlParams({ hint: { title: 'Custom hint' } }),
        { hint: { alignment: 'start' } }
      );

      expect(lastHintElement().getAttribute('data-alignment')).toBe('start');
    });
  });
});
