import { BlockToolAdapter } from '../tools/adapters/block-tool-adapter';
import { ToolConfig, ToolConstructable, ToolSettings, ToolboxConfig } from '../tools';
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

  /**
   * Shallow-merges new configuration into an already-installed tool, without
   * recreating the editor. Useful for swapping config at runtime — e.g. pointing
   * an image tool at a new uploader function.
   *
   * The merge targets the tool's `config` object (the part passed to the tool
   * constructor). Blocks created after the call (and the next operation on the
   * live tool) pick up the new config; blocks already mounted keep their current
   * config until they are re-rendered.
   *
   * A `toolbox` key is treated as the tool-level SETTING (same as `toolbox` in
   * the `tools` map), not nested tool config: pass `toolbox: false` to hide the
   * tool from insertion surfaces at runtime (existing blocks keep rendering) or
   * a toolbox object to (re)show it — e.g. permission-based insert gating
   * without recreating the editor.
   * @param name - registered tool name
   * @param config - partial tool config to merge in, optionally with a
   * tool-level `toolbox` setting
   * @throws if `name` is not a registered tool
   */
  update(name: string, config: Partial<ToolConfig> & { toolbox?: ToolboxConfig | false }): void;
}
