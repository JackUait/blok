/**
 * DOM Builder - Pure functions for DOM creation.
 *
 * These functions are extracted from ListItem for testability.
 * They create DOM elements without side effects.
 */

import { DATA_ATTR } from '../../components/constants';
import { PLACEHOLDER_CLASSES } from '../../components/utils/placeholder';
import { twMerge } from '../../components/utils/tw';

import {
  INDENT_PER_LEVEL,
  BASE_STYLES,
  ITEM_STYLES,
  CHECKLIST_ITEM_STYLES,
  CHECKBOX_STYLES,
  TOOL_NAME,
} from './constants';
import type { ListItemData, ListItemStyle } from './types';

/**
 * Interface for elements that can store placeholder text before setup
 */
export interface PlaceholderElement extends HTMLElement {
  _placeholder?: string;
}

/**
 * Context object for DOM building operations
 */
export interface DOMBuilderContext {
  /** The list item data */
  data: ListItemData;
  /** Whether the editor is in read-only mode */
  readOnly: boolean;
  /** Placeholder text for empty list items */
  placeholder: string;
  /** Custom item color if configured */
  itemColor?: string;
  /** Custom item size if configured */
  itemSize?: string;
  /** Optional keydown event handler */
  keydownHandler?: ((event: KeyboardEvent) => void) | null;
}

/**
 * Result of building a list item element
 */
export interface BuildResult {
  /** The wrapper element */
  wrapper: HTMLElement;
  /** The content element for text input */
  contentElement: HTMLElement;
  /** The marker element (for bullets/numbers) */
  markerElement: HTMLElement | null;
  /** The checkbox element (for checklists only) */
  checkboxElement: HTMLInputElement | null;
}

/**
 * Build the complete list item DOM structure.
 *
 * @param context - The builder context
 * @returns Object containing the created elements
 */
export function buildListItem(context: DOMBuilderContext): BuildResult {
  const { data, keydownHandler, readOnly } = context;

  const wrapper = buildWrapper(context);

  const itemContent = data.style === 'checklist'
    ? buildChecklistContent(context)
    : buildStandardContent(context);

  wrapper.appendChild(itemContent);

  if (!readOnly && keydownHandler) {
    wrapper.addEventListener('keydown', keydownHandler);
  }

  // Extract element references for the result
  const markerElement = itemContent.querySelector<HTMLElement>('[data-list-marker]');
  const checkboxElement = itemContent.querySelector<HTMLInputElement>('input[type="checkbox"]');
  const contentElement = itemContent.querySelector<HTMLElement>('[contenteditable]');

  return {
    wrapper,
    contentElement: contentElement ?? itemContent,
    markerElement,
    checkboxElement,
  };
}

/**
 * Build the outer wrapper element.
 *
 * @param context - The builder context
 * @returns The wrapper element
 */
export function buildWrapper(context: DOMBuilderContext): HTMLElement {
  const { data } = context;

  const wrapper = document.createElement('div');
  wrapper.className = BASE_STYLES;
  wrapper.setAttribute(DATA_ATTR.tool, TOOL_NAME);
  wrapper.setAttribute('data-list-style', data.style);
  wrapper.setAttribute('data-list-depth', String(data.depth ?? 0));

  // Store start value as data attribute for sibling items to read
  if (data.start !== undefined && data.start !== 1) {
    wrapper.setAttribute('data-list-start', String(data.start));
  }

  return wrapper;
}

/**
 * Build standard content (for unordered and ordered lists).
 *
 * @param context - The builder context
 * @returns The list item element containing marker and content
 */
export function buildStandardContent(context: DOMBuilderContext): HTMLElement {
  const { data, itemColor, itemSize, placeholder } = context;

  const item = document.createElement('div');
  item.setAttribute('role', 'listitem');
  item.className = twMerge(ITEM_STYLES, 'flex', ...PLACEHOLDER_CLASSES);

  // Apply custom styles if configured
  if (itemColor) {
    item.style.color = itemColor;
  }
  if (itemSize) {
    item.style.fontSize = itemSize;
  }

  // Apply indentation based on depth
  const depth = data.depth ?? 0;
  if (depth > 0) {
    item.style.marginLeft = `${depth * INDENT_PER_LEVEL}px`;
  }

  // Create marker element
  const marker = createMarker(data.style, depth);
  marker.setAttribute('data-list-marker', 'true');
  marker.setAttribute('data-blok-mutation-free', 'true');
  item.appendChild(marker);

  // Create content container
  const contentContainer = document.createElement('div');
  contentContainer.className = twMerge('flex-1 min-w-0 outline-none', ...PLACEHOLDER_CLASSES);
  contentContainer.contentEditable = context.readOnly ? 'false' : 'true';
  contentContainer.innerHTML = data.text;

  // Store placeholder for setup by caller
  (contentContainer as PlaceholderElement)._placeholder = placeholder;

  item.appendChild(contentContainer);

  return item;
}

/**
 * Build checklist content with checkbox.
 *
 * @param context - The builder context
 * @returns The checklist item element
 */
export function buildChecklistContent(context: DOMBuilderContext): HTMLElement {
  const { data, itemColor, itemSize, placeholder, readOnly } = context;

  const wrapper = document.createElement('div');
  wrapper.setAttribute('role', 'listitem');
  wrapper.className = CHECKLIST_ITEM_STYLES;

  // Apply custom styles if configured
  if (itemColor) {
    wrapper.style.color = itemColor;
  }
  if (itemSize) {
    wrapper.style.fontSize = itemSize;
  }

  // Apply indentation based on depth
  const depth = data.depth ?? 0;
  if (depth > 0) {
    wrapper.style.marginLeft = `${depth * INDENT_PER_LEVEL}px`;
  }

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = CHECKBOX_STYLES;
  checkbox.checked = Boolean(data.checked);
  checkbox.disabled = readOnly;

  const content = document.createElement('div');
  content.className = twMerge(
    'flex-1 outline-none leading-[1.6em]',
    data.checked ? 'line-through opacity-60' : '',
    ...PLACEHOLDER_CLASSES
  );
  content.contentEditable = readOnly ? 'false' : 'true';
  content.innerHTML = data.text;

  // Store placeholder for setup by caller
  (content as PlaceholderElement)._placeholder = placeholder;

  wrapper.appendChild(checkbox);
  wrapper.appendChild(content);

  return wrapper;
}

/**
 * Create the marker element (bullet or number) for a list item.
 *
 * @param style - The list item style
 * @param depth - The nesting depth
 * @returns The marker element
 */
export function createMarker(style: ListItemStyle, depth: number): HTMLElement {
  const marker = document.createElement('span');
  marker.className = 'flex-shrink-0 select-none';
  marker.setAttribute('aria-hidden', 'true');
  marker.contentEditable = 'false';

  if (style === 'ordered') {
    // Placeholder marker - will be updated by OrderedMarkerManager
    marker.textContent = '1.';
    marker.className = twMerge(marker.className, 'text-right');
    marker.style.paddingRight = '11px';
    marker.style.minWidth = 'fit-content';
  } else {
    const bulletChar = getBulletCharacter(depth);
    marker.textContent = bulletChar;
    marker.className = twMerge(marker.className, 'w-6 text-center flex justify-center');
    marker.style.paddingLeft = '1px';
    marker.style.paddingRight = '13px';
    marker.style.fontSize = '24px';
    marker.style.fontFamily = 'Arial';
  }

  return marker;
}

/**
 * Get the bullet character based on nesting depth.
 *
 * @param depth - The nesting depth
 * @returns The bullet character
 */
export function getBulletCharacter(depth: number): string {
  const bullets = ['•', '◦', '▪'];
  return bullets[depth % bullets.length];
}
