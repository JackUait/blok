import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  saveToggleItem,
  mergeToggleItemData,
  setToggleItemData,
} from '../../../../src/tools/toggle/block-operations';
import type { ToggleItemData } from '../../../../src/tools/toggle/types';

vi.mock('../../../../src/components/utils', () => ({
  stripFakeBackgroundElements: vi.fn((html: string) => html.replace(/<fake-bg[^>]*>[^<]*<\/fake-bg>/g, '')),
}));

describe('Toggle Block Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('saveToggleItem', () => {
    it('extracts text from content element', () => {
      const data: ToggleItemData = { text: 'original' };
      const element = document.createElement('div');
      const contentElement = document.createElement('div');
      contentElement.innerHTML = 'updated text';
      const getContentElement = (): HTMLElement => contentElement;

      const result = saveToggleItem(data, element, getContentElement);

      expect(result.text).toBe('updated text');
    });

    it('falls back to data.text if no element', () => {
      const data: ToggleItemData = { text: 'fallback text' };
      const getContentElement = (): HTMLElement | null => null;

      const result = saveToggleItem(data, null, getContentElement);

      expect(result.text).toBe('fallback text');
    });

    it('falls back to data.text if no content element', () => {
      const data: ToggleItemData = { text: 'fallback text' };
      const element = document.createElement('div');
      const getContentElement = (): HTMLElement | null => null;

      const result = saveToggleItem(data, element, getContentElement);

      expect(result.text).toBe('fallback text');
    });

    it('calls stripFakeBackgroundElements on content innerHTML', async () => {
      const { stripFakeBackgroundElements } = await import('../../../../src/components/utils');

      const data: ToggleItemData = { text: '' };
      const element = document.createElement('div');
      const contentElement = document.createElement('div');
      contentElement.innerHTML = 'some content';
      const getContentElement = (): HTMLElement => contentElement;

      saveToggleItem(data, element, getContentElement);

      expect(stripFakeBackgroundElements).toHaveBeenCalledWith('some content');
    });
  });

  describe('mergeToggleItemData', () => {
    it('appends incoming text to current data', () => {
      const currentData: ToggleItemData = { text: 'Hello' };
      const contentElement = document.createElement('div');
      contentElement.innerHTML = 'Hello';
      const incomingData: ToggleItemData = { text: ' World' };

      mergeToggleItemData(currentData, contentElement, incomingData);

      expect(currentData.text).toBe('Hello World');
    });

    it('appends incoming HTML as DOM fragment to content element', () => {
      const currentData: ToggleItemData = { text: 'Hello' };
      const contentElement = document.createElement('div');
      contentElement.innerHTML = 'Hello';
      const incomingData: ToggleItemData = { text: '<b>Bold</b>' };

      mergeToggleItemData(currentData, contentElement, incomingData);

      expect(contentElement.innerHTML).toContain('Bold');
    });

    it('does nothing when content element is null', () => {
      const currentData: ToggleItemData = { text: 'Hello' };
      const incomingData: ToggleItemData = { text: ' World' };

      mergeToggleItemData(currentData, null, incomingData);

      // Data is still updated
      expect(currentData.text).toBe('Hello World');
    });

    it('normalizes content element after appending', () => {
      const currentData: ToggleItemData = { text: 'Hello' };
      const contentElement = document.createElement('div');
      contentElement.innerHTML = 'Hello';
      const normalize = vi.spyOn(contentElement, 'normalize');
      const incomingData: ToggleItemData = { text: ' there' };

      mergeToggleItemData(currentData, contentElement, incomingData);

      expect(normalize).toHaveBeenCalledOnce();
    });
  });

  describe('setToggleItemData', () => {
    it('updates text in-place and returns inPlace: true', () => {
      const currentData: ToggleItemData = { text: 'old' };
      const contentElement = document.createElement('div');
      contentElement.innerHTML = 'old';
      const newData: ToggleItemData = { text: 'new' };

      const result = setToggleItemData(currentData, newData, contentElement);

      expect(result.inPlace).toBe(true);
      expect(result.newData.text).toBe('new');
    });

    it('updates content element innerHTML', () => {
      const currentData: ToggleItemData = { text: 'old' };
      const contentElement = document.createElement('div');
      contentElement.innerHTML = 'old';
      const newData: ToggleItemData = { text: 'new content' };

      setToggleItemData(currentData, newData, contentElement);

      expect(contentElement.innerHTML).toBe('new content');
    });

    it('returns inPlace: false when content element is null', () => {
      const currentData: ToggleItemData = { text: 'old' };
      const newData: ToggleItemData = { text: 'new' };

      const result = setToggleItemData(currentData, newData, null);

      expect(result.inPlace).toBe(false);
      expect(result.newData.text).toBe('old');
    });

    it('merges newData properties into result', () => {
      const currentData: ToggleItemData = { text: 'old' };
      const contentElement = document.createElement('div');
      contentElement.innerHTML = 'old';
      const newData: ToggleItemData = { text: 'new' };

      const result = setToggleItemData(currentData, newData, contentElement);

      expect(result.newData).toEqual({ text: 'new' });
    });
  });
});
