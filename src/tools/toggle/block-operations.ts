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
const parseHTML = (html: string): DocumentFragment => {
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
 * Merge incoming data into toggle item.
 *
 * @param currentData - The current toggle item data (mutated)
 * @param contentElement - The content element (or null)
 * @param incomingData - The incoming data to merge
 */
export const mergeToggleItemData = (
  currentData: ToggleItemData,
  contentElement: HTMLElement | null,
  incomingData: ToggleItemData
): void => {
  currentData.text += incomingData.text;

  if (contentElement && incomingData.text) {
    const fragment = parseHTML(incomingData.text);
    contentElement.appendChild(fragment);
    contentElement.normalize();
  }
};

/**
 * Set data on the toggle item (for undo/redo).
 *
 * @param currentData - The current toggle item data
 * @param newData - The new data to apply
 * @param contentElement - The content element (or null)
 * @returns Object with the updated data and whether the update was in-place
 */
export const setToggleItemData = (
  currentData: ToggleItemData,
  newData: ToggleItemData,
  contentElement: HTMLElement | null
): { newData: ToggleItemData; inPlace: boolean } => {
  if (!contentElement) {
    return { newData: currentData, inPlace: false };
  }

  const updatedData: ToggleItemData = {
    ...currentData,
    ...newData,
  };

  if (typeof newData.text === 'string') {
    contentElement.innerHTML = newData.text;
  }

  return { newData: updatedData, inPlace: true };
};
