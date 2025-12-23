import {ToolConstructable, ToolSettings} from '../tools';
import {API, LogLevels, OutputData} from '../index';
import {SanitizerConfig} from './sanitizer-config';
import {I18nConfig} from './i18n-config';
import { BlockMutationEvent } from '../events/block';

/**
 * Data model format for input/output
 * - 'legacy': Use nested items structure (e.g., List items[] with nested items[])
 * - 'hierarchical': Use flat blocks with parent/content references (Notion-like)
 * - 'auto': Auto-detect input format and preserve it on output (default)
 */
export type DataModelFormat = 'legacy' | 'hierarchical' | 'auto';

export interface BlokConfig {
  /**
   * Element where Blok will be appended
   */
  holder?: string | HTMLElement;

  /**
   * If true, set caret at the first Block after Blok is ready
   */
  autofocus?: boolean;

  /**
   * This Tool will be used as default
   * Name should be equal to one of Tool`s keys of passed tools
   * If not specified, Paragraph Tool will be used
   */
  defaultBlock?: string;

  /**
   * Data model format for input/output.
   * - 'legacy': Always use nested items structure (e.g., List items[] with nested items[])
   * - 'hierarchical': Always use flat blocks with parent/content references (Notion-like)
   * - 'auto': Auto-detect input format and preserve it on output (default)
   *
   * With 'auto', existing articles using legacy format will continue to work unchanged,
   * while new hierarchical data will be preserved as-is.
   *
   * @default 'auto'
   */
  dataModel?: DataModelFormat;



  /**
   * First Block placeholder
   */
  placeholder?: string|false;

  /**
   * Define default sanitizer configuration
   * @see {@link sanitizer}
   */
  sanitizer?: SanitizerConfig;

  /**
   * If true, toolbar won't be shown
   */
  hideToolbar?: boolean;

  /**
   * Maximum number of history entries for undo/redo
   * @default 30
   */
  maxHistoryLength?: number;

  /**
   * Debounce time in milliseconds for batching rapid content changes
   * @default 300
   */
  historyDebounceTime?: number;

  /**
   * Time in milliseconds that determines if a pause between keystrokes creates a new undo group.
   * If the user pauses for longer than this duration, a checkpoint is created.
   * This groups typing into "thought chunks" separated by pauses.
   * @default 500
   */
  newGroupDelay?: number;

  /**
   * Enable document-level undo/redo shortcuts.
   * When true, Cmd+Z / Ctrl+Z and Cmd+Shift+Z / Ctrl+Shift+Z work even when
   * the editor is not focused (e.g., after dragging a block).
   * @default true
   */
  globalUndoRedo?: boolean;

  /**
   * Map of Tools to use
   */
  tools?: {
    [toolName: string]: ToolConstructable|ToolSettings;
  }

  /**
   * Data to render on Blok start
   */
  data?: OutputData;

  /**
   * Height of Blok's bottom area that allows to set focus on the last Block
   */
  minHeight?: number;

  /**
   * Blok's log level (how many logs you want to see)
   */
  logLevel?: LogLevels;

  /**
   * Enable read-only mode
   */
  readOnly?: boolean;

  /**
   * Internalization config
   */
  i18n?: I18nConfig;

  /**
   * Fires when Blok is ready to work
   */
  onReady?(): void;

  /**
   * Fires when something changed in DOM
   * @param api - blok.js api
   * @param event - custom event describing mutation. If several mutations happened at once, they will be batched and you'll get an array of events here.
   */
  onChange?(api: API, event: BlockMutationEvent | BlockMutationEvent[]): void;

  /**
   * Defines default toolbar for all tools.
   */
  inlineToolbar?: string[]|boolean;

  /**
   * Common Block Tunes list. Will be added to all the blocks which do not specify their own 'tunes' set
   */
  tunes?: string[];

  /**
   * Section for style-related settings
   */
  style?: {
    /**
     * A random value to handle Content Security Policy "style-src" policy
     * @see https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/nonce
     */
    nonce?: string;
  }
}
