/**
 * Toggle Lifecycle - Lifecycle methods for ToggleItem (render, state updates).
 *
 * Extracted from ToggleItem to reduce file size.
 */

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
