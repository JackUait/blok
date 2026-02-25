import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/* eslint-disable internal-unit-test/no-class-selectors -- StyleManager's purpose is to manage CSS classes */

import { StyleManager } from '../../../../src/components/block/style-manager';
import { DATA_ATTR } from '../../../../src/components/constants';

describe('StyleManager', () => {
  let holder: HTMLDivElement;
  let contentElement: HTMLDivElement;
  let styleManager: StyleManager;

  beforeEach(() => {
    holder = document.createElement('div');
    contentElement = document.createElement('div');
    holder.appendChild(contentElement);
    styleManager = new StyleManager(holder, contentElement);
  });

  afterEach(() => {
    holder.remove();
  });

  describe('Constructor', () => {
    it('creates instance with holder and content element', () => {
      expect(styleManager).toBeInstanceOf(StyleManager);
    });

    it('handles null content element', () => {
      const manager = new StyleManager(holder, null);
      expect(manager).toBeInstanceOf(StyleManager);
    });
  });

  describe('stretched getter', () => {
    it('returns false when stretched attribute is not set', () => {
      expect(styleManager.stretched).toBe(false);
    });

    it('returns true when stretched attribute is set', () => {
      holder.setAttribute(DATA_ATTR.stretched, 'true');
      expect(styleManager.stretched).toBe(true);
    });
  });

  describe('setStretchState', () => {
    it('sets stretched attribute when state is true', () => {
      styleManager.setStretchState(true, false);

      expect(holder).toHaveAttribute(DATA_ATTR.stretched, 'true');
    });

    it('removes stretched attribute when state is false', () => {
      holder.setAttribute(DATA_ATTR.stretched, 'true');
      styleManager.setStretchState(false, false);

      expect(holder).not.toHaveAttribute(DATA_ATTR.stretched);
    });

    it('updates content classes when not selected', () => {
      styleManager.setStretchState(true, false);

      expect(styleManager.stretched).toBe(true);
      expect(contentElement.className).toContain('max-w-none');
    });

    it('does not update content classes when selected', () => {
      styleManager.setStretchState(true, true);

      // Selection takes precedence, so stretched style is not applied when selected
      // The contentElement is not updated when selected=true is passed to setStretchState
      expect(styleManager.stretched).toBe(true);
      // Since setStretchState with selected=true doesn't update content, className stays empty
      expect(contentElement.className).toBe('');
    });
  });

  describe('updateContentState', () => {
    it('adds selected classes when selected is true', () => {
      styleManager.updateContentState(true, false);

      const classes = styleManager.getContentClasses(true, false);
      expect(classes).toContain('bg-selection');
      expect(contentElement.className).toBe(classes);
    });

    it('adds stretched classes when stretched is true', () => {
      styleManager.updateContentState(false, true);

      const classes = styleManager.getContentClasses(false, true);
      expect(classes).toContain('max-w-none');
      expect(contentElement.className).toBe(classes);
    });

    it('applies both selected and stretched classes when both are true', () => {
      styleManager.updateContentState(true, true);

      const classes = styleManager.getContentClasses(true, true);
      expect(classes).toContain('bg-selection');
      expect(classes).toContain('max-w-none');
      expect(contentElement.className).toBe(classes);
    });

    it('applies base classes when neither selected nor stretched', () => {
      styleManager.updateContentState(false, false);

      const classes = styleManager.getContentClasses(false, false);
      expect(classes).toContain('mx-auto');
      expect(classes).toContain('max-w-content');
      expect(contentElement.className).toBe(classes);
    });

    it('does nothing when content element is null', () => {
      const manager = new StyleManager(holder, null);
      expect(() => manager.updateContentState(true, false)).not.toThrow();
    });
  });

  describe('getContentClasses', () => {
    it('returns selected classes when selected is true', () => {
      const classes = styleManager.getContentClasses(true, false);

      expect(classes).toContain('bg-selection');
      expect(classes).toContain('rounded-[4px]');
    });

    it('returns stretched classes when stretched is true', () => {
      const classes = styleManager.getContentClasses(false, true);

      expect(classes).toContain('max-w-none');
    });

    it('returns both selected and stretched classes when both are true', () => {
      const classes = styleManager.getContentClasses(true, true);

      expect(classes).toContain('bg-selection');
      expect(classes).toContain('max-w-none');
    });

    it('returns base classes when neither selected nor stretched', () => {
      const classes = styleManager.getContentClasses(false, false);

      expect(classes).toContain('mx-auto');
      expect(classes).toContain('max-w-content');
      expect(classes).not.toContain('bg-selection');
      expect(classes).not.toContain('max-w-none');
    });
  });

  describe('Static properties', () => {
    it('provides wrapperStyles', () => {
      expect(StyleManager.wrapperStyles).toContain('relative');
      expect(StyleManager.wrapperStyles).toContain('opacity-100');
    });

    it('wrapper styles remove bottom padding and margin on last block', () => {
      expect(StyleManager.wrapperStyles).toContain('last:pb-0');
      expect(StyleManager.wrapperStyles).toContain('last:mb-0');
    });

    it('provides contentStyles', () => {
      expect(StyleManager.contentStyles).toContain('mx-auto');
      expect(StyleManager.contentStyles).toContain('max-w-content');
    });
  });
});
