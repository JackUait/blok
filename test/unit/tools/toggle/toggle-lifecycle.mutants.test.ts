import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { API } from '../../../../types';

import * as domBuilder from '../../../../src/tools/toggle/dom-builder';
import * as tooltipModule from '../../../../src/components/utils/tooltip';
import { TOGGLE_ATTR } from '../../../../src/tools/toggle/constants';
import {
  createArrowTooltip,
  renderToggleItem,
  updateArrowState,
  updateBodyPlaceholderVisibility,
  updateChildrenVisibility,
  updateToggleEmptyState,
} from '../../../../src/tools/toggle/toggle-lifecycle';

vi.mock('../../../../src/components/utils/tooltip', async (importOriginal) => {
  const actual = await importOriginal<typeof tooltipModule>();

  return { ...actual, show: vi.fn(), hide: vi.fn() };
});

vi.mock('../../../../src/tools/toggle/dom-builder', async (importOriginal) => {
  const actual = await importOriginal<typeof domBuilder>();

  return { ...actual, buildToggleItem: vi.fn() };
});

type RenderContext = Parameters<typeof renderToggleItem>[0];
type BuildResult = ReturnType<typeof domBuilder.buildToggleItem>;
type MockChild = { holder: HTMLElement };

const createRenderContext = (): RenderContext => ({
  data: { text: 'Title' },
  readOnly: false,
  isOpen: true,
  keydownHandler: null,
  onArrowClick: null,
  onBodyPlaceholderClick: null,
  bodyPlaceholderText: 'Empty toggle',
  ariaLabels: {
    collapse: 'Collapse',
    expand: 'Expand',
  },
  placeholder: 'Toggle title',
});

const createApi = (children: MockChild[]): {
  api: API;
  getChildren: Mock<(blockId: string) => MockChild[]>;
} => {
  const getChildren: Mock<(blockId: string) => MockChild[]> = vi.fn(() => children);
  const api = { blocks: { getChildren } } as unknown as API;

  return {
    api,
    getChildren,
  };
};

describe('Toggle Lifecycle — mutant coverage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    const actual = await vi.importActual<typeof domBuilder>('../../../../src/tools/toggle/dom-builder');

    vi.mocked(domBuilder.buildToggleItem).mockImplementation(actual.buildToggleItem);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createArrowTooltip', () => {
    it('returns exactly a show/hide pair whose hide is the tooltip module hide', () => {
      const tooltip = createArrowTooltip();

      expect(Object.keys(tooltip)).toStrictEqual(['show', 'hide']);
      expect(tooltip.hide).toBe(tooltipModule.hide);
    });

    it('forwards element and content to the tooltip module with a 500ms delay', () => {
      const tooltip = createArrowTooltip();
      const arrow: HTMLElement = document.createElement('span');

      tooltip.show(arrow, 'Collapse');

      const calls = vi.mocked(tooltipModule.show).mock.calls;

      expect(calls).toHaveLength(1);
      expect(calls[0]?.[0]).toBe(arrow);
      expect(calls[0]?.slice(1)).toStrictEqual(['Collapse', { delay: 500 }]);
    });

    it('hides through the tooltip module with no arguments', () => {
      const tooltip = createArrowTooltip();

      tooltip.hide();

      expect(vi.mocked(tooltipModule.hide).mock.calls).toStrictEqual([[]]);
    });
  });

  describe('updateToggleEmptyState', () => {
    it('treats a whitespace-only body as empty', () => {
      const wrapper: HTMLElement = document.createElement('div');
      const childContainer: HTMLElement = document.createElement('div');
      const child = document.createElement('p');

      child.textContent = '   \n\t ';
      childContainer.appendChild(child);

      updateToggleEmptyState(wrapper, childContainer);

      expect(wrapper.getAttribute(TOGGLE_ATTR.toggleEmpty)).toBe('true');
    });
  });

  describe('renderToggleItem', () => {
    it('wires an always-active placeholder onto the content element', () => {
      const result = renderToggleItem(createRenderContext());

      expect(result.contentElement.getAttribute('data-blok-placeholder-active')).toBe('Toggle title');
      expect(result.contentElement.getAttribute('data-blok-placeholder-visible')).toBe('always-active');
    });

    // The guard `if (result.contentElement)` is unobservable through the real
    // builder, which always makes an element; only a stubbed build result can
    // reach it. Without the guard setupPlaceholder would throw on null.
    it('skips placeholder setup when the builder yields no content element', () => {
      const built = domBuilder.buildToggleItem(createRenderContext());
      const withoutContent = {
        ...built,
        contentElement: null,
      } as unknown as BuildResult;

      vi.mocked(domBuilder.buildToggleItem).mockReturnValueOnce(withoutContent);

      expect(renderToggleItem(createRenderContext())).toBe(withoutContent);
    });
  });

  describe('updateArrowState', () => {
    // Asserting '' on a fresh svg is vacuous: jsdom drops a value it cannot
    // parse and keeps the old one, so the rotation must already be applied for
    // the reset to be visible.
    it('clears an already applied SVG rotation when closing', () => {
      const arrowEl: HTMLElement = document.createElement('div');
      const wrapper: HTMLElement = document.createElement('div');

      arrowEl.innerHTML = '<svg><path/></svg>';

      updateArrowState(arrowEl, wrapper, true);

      expect(arrowEl.querySelector('svg')?.style.transform).toBe('rotate(90deg)');

      updateArrowState(arrowEl, wrapper, false);

      expect(arrowEl.querySelector('svg')?.style.transform).toBe('');
    });
  });

  describe('updateChildrenVisibility', () => {
    it('leaves focus inside the children when expanding', () => {
      const child: MockChild = { holder: document.createElement('div') };
      const innerInput = document.createElement('input');
      const childContainer: HTMLElement = document.createElement('div');
      const arrowElement: HTMLElement = document.createElement('span');
      const { api } = createApi([child]);

      child.holder.appendChild(innerInput);
      arrowElement.setAttribute('tabindex', '0');
      document.body.appendChild(childContainer);
      document.body.appendChild(arrowElement);
      childContainer.appendChild(child.holder);
      innerInput.focus();

      updateChildrenVisibility(api, 'block-1', true, childContainer, arrowElement);

      expect(innerInput).toHaveFocus();
      expect(arrowElement).not.toHaveFocus();

      childContainer.remove();
      arrowElement.remove();
    });
  });

  describe('updateBodyPlaceholderVisibility', () => {
    it('is a no-op when the body placeholder is missing', () => {
      const { api, getChildren } = createApi([]);

      expect(() => updateBodyPlaceholderVisibility(null, api, 'block-1', true, false)).not.toThrow();
      expect(getChildren.mock.calls).toStrictEqual([]);
    });

    it('hides the placeholder in read-only mode without reading the block tree', () => {
      const placeholder: HTMLElement = document.createElement('div');
      const { api, getChildren } = createApi([]);

      updateBodyPlaceholderVisibility(placeholder, api, 'block-1', true, true);

      expect(Array.from(placeholder.classList)).toStrictEqual(['hidden']);
      expect(getChildren.mock.calls).toStrictEqual([]);
    });

    it('reveals the placeholder when open with no children', () => {
      const placeholder: HTMLElement = document.createElement('div');
      const { api, getChildren } = createApi([]);

      placeholder.classList.add('hidden');

      updateBodyPlaceholderVisibility(placeholder, api, 'block-1', true, false);

      expect(Array.from(placeholder.classList)).toStrictEqual([]);
      expect(getChildren.mock.calls).toStrictEqual([['block-1']]);
    });

    it('hides the placeholder when the toggle is collapsed', () => {
      const placeholder: HTMLElement = document.createElement('div');
      const { api } = createApi([]);

      updateBodyPlaceholderVisibility(placeholder, api, 'block-1', false, false);

      expect(Array.from(placeholder.classList)).toStrictEqual(['hidden']);
    });

    it('hides the placeholder when the toggle is open but already has children', () => {
      const placeholder: HTMLElement = document.createElement('div');
      const { api } = createApi([{ holder: document.createElement('div') }]);

      updateBodyPlaceholderVisibility(placeholder, api, 'block-1', true, false);

      expect(Array.from(placeholder.classList)).toStrictEqual(['hidden']);
    });
  });
});
