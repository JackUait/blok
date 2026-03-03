import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';

import { TOGGLE_ATTR } from '../../../../src/tools/toggle/constants';
import { updateArrowState } from '../../../../src/tools/toggle/toggle-lifecycle';

describe('Toggle Lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
