/**
 * DOM Builder - Pure functions for DOM creation.
 *
 * These functions are extracted from ToggleItem for testability.
 * They create DOM elements without side effects.
 */

import { DATA_ATTR } from '../../components/constants';
import { twMerge } from '../../components/utils/tw';

import {
  ARROW_ICON,
  ARROW_STYLES,
  BASE_STYLES,
  CONTENT_STYLES,
  TOGGLE_ATTR,
  TOGGLE_WRAPPER_STYLES,
  TOOL_NAME,
} from './constants';
import type { ToggleItemData } from './types';

/**
 * Context object for DOM building operations
 */
export interface ToggleDOMBuilderContext {
  /** The toggle item data */
  data: ToggleItemData;
  /** Whether the editor is in read-only mode */
  readOnly: boolean;
  /** Whether the toggle is open (expanded) */
  isOpen: boolean;
  /** Optional keydown event handler */
  keydownHandler: ((event: KeyboardEvent) => void) | null;
  /** Callback when the arrow is clicked */
  onArrowClick: () => void;
}

/**
 * Result of building a toggle item element
 */
export interface ToggleBuildResult {
  /** The wrapper element */
  wrapper: HTMLElement;
  /** The arrow element for expanding/collapsing */
  arrowElement: HTMLElement;
  /** The content element for text input */
  contentElement: HTMLElement;
}

/**
 * Build the complete toggle item DOM structure.
 *
 * @param context - The builder context
 * @returns Object containing the created elements
 */
export const buildToggleItem = (context: ToggleDOMBuilderContext): ToggleBuildResult => {
  const { data, readOnly, isOpen, keydownHandler, onArrowClick } = context;

  const wrapper = document.createElement('div');
  wrapper.className = twMerge(BASE_STYLES, TOGGLE_WRAPPER_STYLES);
  wrapper.setAttribute(DATA_ATTR.tool, TOOL_NAME);
  wrapper.setAttribute(TOGGLE_ATTR.toggleOpen, String(isOpen));

  const arrowElement = buildArrow(isOpen, onArrowClick);
  const contentElement = buildContent(data, readOnly, keydownHandler);

  wrapper.appendChild(arrowElement);
  wrapper.appendChild(contentElement);

  return { wrapper, arrowElement, contentElement };
};

/**
 * Build the arrow element for toggling open/closed state.
 *
 * @param isOpen - Whether the toggle is currently open
 * @param onArrowClick - Callback when arrow is clicked
 * @returns The arrow element
 */
const buildArrow = (isOpen: boolean, onArrowClick: () => void): HTMLElement => {
  const arrow = document.createElement('div');
  arrow.className = ARROW_STYLES;
  arrow.setAttribute(TOGGLE_ATTR.toggleArrow, '');
  arrow.setAttribute('role', 'button');
  arrow.setAttribute('tabindex', '-1');
  arrow.setAttribute('aria-label', 'Toggle');
  arrow.innerHTML = ARROW_ICON;

  if (isOpen) {
    arrow.style.transform = 'rotate(90deg)';
  }

  arrow.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation();
    onArrowClick();
  });

  return arrow;
};

/**
 * Build the content element for text input.
 *
 * @param data - The toggle item data
 * @param readOnly - Whether the editor is read-only
 * @param keydownHandler - Optional keydown event handler
 * @returns The content element
 */
const buildContent = (
  data: ToggleItemData,
  readOnly: boolean,
  keydownHandler: ((event: KeyboardEvent) => void) | null
): HTMLElement => {
  const content = document.createElement('div');
  content.className = CONTENT_STYLES;
  content.setAttribute(TOGGLE_ATTR.toggleContent, '');
  content.contentEditable = readOnly ? 'false' : 'true';
  content.innerHTML = data.text;

  if (keydownHandler) {
    content.addEventListener('keydown', keydownHandler);
  }

  return content;
};
