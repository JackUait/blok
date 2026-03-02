/**
 * Toggle Block Operations - Block-related operations for ToggleItem.
 *
 * Extracted from ToggleItem to reduce file size.
 */

import { stripFakeBackgroundElements } from '../../components/utils';

import type { ToggleItemData } from './types';

/**
 * Parse HTML string into a DocumentFragment.
 *
 * @param html - HTML string to parse
 * @returns DocumentFragment with parsed nodes
 */
export const parseHTML = (html: string): DocumentFragment => {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html.trim();

  const fragment = document.createDocumentFragment();
  fragment.append(...Array.from(wrapper.childNodes));

  return fragment;
};

/**
 * Save the toggle item data.
 *
 * @param data - Current toggle item data
 * @param element - The toggle wrapper element (or null)
 * @param getContentElement - Function to get the content element
 * @returns The saved toggle item data
 */
export const saveToggleItem = (
  data: ToggleItemData,
  element: HTMLElement | null,
  getContentElement: () => HTMLElement | null
): ToggleItemData => {
  if (!element) return data;

  const contentEl = getContentElement();
  const text = contentEl ? stripFakeBackgroundElements(contentEl.innerHTML) : data.text;

  return { text };
};

/**
 * Context for merge operations
 */
export interface MergeContext {
  data: ToggleItemData;
  getContentElement: () => HTMLElement | null;
  parseHTML: (html: string) => DocumentFragment;
}

/**
 * Merge incoming data into toggle item.
 *
 * @param context - The merge context
 * @param incomingData - The incoming data to merge
 */
export const mergeToggleItemData = (
  context: MergeContext,
  incomingData: ToggleItemData
): void => {
  const { data, getContentElement } = context;

  data.text += incomingData.text;

  const contentEl = getContentElement();

  if (contentEl && incomingData.text) {
    const fragment = context.parseHTML(incomingData.text);

    contentEl.appendChild(fragment);
    contentEl.normalize();
  }
};

/**
 * Set data on the toggle item (for undo/redo).
 *
 * @param currentData - The current toggle item data
 * @param newData - The new data to apply
 * @param getContentElement - Function to get the content element
 * @returns Object with the updated data and whether the update was in-place
 */
export const setToggleItemData = (
  currentData: ToggleItemData,
  newData: ToggleItemData,
  getContentElement: () => HTMLElement | null
): { newData: ToggleItemData; inPlace: boolean } => {
  const contentEl = getContentElement();

  if (!contentEl) {
    return { newData: currentData, inPlace: false };
  }

  const updatedData: ToggleItemData = {
    ...currentData,
    ...newData,
  };

  if (typeof newData.text === 'string') {
    contentEl.innerHTML = newData.text;
  }

  return { newData: updatedData, inPlace: true };
};
