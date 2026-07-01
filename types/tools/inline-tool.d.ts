import {BaseTool, BaseToolConstructable} from './tool';
import {API, ToolConfig} from '../index';
import { MenuConfig } from './menu-config';
/**
 * Base structure for the Inline Toolbar Tool
 */
export interface InlineTool extends BaseTool<MenuConfig> {
  /**
   * Shortcut for Tool
   * @type {string}
   */
  shortcut?: string;
}


/**
 * Describe constructor parameters
 */
export interface InlineToolConstructorOptions {
  api: API;
  config?: ToolConfig;
}

export interface InlineToolConstructable extends BaseToolConstructable {
  /**
   * Constructor
   *
   * @param {InlineToolConstructorOptions} config - constructor parameters
   */
  new(config: InlineToolConstructorOptions): InlineTool;

  /**
   * Allows inline tool to be available in read-only mode
   * Can be used, for example, by comments tool
   */
  isReadOnlySupported?: boolean;

  /**
   * When true, the tool's keyboard shortcut opens its menu even at a collapsed
   * caret (nothing selected) — for tools that insert at the caret (e.g.
   * Equation) rather than wrap an existing selection (Link, Marker).
   */
  allowCaretShortcut?: boolean;

  /**
   * When true, the tool's keyboard shortcut defers to the browser's native
   * handling at a collapsed caret instead of being intercepted — for format
   * tools with a native browser equivalent (Bold, Italic), so the browser
   * applies its pending inline-format to the next typed characters (the only
   * race-free, cross-engine "toggle then type" behaviour).
   */
  nativeCaretShortcut?: boolean;
}
