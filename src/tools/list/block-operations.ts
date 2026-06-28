/**
 * List Block Operations - Block-related operations for ListItem.
 *
 * Extracted from ListItem to reduce file size.
 */

import type { MenuConfig } from '../../../types/tools/menu-config';
import { stripFakeBackgroundElements } from '../../components/utils';

import { buildListItem } from './dom-builder';
import type { ListItemStyle, ListItemData, StyleConfig } from './types';

/**
 * Context for rerender operations
 */
export interface RerenderContext {
  data: ListItemData;
  readOnly: boolean;
  placeholder: string;
  itemColor: string | undefined;
  itemSize: string | undefined;
  markerDepth?: number;
  element: HTMLElement | null;
  setupItemPlaceholder: (element: HTMLElement) => void;
  onCheckboxChange: (checked: boolean, content: HTMLElement | null) => void;
  keydownHandler: ((event: KeyboardEvent) => void) | undefined;
}

/**
 * Rerender the list item
 */
export const rerenderListItem = (context: RerenderContext): HTMLElement | null => {
  const { data, readOnly, placeholder, itemColor, itemSize, markerDepth, element, setupItemPlaceholder, onCheckboxChange, keydownHandler } = context;

  if (!element) return null;

  const parent = element.parentNode;
  if (!parent) return null;

  const result = buildListItem({
    data,
    readOnly,
    placeholder,
    itemColor,
    itemSize,
    markerDepth,
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

  parent.replaceChild(result.wrapper, element);
  return result.wrapper;
}

/**
 * Save the list item data.
 *
 * @param depth - the item's STRUCTURAL nesting depth (derived from the parentId
 *   chain by the list tool). When provided it is the source of truth for the
 *   serialized depth, so a dragged/keyboard-nested item round-trips even if the
 *   stored `data.depth` drifted. Falls back to `data.depth` when omitted (e.g.
 *   imported lists that only carry the legacy flat depth).
 */
export const saveListItem = (
  data: ListItemData,
  element: HTMLElement | null,
  getContentElement: () => HTMLElement | null,
  depth?: number
): ListItemData => {
  if (!element) return data;

  const contentEl = getContentElement();
  const text = contentEl ? stripFakeBackgroundElements(contentEl.innerHTML) : data.text;

  const result: ListItemData = {
    text,
    style: data.style,
    ...(data.style === 'checklist' ? { checked: Boolean(data.checked) } : {}),
  };

  if (data.start !== undefined && data.start !== 1) {
    result.start = data.start;
  }

  const effectiveDepth = depth ?? data.depth ?? 0;

  if (effectiveDepth > 0) {
    result.depth = effectiveDepth;
  }

  return result;
}

/**
 * Set data on the list item (for undo/redo)
 */
export const setListItemData = (
  currentData: ListItemData,
  newData: ListItemData,
  element: HTMLElement | null,
  getContentElement: () => HTMLElement | null,
  operations: {
    adjustDepthTo: (newDepth: number) => void;
    updateMarkerForDepth: (newDepth: number, style: ListItemStyle) => void;
    updateCheckboxState: (checked: boolean) => void;
  }
): { newData: ListItemData; inPlace: boolean } => {
  if (!element) {
    return { newData: currentData, inPlace: false };
  }

  const oldDepth = currentData.depth ?? 0;
  const newDepth = newData.depth ?? 0;
  const oldStyle = currentData.style;
  const newStyle = newData.style;

  // Style changes require full re-render (different DOM structure)
  if (oldStyle !== newStyle) {
    return { newData: currentData, inPlace: false };
  }

  // Update internal data
  // Handle depth explicitly: if depth is not in newData, it means 0 (default)
  const depthOrDefault = 'depth' in newData ? newData.depth : 0;

  const updatedData: ListItemData = {
    ...currentData,
    ...newData,
    depth: depthOrDefault,
  };

  // Update text content
  const contentEl = getContentElement();

  if (contentEl && typeof newData.text === 'string') {
    contentEl.innerHTML = newData.text;
  }

  // Update depth if changed
  const depthChanged = oldDepth !== newDepth;

  if (depthChanged) {
    operations.adjustDepthTo(newDepth);
    operations.updateMarkerForDepth(newDepth, newStyle);

    return { newData: updatedData, inPlace: true };
  }

  // Update checkbox state for checklist items
  const isChecklist = newStyle === 'checklist';

  if (isChecklist) {
    operations.updateCheckboxState(newData.checked ?? false);
  }

  return { newData: updatedData, inPlace: true };
}

/**
 * Merge data into list item
 */
export interface MergeContext {
  data: ListItemData;
  element: HTMLElement | null;
  getContentElement: () => HTMLElement | null;
  parseHTML: (html: string) => DocumentFragment;
}

export const mergeListItemData = (context: MergeContext, data: ListItemData): void => {
  const { element, getContentElement, parseHTML, data: contextData } = context;

  if (!element) {
    return;
  }

  contextData.text += data.text;

  const contentEl = getContentElement();
  if (contentEl && data.text) {
    const fragment = parseHTML(data.text);
    contentEl.appendChild(fragment);
    contentEl.normalize();
  }
}

/**
 * Render settings menu
 */
export const renderListSettings = (
  availableStyles: StyleConfig[],
  currentStyle: ListItemStyle,
  t: (key: string) => string,
  setStyle: (style: ListItemStyle) => void
): MenuConfig => {
  return availableStyles.map(styleConfig => ({
    icon: styleConfig.icon,
    title: t(`toolNames.${styleConfig.titleKey}`),
    onActivate: (): void => setStyle(styleConfig.style),
    closeOnActivate: true,
    isActive: currentStyle === styleConfig.style,
  }));
}
