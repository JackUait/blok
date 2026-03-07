import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

import type { API } from '../../../../types';
import { TOGGLE_ATTR } from '../../../../src/tools/toggle/constants';
import { updateArrowState, updateChildrenVisibility } from '../../../../src/tools/toggle/toggle-lifecycle';

describe('Toggle Lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('updateChildrenVisibility', () => {
    const createMockChild = () => ({ holder: document.createElement('div') });

    const createMockApi = (children: { holder: HTMLElement }[]): API => ({
      blocks: {
        getChildren: vi.fn().mockReturnValue(children),
      },
    } as unknown as API);

    it('moves child holders into childContainer when isOpen = true', () => {
      const child1 = createMockChild();
      const child2 = createMockChild();
      const api = createMockApi([child1, child2]);
      const childContainer = document.createElement('div');

      updateChildrenVisibility(api, 'block-1', true, childContainer);

      expect(childContainer.contains(child1.holder)).toBe(true);
      expect(childContainer.contains(child2.holder)).toBe(true);
    });

    it('removes hidden class from child holders when isOpen = true with childContainer', () => {
      const child = createMockChild();
      child.holder.classList.add('hidden');
      const api = createMockApi([child]);
      const childContainer = document.createElement('div');

      updateChildrenVisibility(api, 'block-1', true, childContainer);

      expect(child.holder.classList.contains('hidden')).toBe(false);
    });

    it('moves child holders into childContainer and adds hidden class when isOpen = false', () => {
      const child1 = createMockChild();
      const child2 = createMockChild();
      const api = createMockApi([child1, child2]);
      const childContainer = document.createElement('div');

      updateChildrenVisibility(api, 'block-1', false, childContainer);

      expect(childContainer.contains(child1.holder)).toBe(true);
      expect(childContainer.contains(child2.holder)).toBe(true);
      expect(child1.holder.classList.contains('hidden')).toBe(true);
      expect(child2.holder.classList.contains('hidden')).toBe(true);
    });

    it('does not re-append a child holder already inside childContainer', () => {
      const child = createMockChild();
      const childContainer = document.createElement('div');
      childContainer.appendChild(child.holder);
      const api = createMockApi([child]);

      const appendChildSpy = vi.spyOn(childContainer, 'appendChild');

      updateChildrenVisibility(api, 'block-1', true, childContainer);

      expect(appendChildSpy).not.toHaveBeenCalled();
    });

    it('still shows/hides children without childContainer (backward compatible, isOpen = true)', () => {
      const child = createMockChild();
      child.holder.classList.add('hidden');
      const api = createMockApi([child]);

      updateChildrenVisibility(api, 'block-1', true);

      expect(child.holder.classList.contains('hidden')).toBe(false);
    });

    it('still shows/hides children without childContainer (backward compatible, isOpen = false)', () => {
      const child = createMockChild();
      const api = createMockApi([child]);

      updateChildrenVisibility(api, 'block-1', false);

      expect(child.holder.classList.contains('hidden')).toBe(true);
    });

    it('still shows/hides children when childContainer is null (backward compatible)', () => {
      const child = createMockChild();
      child.holder.classList.add('hidden');
      const api = createMockApi([child]);

      updateChildrenVisibility(api, 'block-1', true, null);

      expect(child.holder.classList.contains('hidden')).toBe(false);
    });

    // Fix 3: aria-hidden on childContainer when collapsed
    it('sets aria-hidden="true" on childContainer when isOpen = false', () => {
      const child = createMockChild();
      const api = createMockApi([child]);
      const childContainer = document.createElement('div');

      updateChildrenVisibility(api, 'block-1', false, childContainer);

      expect(childContainer.getAttribute('aria-hidden')).toBe('true');
    });

    it('removes aria-hidden from childContainer when isOpen = true', () => {
      const child = createMockChild();
      child.holder.classList.add('hidden');
      const api = createMockApi([child]);
      const childContainer = document.createElement('div');
      childContainer.setAttribute('aria-hidden', 'true');

      updateChildrenVisibility(api, 'block-1', true, childContainer);

      expect(childContainer.getAttribute('aria-hidden')).not.toBe('true');
    });

    // Fix 4: Focus moves to arrow when collapsing with focus inside children
    it('moves focus to arrowElement when collapsing with focus inside childContainer', () => {
      const child = createMockChild();
      const innerInput = document.createElement('input');
      child.holder.appendChild(innerInput);

      const api = createMockApi([child]);
      const childContainer = document.createElement('div');
      const arrowElement = document.createElement('span');
      arrowElement.setAttribute('tabindex', '0');

      document.body.appendChild(childContainer);
      document.body.appendChild(arrowElement);
      childContainer.appendChild(child.holder);
      innerInput.focus();

      expect(innerInput).toHaveFocus();

      updateChildrenVisibility(api, 'block-1', false, childContainer, arrowElement);

      expect(arrowElement).toHaveFocus();

      document.body.removeChild(childContainer);
      document.body.removeChild(arrowElement);
    });

    it('does not move focus when collapsing without focus inside childContainer', () => {
      const child = createMockChild();
      const api = createMockApi([child]);
      const childContainer = document.createElement('div');
      const arrowElement = document.createElement('span');
      arrowElement.setAttribute('tabindex', '0');

      // Focus somewhere else
      const otherEl = document.createElement('input');
      document.body.appendChild(otherEl);
      otherEl.focus();

      updateChildrenVisibility(api, 'block-1', false, childContainer, arrowElement);

      expect(arrowElement).not.toHaveFocus();

      document.body.removeChild(otherEl);
    });
  });

  describe('updateArrowState', () => {
    it('sets aria-expanded="true" when opening', () => {
      const arrowEl = document.createElement('div');
      const wrapper = document.createElement('div');

      updateArrowState(arrowEl, wrapper, true);

      expect(arrowEl.getAttribute('aria-expanded')).toBe('true');
    });

    it('sets aria-expanded="false" when closing', () => {
      const arrowEl = document.createElement('div');
      const wrapper = document.createElement('div');

      updateArrowState(arrowEl, wrapper, false);

      expect(arrowEl.getAttribute('aria-expanded')).toBe('false');
    });

    it('sets aria-label to "Collapse" when opening', () => {
      const arrowEl = document.createElement('div');
      const wrapper = document.createElement('div');

      updateArrowState(arrowEl, wrapper, true);

      expect(arrowEl.getAttribute('aria-label')).toBe('Collapse');
    });

    it('sets aria-label to "Expand" when closing', () => {
      const arrowEl = document.createElement('div');
      const wrapper = document.createElement('div');

      updateArrowState(arrowEl, wrapper, false);

      expect(arrowEl.getAttribute('aria-label')).toBe('Expand');
    });

    it('rotates SVG inside arrow 90deg when opening (not the arrow container)', () => {
      const arrowEl = document.createElement('div');
      arrowEl.innerHTML = '<svg><path/></svg>';
      const wrapper = document.createElement('div');

      updateArrowState(arrowEl, wrapper, true);

      const svg = arrowEl.querySelector('svg') as SVGSVGElement;

      expect(svg.style.transform).toBe('rotate(90deg)');
      expect(arrowEl.style.transform).toBe('');
    });

    it('removes SVG rotation when closing (not the arrow container)', () => {
      const arrowEl = document.createElement('div');
      arrowEl.innerHTML = '<svg><path/></svg>';
      const wrapper = document.createElement('div');

      updateArrowState(arrowEl, wrapper, false);

      const svg = arrowEl.querySelector('svg') as SVGSVGElement;

      expect(svg.style.transform).toBe('');
      expect(arrowEl.style.transform).toBe('');
    });

    it('updates toggle-open attribute on wrapper', () => {
      const arrowEl = document.createElement('div');
      const wrapper = document.createElement('div');

      updateArrowState(arrowEl, wrapper, true);
      expect(wrapper.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('true');

      updateArrowState(arrowEl, wrapper, false);
      expect(wrapper.getAttribute(TOGGLE_ATTR.toggleOpen)).toBe('false');
    });
  });
});
