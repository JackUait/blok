/**
 * List Lifecycle - Lifecycle methods for ListItem (render, rendered, moved, removed).
 *
 * Extracted from ListItem to reduce file size.
 */

import { buildListItem } from './dom-builder';
import type { ListItemData } from './types';

/**
 * Context for rendering
 */
export interface RenderContext {
  data: ListItemData;
  readOnly: boolean;
  placeholder: string;
  itemColor: string | undefined;
  itemSize: string | undefined;
  setupItemPlaceholder: (element: HTMLElement) => void;
  onCheckboxChange: (checked: boolean, content: HTMLElement | null) => void;
  keydownHandler: ((event: KeyboardEvent) => void) | undefined;
}

/**
 * Render the list item
 */
export function renderListItem(context: RenderContext): HTMLElement {
  const { data, readOnly, placeholder, itemColor, itemSize, setupItemPlaceholder, onCheckboxChange, keydownHandler } = context;

  const result = buildListItem({
    data,
    readOnly,
    placeholder,
    itemColor,
    itemSize,
    keydownHandler,
  });

  // Setup placeholders on content elements
  if (result.contentElement) {
    setupItemPlaceholder(result.contentElement);
  }

  // Setup checkbox change handler
  if (result.checkboxElement && !readOnly) {
    const checkboxElement = result.checkboxElement;
    checkboxElement.addEventListener('change', () => {
      onCheckboxChange(checkboxElement.checked, result.contentElement);
    });
  }

  return result.wrapper;
}
