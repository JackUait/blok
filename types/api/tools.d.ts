import { BlockToolAdapter } from '../tools/adapters/block-tool-adapter';
import { ToolConstructable, ToolSettings } from '../tools';
import { ThemeMode } from './theme';

/**
 * Tools-related configuration that can be passed to a nested Blok instance.
 */
export interface ToolsConfig {
  tools: { [toolName: string]: ToolConstructable | ToolSettings } | undefined;
  inlineToolbar?: string[] | boolean;
  tunes?: string[];
  theme?: ThemeMode;
}

/**
 * Describes methods for accessing installed Blok tools
 */
export interface Tools {
  /**
   * Returns all available Block Tools
   */
  getBlockTools(): BlockToolAdapter[];

  /**
   * Returns the tools-related configuration of the current editor instance.
   * Useful for creating nested Blok editors with the same tools.
   */
  getToolsConfig(): ToolsConfig;
}
