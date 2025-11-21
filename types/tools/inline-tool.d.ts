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
}
