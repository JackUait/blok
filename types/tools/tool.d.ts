import {API} from '../index';
import {ToolConfig} from './tool-config';
import {SanitizerConfig} from '../configs';
import {MenuConfig} from './menu-config';

/**
 * Abstract interface of all Tools
 */
export interface BaseTool<RenderReturnType = HTMLElement> {
  /**
   * Tool`s render method
   *
   * For Inline Tools returns {@link MenuConfig}
   *
   * For Block Tools returns tool`s wrapper html element
   */
  render(): RenderReturnType | Promise<RenderReturnType>;
}

export interface BaseToolConstructorOptions<C extends object = any> {
  /**
   * Blok API
   */
  api: API;

  /**
   * Tool configuration
   */
  config?: ToolConfig<C>;
}

export interface BaseToolConstructable {
  /**
   * Define Tool type as Inline
   */
  isInline?: boolean;

  /**
   * Tool`s sanitizer configuration
   */
  sanitize?: SanitizerConfig;

  /**
   * Shortcut for Tool
   */
  shortcut?: string;

  /**
   * Title of Inline Tool.
   * @deprecated use {@link MenuConfig} item title instead
   */
  title?: string;

  /**
   * Translation key for the tool title (e.g., 'bold', 'italic', 'link').
   * Used to look up translations in the toolNames.* namespace.
   */
  titleKey?: string;

  /**
   * Optional manifest declaring the block types this class supplies. A class
   * with `provides` is a registration group/handle, not a renderable block:
   * registering it under any key expands to the listed block tools, and the
   * handle key itself is dropped (it is not a block type). Used to register a
   * multi-block feature (e.g. columns -> column_list + column) under one key.
   *
   * Typed as BaseToolConstructable to avoid a circular import with
   * BlockToolConstructable; the provided classes are block tools at runtime.
   */
  provides?: { [blockType: string]: BaseToolConstructable };

  /**
   * Tool`s prepare method. Can be async
   * @param data
   */
  prepare?(data: {toolName: string, config: ToolConfig}): void | Promise<void>;

  /**
   * Tool`s reset method to clean up anything set by prepare. Can be async
   */
  reset?(): void | Promise<void>;
}
