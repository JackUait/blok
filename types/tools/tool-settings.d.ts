import { ToolConfig } from './tool-config';
import { ToolConstructable, BlockToolData, MenuConfig, MenuConfigItem } from './index';

/**
 * Permissive type for tool class - accepts any constructor.
 * Runtime validation ensures the tool has required methods.
 */
export type ToolClass = new (...args: any[]) => any;

/**
 * Tool may specify its toolbox configuration
 * It may include several entries as well
 */
export type ToolboxConfig = ToolboxConfigEntry | ToolboxConfigEntry[];

/**
 * Tool's Toolbox settings
 */
export interface ToolboxConfigEntry {
  /**
   * Tool title for Toolbox (human-readable fallback)
   */
  title?: string;

  /**
   * Translation key for the title (e.g., 'text', 'heading', 'bulletedList').
   * Used to look up translations in the toolNames.* namespace.
   * If provided, the translated value is used; otherwise falls back to title.
   */
  titleKey?: string;

  /**
   * HTML string with an icon for Toolbox
   */
  icon?: string;

  /**
   * May contain overrides for tool default data
   */
  data?: BlockToolData;

  /**
   * Unique name for the toolbox entry, used for data-blok-item-name attribute.
   * If not provided, falls back to the tool name.
   * Useful when a tool has multiple toolbox entries (e.g., list with ordered/unordered/checklist variants).
   */
  name?: string;
}

/**
 * Object passed to the Tool's constructor by {@link BlokConfig#tools}
 *
 * @template Config - the structure describing a config object supported by the tool
 */
export interface ExternalToolSettings<Config extends object = any> {

  /**
   * Tool's class - accepts any constructor, validated at runtime
   */
  class: ToolConstructable | ToolClass;

  /**
   * User configuration object that will be passed to the Tool's constructor
   */
  config?: ToolConfig<Config>;

  /**
   * Is need to show Inline Toolbar.
   * Can accept array of Tools for InlineToolbar or boolean.
   */
  inlineToolbar?: boolean | string[];

  /**
   * BlockTunes for Tool
   * Can accept array of tune names or boolean.
   */
  tunes?: boolean | string[];

  /**
   * Define shortcut that will render Tool
   */
  shortcut?: string;

  /**
   * Tool's Toolbox settings
   * It will be hidden from Toolbox when false is specified.
   */
  toolbox?: ToolboxConfig | false;
}

/**
 * For internal Tools 'class' property is optional
 */
export type InternalToolSettings<Config extends object = any> = Omit<ExternalToolSettings<Config>, 'class'> & Partial<Pick<ExternalToolSettings<Config>, 'class'>>;

/**
 * Union of external and internal Tools settings
 */
export type ToolSettings<Config extends object = any> = InternalToolSettings<Config> | ExternalToolSettings<Config>;
