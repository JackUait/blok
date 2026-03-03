/**
 * DOM Builder - Pure functions for DOM creation.
 *
 * These functions are extracted from ToggleItem for testability.
 * They create DOM elements without side effects.
 */

import { DATA_ATTR } from '../../components/constants';
import { PLACEHOLDER_ACTIVE_CLASSES, PLACEHOLDER_EMPTY_EDITOR_CLASSES } from '../../components/utils/placeholder';
import { twMerge } from '../../components/utils/tw';

import {
  ARROW_ICON,
  ARROW_STYLES,
  BASE_STYLES,
  BODY_PLACEHOLDER_STYLES,
  BODY_PLACEHOLDER_TEXT,
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
  /** Callback when the body placeholder is clicked */
  onBodyPlaceholderClick: (() => void) | null;
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
  /** The body placeholder element */
  bodyPlaceholderElement: HTMLElement;
}

/**
 * Build the complete toggle item DOM structure.
 *
 * @param context - The builder context
 * @returns Object containing the created elements
 */
export const buildToggleItem = (context: ToggleDOMBuilderContext): ToggleBuildResult => {
  const { data, readOnly, isOpen, keydownHandler, onArrowClick, onBodyPlaceholderClick } = context;

  const wrapper = document.createElement('div');
  wrapper.className = BASE_STYLES;
  wrapper.setAttribute(DATA_ATTR.tool, TOOL_NAME);
  wrapper.setAttribute(TOGGLE_ATTR.toggleOpen, String(isOpen));

  const headerRow = document.createElement('div');
  headerRow.className = TOGGLE_WRAPPER_STYLES;

  const arrowElement = buildArrow(isOpen, onArrowClick);
  const contentElement = buildContent(data, readOnly, keydownHandler);

  headerRow.appendChild(arrowElement);
  headerRow.appendChild(contentElement);

  const bodyPlaceholderElement = buildBodyPlaceholder(onBodyPlaceholderClick);

  wrapper.appendChild(headerRow);
  wrapper.appendChild(bodyPlaceholderElement);

  return { wrapper, arrowElement, contentElement, bodyPlaceholderElement };
};

/**
 * Options for building arrow element
 */
export interface BuildArrowOptions {
  /** Set contentEditable="false" on the arrow (used by Header to prevent caret entering arrow) */
  contentEditableFalse?: boolean;
}

/**
 * Build the arrow element for toggling open/closed state.
 *
 * @param isOpen - Whether the toggle is currently open
 * @param onArrowClick - Callback when arrow is clicked
 * @param options - Optional configuration
 * @returns The arrow element
 */
export const buildArrow = (
  isOpen: boolean,
  onArrowClick: () => void,
  options: BuildArrowOptions = {}
): HTMLElement => {
  const arrow = document.createElement('span');
  arrow.className = ARROW_STYLES;
  arrow.setAttribute(TOGGLE_ATTR.toggleArrow, '');
  arrow.setAttribute(DATA_ATTR.mutationFree, 'true');
  arrow.setAttribute('role', 'button');
  arrow.setAttribute('tabindex', '0');
  arrow.setAttribute('aria-label', isOpen ? 'Collapse' : 'Expand');
  arrow.setAttribute('aria-expanded', String(isOpen));

  if (options.contentEditableFalse === true) {
    arrow.contentEditable = 'false';
  }

  arrow.innerHTML = ARROW_ICON;

  const svg = arrow.querySelector('svg');

  if (svg) {
    svg.style.transition = 'transform 200ms ease-in-out';

    if (isOpen) {
      svg.style.transform = 'rotate(90deg)';
    }
  }

  arrow.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation();
    onArrowClick();
  });

  arrow.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      onArrowClick();
    }
  });

  return arrow;
};

/**
 * Build the body placeholder element shown when the toggle has no children.
 *
 * @param onClick - Optional click handler (creates a child block)
 * @returns The body placeholder element
 */
const buildBodyPlaceholder = (onClick: (() => void) | null): HTMLElement => {
  const placeholder = document.createElement('div');
  placeholder.className = BODY_PLACEHOLDER_STYLES;
  placeholder.setAttribute(TOGGLE_ATTR.toggleBodyPlaceholder, '');
  placeholder.textContent = BODY_PLACEHOLDER_TEXT;

  if (onClick) {
    placeholder.addEventListener('click', onClick);
  }

  return placeholder;
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
  content.className = twMerge(CONTENT_STYLES, PLACEHOLDER_ACTIVE_CLASSES, PLACEHOLDER_EMPTY_EDITOR_CLASSES);
  content.setAttribute(TOGGLE_ATTR.toggleContent, '');
  content.contentEditable = readOnly ? 'false' : 'true';
  content.innerHTML = data.text;

  if (keydownHandler) {
    content.addEventListener('keydown', keydownHandler);
  }

  return content;
};
