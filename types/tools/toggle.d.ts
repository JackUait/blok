import { BlockTool, BlockToolConstructable, BlockToolConstructorOptions, BlockToolData } from './block-tool';

/**
 * Toggle Tool's input and output data format
 */
export interface ToggleData extends BlockToolData {
  /** Toggle item text content (can include HTML) */
  text: string;
  /** Whether the toggle is open (expanded). Persisted on save so state is restored on reload. */
  isOpen?: boolean;
}

/**
 * Toggle Tool's configuration
 */
export interface ToggleConfig {
  /** Custom placeholder text for empty toggle items */
  placeholder?: string;
}

export interface ToggleConstructable extends BlockToolConstructable {
  new(options: BlockToolConstructorOptions<ToggleData, ToggleConfig>): BlockTool;
}
