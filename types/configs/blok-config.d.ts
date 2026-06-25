import type { ThemeMode, ResolvedTheme } from '../api/theme';
import {ToolConstructable, ToolSettings} from '../tools';
import {API, LogLevels, OutputData} from '../index';
import {SanitizerConfig} from './sanitizer-config';
import {I18nConfig} from './i18n-config';
import { BlockMutationEvent } from '../events/block';
import type { UserInfo } from './user-info';
import type { NotifierPosition, NotifierOptions, ConfirmNotifierOptions, PromptNotifierOptions } from './notifier';

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
   * Transform or clean the raw clipboard HTML before Blok processes it.
   * Runs on the unmodified `text/html` payload, before any Blok preprocessing
   * or sanitization, so you no longer need a capture-phase paste interceptor.
   *
   * @param html - the raw `text/html` clipboard string
   * @returns the transformed HTML to feed into the rest of the paste pipeline,
   *          or `null` to skip the HTML paste path (paste falls through to plain text).
   */
  onBeforePaste?: (html: string) => string | null;

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
   * Configures how the Link inline tool builds anchor elements, so consumers can
   * control the created `<a>` instead of post-processing the rendered DOM.
   */
  link?: {
    /**
     * `target` attribute applied to created anchors.
     * @default '_blank'
     */
    target?: string;

    /**
     * `rel` attribute applied to created anchors.
     * @default 'nofollow'
     */
    rel?: string;

    /**
     * Transforms the href just before it is assigned to the anchor.
     * Runs after URL validation/normalization, on the final value.
     * @param href - the validated, protocol-normalized href
     * @returns the href to set on the anchor
     */
    transformHref?: (href: string) => string;
  };

  /**
   * Notion-style link-paste behavior. Pasting a URL always opens a small menu
   * (Plain link / Bookmark / Embed) instead of auto-inserting a block.
   */
  linkPaste?: {
    /**
     * When true, pasting a URL that matches no registered embed provider still
     * offers "Create embed", framing it in a sandboxed iframe. Default false keeps
     * blok's registry-only embed guarantee.
     * @default false
     */
    allowGenericEmbed?: boolean;
  };

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
   * Fires with the full serialized {@link OutputData} whenever the content
   * changes. This is the "output half" of a controlled editor: pair it with the
   * `data` config (or the React `data` prop) to mirror the editor state into your
   * own store with a single callback instead of calling `saver.save()` by hand.
   *
   * Serialization is debounced through the same change-batching window as
   * `onChange`, so a burst of edits produces a single `onSave` call. Only
   * user-driven content changes trigger it — programmatic `render()` does not
   * (the change observer is disabled during render), so a controlled
   * `data → render → onSave → setData` round-trip won't recurse.
   *
   * @param data - the full serialized output of the editor
   * @param api - blok.js api
   */
  onSave?(data: OutputData, api: API): void;

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

    /**
     * Custom font family for the entire editor UI (content area, toolbars, popovers).
     * Accepts any valid CSS font-family value.
     * @example 'Inter, sans-serif'
     */
    fontFamily?: string;

    /**
     * Custom sans-serif font family. Overrides the `--blok-font-sans` CSS variable.
     * @example "'Inter', sans-serif"
     */
    fontFamilySans?: string;

    /**
     * Custom serif font family. Overrides the `--blok-font-serif` CSS variable.
     * @example "'Merriweather', serif"
     */
    fontFamilySerif?: string;

    /**
     * Custom monospace font family. Overrides the `--blok-font-mono` CSS variable.
     * @example "'Fira Code', monospace"
     */
    fontFamilyMono?: string;

    /**
     * Custom handwriting font family. Overrides the `--blok-font-handwriting` CSS variable.
     * @example "'Caveat', cursive"
     */
    fontFamilyHandwriting?: string;

    /**
     * Global content alignment within the editor.
     * Controls whether block content is left-aligned, centered, or right-aligned.
     * @default 'left'
     */
    contentAlign?: 'left' | 'center' | 'right';
  }

  /**
   * Color theme mode.
   * - 'auto': follow OS preference via prefers-color-scheme (default)
   * - 'light': force light theme
   * - 'dark': force dark theme
   */
  theme?: ThemeMode;

  /**
   * Called when the resolved theme changes (e.g. OS preference switches in 'auto' mode).
   * Does not fire on initialization — only on subsequent changes.
   * @param resolvedTheme - the resolved theme ('dark' or 'light')
   */
  onThemeChange?: (resolvedTheme: ResolvedTheme) => void;

  /**
   * Options for the automatic scroll-to-block behavior on hash navigation.
   * When the page URL contains a hash (`#<blockId>`) that matches a block ID,
   * the editor smooth-scrolls to that block once all blocks are rendered.
   * This behavior is always active — this config object only controls offset.
   * No-op if the URL contains no hash or the hash does not match any block ID.
   */
  scrollToBlock?: {
    /**
     * Pixels to leave above the block when scrolling into view.
     * Useful when a sticky header is present.
     * @default 0
     */
    topOffset?: number;
  };

  /**
   * User identity for edit tracking.
   * When set, the user's ID is recorded on each block they edit.
   */
  user?: {
    /**
     * Stable unique identifier for the current editor.
     * Stored on each block the user edits.
     */
    id: string;
  };

  /**
   * Resolves a user ID to display information.
   * Called when Blok needs to show who edited a block (e.g., block settings footer).
   * Can return synchronously or asynchronously.
   * Return null/undefined for unknown users — Blok will fall back to showing only the date.
   */
  resolveUser?: (id: string) => UserInfo | Promise<UserInfo | null> | null;

  /**
   * Position of the notification (toast) container on screen.
   * @default 'bottom-center' — see DEFAULT_NOTIFIER_POSITION
   */
  notifierPosition?: NotifierPosition;

  /**
   * Custom notifier handler.
   * When provided, Blok calls this function instead of showing the built-in DOM notification.
   * Your implementation receives the same options object that the built-in notifier accepts.
   * @param options - notification options (message, style, type, time, etc.)
   */
  notifier?: (options: NotifierOptions | ConfirmNotifierOptions | PromptNotifierOptions) => void;
}
