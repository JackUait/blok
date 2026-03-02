import { keyCodes } from '../../utils';

/**
 * Map of keyboard event key/code to legacy numeric keyCode values.
 * Used for normalizing keyboard events across different browsers.
 */
export const KEYBOARD_EVENT_KEY_TO_KEY_CODE_MAP: Record<string, number> = {
  Backspace: keyCodes.BACKSPACE,
  Delete: keyCodes.DELETE,
  Enter: keyCodes.ENTER,
  Tab: keyCodes.TAB,
  ArrowDown: keyCodes.DOWN,
  ArrowRight: keyCodes.RIGHT,
  ArrowUp: keyCodes.UP,
  ArrowLeft: keyCodes.LEFT,
};

/**
 * Special keys that should be treated as printable input.
 * These keys produce visible characters even though key.length > 1.
 */
export const PRINTABLE_SPECIAL_KEYS = new Set(['Enter', 'Process', 'Spacebar', 'Space', 'Dead']);

/**
 * CSS selector for editable input elements.
 */
export const EDITABLE_INPUT_SELECTOR = '[contenteditable="true"], textarea, input';

/**
 * Tool name for list blocks.
 */
export const LIST_TOOL_NAME = 'list';

/**
 * Tool name for header blocks.
 */
export const HEADER_TOOL_NAME = 'header';

/**
 * Regex pattern for detecting checklist shortcuts.
 * Matches patterns like "[] ", "[ ] ", "[x] ", "[X] " at the start of text
 * Captures remaining content after the shortcut in group 2
 */
export const CHECKLIST_PATTERN = /^\[(x|X| )?\]\s([\s\S]*)$/;

/**
 * Regex pattern for detecting bulleted list shortcuts.
 * Matches patterns like "- " or "* " at the start of text
 * Captures remaining content after the shortcut in group 1
 */
export const UNORDERED_LIST_PATTERN = /^[-*]\s([\s\S]*)$/;

/**
 * Regex patterns for detecting list shortcuts.
 * Matches patterns like "1. ", "1) ", "2. ", etc. at the start of text
 * Captures remaining content after the shortcut in group 2
 */
export const ORDERED_LIST_PATTERN = /^(\d+)[.)]\s([\s\S]*)$/;

/**
 * Regex pattern for detecting header shortcuts.
 * Matches patterns like "# ", "## ", "### " etc. at the start of text (1-6 hashes)
 * Captures remaining content after the shortcut in group 2
 */
export const HEADER_PATTERN = /^(#{1,6})\s([\s\S]*)$/;

/**
 * Tool name for toggle blocks.
 */
export const TOGGLE_TOOL_NAME = 'toggle';

/**
 * Regex pattern for detecting toggle shortcuts.
 * Matches ">" followed by a space at the start of text.
 * Captures remaining content after the shortcut in group 1.
 */
export const TOGGLE_PATTERN = /^>\s([\s\S]*)$/;
