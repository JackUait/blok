import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CollapsedBoldExitHandler } from '../../../../src/components/inline-tools/collapsed-bold-exit-handler';

describe('CollapsedBoldExitHandler', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    CollapsedBoldExitHandler.reset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    CollapsedBoldExitHandler.reset();
  });

  describe('getInstance', () => {
    it('returns a singleton instance', () => {
      const instance1 = CollapsedBoldExitHandler.getInstance();
      const instance2 = CollapsedBoldExitHandler.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('returns instance of CollapsedBoldExitHandler', () => {
      const instance = CollapsedBoldExitHandler.getInstance();

      expect(instance).toBeInstanceOf(CollapsedBoldExitHandler);
    });
  });

  describe('hasActiveRecords', () => {
    it('returns false when no records exist', () => {
      const handler = CollapsedBoldExitHandler.getInstance();

      expect(handler.hasActiveRecords()).toBe(false);
    });
  });

  describe('exitBold', () => {
    it('removes empty bold element and returns range before it', () => {
      const div = document.createElement('div');
      const strong = document.createElement('strong');

      div.contentEditable = 'true';
      div.appendChild(strong);
      document.body.appendChild(div);
      div.focus();

      const selection = window.getSelection()!;
      const handler = CollapsedBoldExitHandler.getInstance();
      const range = handler.exitBold(selection, strong);

      expect(range).toBeDefined();
      expect(div.querySelector('strong')).toBeNull();
    });

    it('creates boundary text node and tracks exit for non-empty bold', () => {
      const div = document.createElement('div');
      const strong = document.createElement('strong');

      strong.textContent = 'bold';
      div.contentEditable = 'true';
      div.appendChild(strong);
      document.body.appendChild(div);
      div.focus();

      const selection = window.getSelection()!;
      const handler = CollapsedBoldExitHandler.getInstance();
      const range = handler.exitBold(selection, strong);

      expect(range).toBeDefined();
      expect(handler.hasActiveRecords()).toBe(true);
      expect(strong.nextSibling?.nodeType).toBe(Node.TEXT_NODE);
    });

    it('sets data attribute for collapsed length on bold element', () => {
      const div = document.createElement('div');
      const strong = document.createElement('strong');

      strong.textContent = 'bold';
      div.contentEditable = 'true';
      div.appendChild(strong);
      document.body.appendChild(div);
      div.focus();

      const selection = window.getSelection()!;
      const handler = CollapsedBoldExitHandler.getInstance();

      handler.exitBold(selection, strong);

      expect(strong.getAttribute('data-blok-bold-collapsed-length')).toBe('4');
    });
  });
});
