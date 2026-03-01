/**
 * Toggle Lifecycle - Lifecycle methods for ToggleItem (render, state updates).
 *
 * Extracted from ToggleItem to reduce file size.
 */

import type { API } from '../../../types';

import { setupPlaceholder } from '../../components/utils/placeholder';

import { TOGGLE_ATTR } from './constants';
import { buildToggleItem } from './dom-builder';
import type { ToggleDOMBuilderContext, ToggleBuildResult } from './dom-builder';

/**
 * Context for rendering a toggle item
 */
export interface ToggleRenderContext extends ToggleDOMBuilderContext {
  placeholder: string;
}

/**
 * Result of rendering a toggle item
 */
export interface ToggleRenderResult {
  wrapper: HTMLElement;
  contentElement: HTMLElement;
  arrowElement: HTMLElement;
}

/**
 * Render a toggle item with placeholder support.
 *
 * @param context - The render context
 * @returns Object containing the wrapper, content, and arrow elements
 */
export const renderToggleItem = (context: ToggleRenderContext): ToggleRenderResult => {
  const result = buildToggleItem(context);

  if (result.contentElement) {
    setupPlaceholder(result.contentElement, context.placeholder);
  }

  return result;
};

/**
 * Update the arrow rotation and wrapper's open state attribute.
 *
 * @param arrowElement - The arrow element to rotate
 * @param wrapper - The wrapper element to update the open attribute on
 * @param isOpen - Whether the toggle is open
 */
export const updateArrowState = (arrowElement: HTMLElement, wrapper: HTMLElement, isOpen: boolean): void => {
  arrowElement.style.transform = isOpen ? 'rotate(90deg)' : '';
  wrapper.setAttribute(TOGGLE_ATTR.toggleOpen, String(isOpen));
};

/**
 * Show or hide child block holders based on the toggle's open state.
 * Children are hidden via the 'hidden' CSS class (display: none), not removed from the DOM.
 *
 * @param api - Blok API instance
 * @param blockId - The toggle block's id
 * @param isOpen - Whether the toggle is currently open (expanded)
 */
export const updateChildrenVisibility = (api: API, blockId: string, isOpen: boolean): void => {
  const children = api.blocks.getChildren(blockId);

  for (const child of children) {
    if (isOpen) {
      child.holder.classList.remove('hidden');
    } else {
      child.holder.classList.add('hidden');
    }
  }
};
