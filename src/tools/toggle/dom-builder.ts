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
  CONTENT_STYLES,
  TOGGLE_ATTR,
  TOGGLE_CHILDREN_STYLES,
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
  /** Callback when the arrow is clicked. Null/undefined disables interaction (read-only mode). */
  onArrowClick: (() => void) | null | undefined;
  /** Callback when the body placeholder is clicked */
  onBodyPlaceholderClick: (() => void) | null;
  /** Translated text for the body placeholder */
  bodyPlaceholderText: string;
  /** Translated aria labels for the toggle arrow */
  ariaLabels: { collapse: string; expand: string };
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
  /** The child container element */
  childContainerElement: HTMLElement;
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

  const arrowElement = buildArrow(isOpen, onArrowClick, {}, context.ariaLabels);
  const contentElement = buildContent(data, readOnly, keydownHandler);

  headerRow.appendChild(arrowElement);
  headerRow.appendChild(contentElement);

  const bodyPlaceholderElement = buildBodyPlaceholder(onBodyPlaceholderClick, context.bodyPlaceholderText);

  const childContainerElement = document.createElement('div');
  childContainerElement.className = TOGGLE_CHILDREN_STYLES;
  childContainerElement.setAttribute(TOGGLE_ATTR.toggleChildren, '');
  // Block DOM mutations inside the children container from triggering the toggle tool's
  // didMutated → syncBlockDataToYjs path. Child block insertions/removals are tracked
  // via the block hierarchy (parentId / contentIds) and must not create spurious Yjs
  // undo entries that split "insert child" into two CMD+Z steps.
  childContainerElement.setAttribute('data-blok-mutation-free', 'true');
  childContainerElement.id = `toggle-children-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  arrowElement.setAttribute('aria-controls', childContainerElement.id);

  wrapper.appendChild(headerRow);
  wrapper.appendChild(bodyPlaceholderElement);
  wrapper.appendChild(childContainerElement);

  return { wrapper, arrowElement, contentElement, bodyPlaceholderElement, childContainerElement };
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
 * @param onArrowClick - Callback when arrow is clicked. Pass null/undefined to disable click interaction (e.g. read-only mode).
 * @param options - Optional configuration
 * @returns The arrow element
 */
export const buildArrow = (
  isOpen: boolean,
  onArrowClick: (() => void) | null | undefined,
  options: BuildArrowOptions = {},
  ariaLabels: { collapse: string; expand: string } = { collapse: 'Collapse', expand: 'Expand' }
): HTMLElement => {
  const arrow = document.createElement('span');
  arrow.className = ARROW_STYLES;
  arrow.setAttribute(TOGGLE_ATTR.toggleArrow, '');
  arrow.setAttribute(DATA_ATTR.mutationFree, 'true');
  arrow.setAttribute('role', 'button');
  arrow.setAttribute('tabindex', '0');
  arrow.setAttribute('aria-label', isOpen ? ariaLabels.collapse : ariaLabels.expand);
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

  if (onArrowClick) {
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
  }

  return arrow;
};

/**
 * Build the body placeholder element shown when the toggle has no children.
 *
 * @param onClick - Optional click handler (creates a child block)
 * @returns The body placeholder element
 */
const buildBodyPlaceholder = (onClick: (() => void) | null, text: string): HTMLElement => {
  const placeholder = document.createElement('div');
  placeholder.className = BODY_PLACEHOLDER_STYLES;
  placeholder.setAttribute(TOGGLE_ATTR.toggleBodyPlaceholder, '');
  // Class changes on the body placeholder (show/hide) must not trigger didMutated →
  // syncBlockDataToYjs, which would create a spurious Yjs undo entry when a child
  // block is inserted via Enter. The placeholder holds no user-editable content.
  placeholder.setAttribute('data-blok-mutation-free', 'true');
  placeholder.textContent = text;

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
