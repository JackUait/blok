import type { ThemeMode, ResolvedTheme } from '../api/theme';
import {ToolConstructable, ToolSettings} from '../tools';
import {API, Blok, LogLevels, OutputBlockData, OutputData} from '../index';
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

/**
 * Context passed to {@link BlokConfig.link.transform} for a single anchor.
 */
export interface LinkTransformContext {
  /**
   * The anchor's href before transformation. On the render/paste paths this is
   * the stored/pasted href; on the inline-tool path it is the user-entered,
   * validated URL.
   */
  href: string;

  /**
   * The anchor's visible text (`element.textContent`), e.g. so the transform can
   * key off the label as well as the destination. Empty string when the anchor
   * has no text.
   */
  text: string;

  /**
   * The anchor element being built or updated. Provided for context; mutating it
   * directly is discouraged — return the desired attributes instead.
   */
  element: HTMLAnchorElement;
}

/**
 * The attributes {@link BlokConfig.link.transform} may set on an anchor. Every
 * field is optional; anything left `undefined` falls back to the same defaults
 * the shorthand config would produce (see {@link BlokConfig.link}).
 */
export interface LinkTransformResult {
  /**
   * Replacement href. Omit to keep the original href unchanged.
   */
  href?: string;

  /**
   * Replacement `target`. Omit to keep the resolved default (`_self` for
   * same-page destinations, otherwise `link.target ?? '_blank'`).
   */
  target?: string;

  /**
   * Replacement `rel`. Omit to keep `link.rel ?? 'nofollow'`.
   */
  rel?: string;

  /**
   * Extra attributes (e.g. `class`, `title`, `data-*`) to set on the anchor.
   * Applied before the managed `href`/`target`/`rel`, so those stay authoritative
   * even if named here.
   */
  attributes?: Record<string, string>;
}

/**
 * Object form of the `readOnly` option. Passing this object enables read-only mode.
 */
export interface ReadOnlyModeConfig {
  /**
   * When true, all editor controls are hidden while read-only is active:
   * the hover toolbar (settings toggler), the block settings popover and the
   * inline toolbar. Text selection and content-level UI keep working.
   * Config-time only — not mutable at runtime.
   * @default false
   */
  hideControls?: boolean;
}

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
   * Enable read-only mode.
   *
   * Pass `true` for the default Notion-style read-only (block settings toggler
   * and read-only-capable inline tools stay available), or an object to enable
   * read-only with additional options. Passing an object always enables
   * read-only mode.
   */
  readOnly?: boolean | ReadOnlyModeConfig;

  /**
   * Internalization config
   */
  i18n?: I18nConfig;

  /**
   * Configures how Blok builds anchor (`<a>`) elements, so consumers can control
   * the created links instead of post-processing the rendered DOM.
   *
   * Applies on every path that produces anchors:
   * - the interactive **Link inline tool** (links the user creates by hand),
   * - **render** — anchors coming from stored block HTML when `blocks.render()`
   *   runs (e.g. saved articles whose `<a>` never went through the inline tool),
   * - **paste** — `<a>` arriving via the clipboard.
   *
   * On the render and paste paths `target`/`rel` are forced and `transformHref`
   * rewrites the href, exactly as for hand-created links.
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
     *
     * On the inline-tool path it runs after URL validation/normalization, on the
     * final value. On the render and paste paths it runs against each anchor's
     * existing href, so it must be idempotent (re-rendering already-transformed
     * content must not change the result again).
     *
     * @param href - the href to transform
     * @returns the href to set on the anchor
     */
    transformHref?: (href: string) => string;

    /**
     * Richer per-anchor transform. Runs on the same paths as {@link transformHref}
     * (inline tool, render, paste) but receives the full {@link LinkTransformContext}
     * (href, text, element) and may return any subset of {@link LinkTransformResult}
     * — `href`, `target`, `rel`, and extra `attributes` — so consumers can control
     * the whole anchor without post-processing the rendered DOM.
     *
     * Precedence:
     * - when `transform` is provided it supersedes `transformHref`, which is then
     *   ignored (`transform` is the superset — express the same rewrite as
     *   `({ href }) => ({ href: fn(href) })`);
     * - fields left `undefined` (or a `void`/absent return) fall back to the
     *   defaults the shorthand config produces, including the same-page `_self`
     *   rule decided from the original href.
     *
     * Like `transformHref`, it must be idempotent on the render/paste paths: it
     * re-runs against already-transformed anchors on every render, so re-applying
     * it must not change the result again.
     *
     * @param context - the anchor's href, text and element
     * @returns the attributes to set on the anchor, or nothing to keep defaults
     */
    transform?: (context: LinkTransformContext) => LinkTransformResult | void;
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
   * Fires when Blok is ready to work.
   *
   * Receives the fully-initialized {@link Blok} instance, so you can drive the
   * editor's API straight from the handler (mirrors the React/Vue/Angular
   * adapters, whose `ready` events emit the live instance). The argument is
   * optional — existing zero-argument handlers keep working unchanged.
   *
   * @param blok - the ready Blok instance
   */
  onReady?(blok?: Blok): void;

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
   * Transforms the blocks array just before it is rendered, on every render
   * (the initial render and every `blocks.render()` call). Use it to run
   * app-specific data migrations inside Blok instead of pre-processing the
   * data before handing it to the editor.
   *
   * Receives the raw saved blocks (the exact array passed to render, before any
   * format analysis or hierarchical expansion) and must return the blocks to
   * render. Returning an empty array renders an empty document; returning blocks
   * for an empty input injects them.
   *
   * @param blocks - the blocks about to be rendered
   * @returns the blocks to actually render
   */
  onBeforeRender?(blocks: OutputBlockData[]): OutputBlockData[];

  /**
   * Fires after a render completes and the blocks are in the DOM — on the
   * initial render and on every `blocks.render()` call. Use it for post-render
   * side effects (scroll restoration, attaching observers, …). Distinct from
   * `onReady`, which fires once when the editor first becomes ready.
   *
   * @param api - blok.js api
   */
  onAfterRender?(api: API): void;

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

    /**
     * Theme token overrides applied to the editor AND to UI portaled to
     * document.body (popovers, tooltips, top-layer elements) — the piece a
     * host stylesheet scoped to the wrapper cannot reach.
     * Keys must be `--blok-*` custom property names; invalid entries are
     * skipped with a warning.
     * @example { '--blok-selection': 'rgba(35, 131, 226, 0.28)' }
     */
    tokens?: Record<string, string>;
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
