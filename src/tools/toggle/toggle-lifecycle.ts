/**
 * Toggle Lifecycle - Lifecycle methods for ToggleItem (render, state updates).
 *
 * Extracted from ToggleItem to reduce file size.
 */

import type { API } from '../../../types';

import { DATA_ATTR } from '../../components/constants/data-attributes';
import { setupPlaceholder } from '../../components/utils/placeholder';

import { TOGGLE_ATTR } from './constants';
import { buildToggleItem } from './dom-builder';
import type { ToggleDOMBuilderContext } from './dom-builder';

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
  bodyPlaceholderElement: HTMLElement;
  childContainerElement: HTMLElement;
}

/**
 * Render a toggle item with placeholder support.
 *
 * @param context - The render context
 * @returns Object containing the wrapper, content, arrow, and body placeholder elements
 */
export const renderToggleItem = (context: ToggleRenderContext): ToggleRenderResult => {
  const result = buildToggleItem(context);

  if (result.contentElement) {
    setupPlaceholder(result.contentElement, context.placeholder, 'data-blok-placeholder-active');
  }

  return result;
};

/**
 * Update the arrow rotation and wrapper's open state attribute.
 *
 * @param arrowEl - The arrow element to rotate
 * @param wrapper - The wrapper element to update the open attribute on
 * @param isOpen - Whether the toggle is open
 */
export const updateArrowState = (
  arrowEl: HTMLElement,
  wrapper: HTMLElement,
  isOpen: boolean,
  ariaLabels: { collapse: string; expand: string } = { collapse: 'Collapse', expand: 'Expand' }
): void => {
  const svg = arrowEl.querySelector('svg');

  if (svg) {
    svg.style.transform = isOpen ? 'rotate(90deg)' : '';
  }

  arrowEl.setAttribute('aria-label', isOpen ? ariaLabels.collapse : ariaLabels.expand);
  arrowEl.setAttribute('aria-expanded', String(isOpen));
  wrapper.setAttribute(TOGGLE_ATTR.toggleOpen, String(isOpen));
};

/**
 * Show or hide child block holders based on the toggle's open state.
 * Children are hidden via the 'hidden' CSS class (display: none), not removed from the DOM.
 *
 * @param api - Blok API instance
 * @param blockId - The toggle block's id
 * @param isOpen - Whether the toggle is currently open (expanded)
 * @param childContainer - Optional child container element for aria-hidden management
 * @param arrowElement - Optional arrow element to receive focus when collapsing with focus inside children
 */
export const updateChildrenVisibility = (
  api: API,
  blockId: string,
  isOpen: boolean,
  childContainer?: HTMLElement | null,
  arrowElement?: HTMLElement | null
): void => {
  const children = api.blocks.getChildren(blockId);

  // Before hiding, check if focus is inside the child container and move it to arrow
  if (!isOpen && childContainer && arrowElement && childContainer.contains(document.activeElement)) {
    arrowElement.focus();
  }

  for (const child of children) {
    const needsMount = childContainer && child.holder.parentElement !== childContainer;

    if (needsMount && !child.holder.closest(`[${DATA_ATTR.nestedBlocks}]`)) {
      childContainer.appendChild(child.holder);
    }

    if (isOpen) {
      child.holder.classList.remove('hidden');
    } else {
      child.holder.classList.add('hidden');
    }
  }

  if (childContainer) {
    if (isOpen) {
      childContainer.removeAttribute('aria-hidden');
    } else {
      childContainer.setAttribute('aria-hidden', 'true');
    }
  }
};

/**
 * Update visibility of the body placeholder based on toggle state and children.
 * The placeholder is shown only when the toggle is open, has no children, and is not read-only.
 *
 * @param bodyPlaceholder - The body placeholder element
 * @param api - Blok API instance
 * @param blockId - The toggle block's id
 * @param isOpen - Whether the toggle is currently open
 * @param readOnly - Whether the editor is in read-only mode
 */
export const updateBodyPlaceholderVisibility = (
  bodyPlaceholder: HTMLElement | null,
  api: API,
  blockId: string,
  isOpen: boolean,
  readOnly: boolean
): void => {
  if (bodyPlaceholder === null) {
    return;
  }

  if (readOnly) {
    bodyPlaceholder.classList.add('hidden');

    return;
  }

  const children = api.blocks.getChildren(blockId);
  const shouldShow = isOpen && children.length === 0;

  if (shouldShow) {
    bodyPlaceholder.classList.remove('hidden');
  } else {
    bodyPlaceholder.classList.add('hidden');
  }
};
