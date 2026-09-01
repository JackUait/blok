import type { ThemeMode, ResolvedTheme } from '../api/theme';
import {ToolConstructable, ToolSettings} from '../tools';
import {API, Blok, LogLevels, LooseOutputData, OutputBlockData, OutputData} from '../index';
import {SanitizerConfig} from './sanitizer-config';
import {I18nConfig} from './i18n-config';
import { BlockMutationEvent } from '../events/block';
import type { BlockMigrations } from '../migrate';
import type { UserInfo } from './user-info';
import type { BlokUploader } from './uploader';
import type { NotifierPosition, NotifierOptions, ConfirmNotifierOptions, PromptNotifierOptions } from './notifier';

/**
 * The versioned answer {@link BlokConfig.persistence}'s `load` may give instead
 * of the document itself, for a store that versions its documents.
 */
export interface PersistedDocument {
  /** The saved document, or `null` for "nothing saved yet". */
  data: OutputData | null;
  /** Whatever your store versions with — an ETag, a revision number, a hash. */
  version?: string;
}

/**
 * Second argument of {@link BlokConfig.persistence}'s `save`.
 */
export interface SaveContext {
  /**
   * The version of the document this save overwrites: what `load` reported,
   * then what the previous `save` returned. `null` until a version is known —
   * including forever, for an endpoint that does not version.
   */
  version: string | null;
}

/**
 * What {@link BlokConfig.persistence}'s `save` may answer with. Returning
 * nothing is fine and leaves the version Blok holds untouched.
 */
export interface SaveResult {
  /** The version the write produced. Omit it and the previous one stands. */
  version?: string;
}

/**
 * Data model format for input/output
 * - 'legacy': Use nested items structure (e.g., List items[] with nested items[])
 * - 'hierarchical': Use flat blocks with parent/content references (Notion-like)
 * - 'auto': Auto-detect input format and preserve it on output (default)
 */
export type DataModelFormat = 'legacy' | 'hierarchical' | 'auto';

/**
 * Side of the content column the floating block controls sit on.
 * See {@link BlokState.toolbarPosition}.
 */
export type BlockControlsPosition = 'left' | 'right';

/**
 * Per-block, per-scenario font-size overrides for {@link BlokConfig.style}.
 *
 * Every value is any valid CSS `font-size` (px, rem, em, clamp(), …) and is
 * applied by writing the block's `--blok-*-font-size` custom property, so the
 * same knob is reachable at runtime through `editor.tokens.set()`.
 *
 * Blocks whose text has one scenario take a bare string; blocks with several
 * (a caption, a density mode, a size variant) take one key per scenario.
 * Omitted keys keep Blok's built-in size.
 */
export interface BlokFontSizeConfig {
  /** Paragraph text. Cascades into callout/toggle/quote children too, which inherit. */
  paragraph?: string;
  /** Heading text, per level. Same tokens the CSS-only `--blok-heading-N-font-size` hooks use. */
  heading?: {
    1?: string;
    2?: string;
    3?: string;
    4?: string;
    5?: string;
    6?: string;
  };
  /** List item text. `checklist` falls back to `item` when omitted. */
  list?: {
    /** Bulleted and ordered item text. */
    item?: string;
    /** Checklist item text. */
    checklist?: string;
  };
  /** Quote text, per `data.size` variant. */
  quote?: {
    /** Default-size quotes. */
    default?: string;
    /** Quotes saved with `size: 'large'` (built-in: 1.2em). */
    large?: string;
  };
  /** Callout text. */
  callout?: string;
  /** Code block text. */
  code?: string;
  /** Toggle title text. */
  toggle?: string;
  /** Table cell text, per text-size setting. */
  table?: {
    /** Cells in the default `compact` density. */
    compact?: string;
    /** Cells while the table's `textSize` is `comfortable`. */
    comfortable?: string;
  };
  /** Image block. */
  image?: {
    /** Caption under the image. */
    caption?: string;
  };
  /** Video block. */
  video?: {
    /** Caption under the player. */
    caption?: string;
  };
  /** Audio block. */
  audio?: {
    /** Caption under the player. */
    caption?: string;
  };
  /** File block. */
  file?: {
    /** Caption under the file card. */
    caption?: string;
  };
  /** Embed block. */
  embed?: {
    /** Caption under the embed. */
    caption?: string;
  };
  /** Bookmark card. */
  bookmark?: {
    /** Card title. */
    title?: string;
    /** Card description. */
    description?: string;
    /** Card link row. */
    link?: string;
  };
}

/**
 * Context handed to {@link BlokConfig.onError} describing where a reported
 * error originated. Modeled as an object (rather than a bare string) so new
 * error sources can be added without a breaking signature change.
 */
export interface BlokErrorContext {
  /**
   * The editor operation that failed. Currently `'save'` is the only source:
   * serialization of the document threw.
   */
  source: 'save';
}

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
   * Mutable at runtime via `readOnly.set(state, { hideControls })`.
   * @default false
   */
  hideControls?: boolean;
}

/**
 * LIVE editor state (the reactive contract).
 *
 * Every field declared here is mutable at runtime through a documented public
 * setter — no editor recreation needed. Fields that are fixed for the
 * instance's life live in {@link BlokMountOptions} instead.
 * `BlokConfig = BlokMountOptions & BlokState`, so existing consumers are
 * unaffected by the split.
 */
export interface BlokState {
  /**
   * If true, the hover toolbar (plus button / drag handle) never opens and the
   * editor gutter reserved for it collapses (the wrapper is stamped with
   * `data-blok-toolbar-hidden`). The keyboard "/" menu keeps working.
   *
   * Runtime setter: `toolbar.setHidden(hidden)`.
   */
  hideToolbar?: boolean;

  /**
   * Which side of the content column the floating block controls (plus button
   * and drag/settings handle) occupy.
   *
   * - `'left'` (default) — the controls live in the editor's inline-START
   *   gutter, the historical placement.
   * - `'right'` — the controls move to the inline-END gutter and the reserved
   *   width moves with them: the start gutter collapses and an equal one opens
   *   at the end, so the text reclaims the space the controls used to occupy.
   *
   * The values name the LTR-physical side and are applied through logical
   * properties, so an RTL editor mirrors them: `'left'` keeps the controls on
   * the physical right (RTL's inline-start), `'right'` moves them to the
   * physical left.
   *
   * Has no effect while `hideToolbar` is true or in chromeless read-only —
   * there are no controls to place.
   *
   * Runtime setter: `toolbar.setPosition(position)`.
   * @default 'left'
   */
  toolbarPosition?: BlockControlsPosition;

  /**
   * Enable read-only mode.
   *
   * Pass `true` for the default Notion-style read-only (block settings toggler
   * and read-only-capable inline tools stay available), or an object to enable
   * read-only with additional options ({@link ReadOnlyModeConfig.hideControls}).
   * Passing an object always enables read-only mode.
   *
   * Runtime setter: `readOnly.set(state, { hideControls })` — toggles in
   * place (see `readOnly.togglesInPlace`), preserving caret, undo history
   * and scroll.
   */
  readOnly?: boolean | ReadOnlyModeConfig;

  /**
   * Defines default toolbar for all tools.
   *
   * Runtime setter: `tools.setInlineToolbar(config)` — re-assigns inline
   * tools for every block tool and recomposes paste-time sanitization.
   */
  inlineToolbar?: string[]|boolean;

  /**
   * Fires when something changed in DOM.
   *
   * Delivery latency is bounded, so this is safe to drive UI from ("document is
   * dirty" -> reveal the Save button). The first change of an idle document is
   * delivered on the next microtask — the same frame the user typed in — and
   * changes arriving after it are coalesced into one further call at the end of
   * a short batch window that later changes never extend. Sustained typing keeps
   * delivering at most one window apart instead of going silent until the user
   * pauses.
   *
   * Never fires while the editor is in read-only mode — read-only is honored at
   * delivery time, so a change queued just before read-only is toggled on is
   * dropped too. You do not need to guard the handler with
   * `api.readOnly.isEnabled`.
   *
   * Its PRESENCE is load-bearing: with neither `onChange` nor `onSave` set, the
   * change-observation pipeline stays disarmed entirely. `onChange` alone arms
   * it — you never need a dummy `onSave` for that, and passing one is actively
   * expensive (it serializes the whole document once per change batch).
   *
   * Presence is re-read live, so it is also fine to start with no handler and
   * attach one later via the runtime setter below; nothing has to be registered
   * up front to keep the option open.
   *
   * Runtime setter: `handlers.set({ onChange })` — pass `undefined` to unset it.
   *
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
   * Serialization rides the trailing edge of the same change-batching window as
   * `onChange`, so a burst of edits costs at most one serialization per window.
   * Unlike `onChange` it has no leading-edge delivery — serializing the whole
   * document is too expensive to front-run the batch with. Only
   * user-driven content changes trigger it — programmatic `render()` does not
   * (the change observer is disabled during render), so a controlled
   * `data → render → onSave → setData` round-trip won't recurse.
   *
   * Never fires while the editor is in read-only mode (honored at delivery
   * time), so the handler needs no `api.readOnly.isEnabled` guard.
   *
   * Its PRESENCE is load-bearing: setting it makes blok serialize the whole
   * document once per change batch. Set it only when you consume the output —
   * wrapping an optional host callback in an always-truthy arrow (`onSave={(d) =>
   * maybeSave?.(d)}`) buys nothing and pays for a full serialization on every
   * change. If you only need the change pipeline armed, use `onChange`.
   *
   * Runtime setter: `handlers.set({ onSave })` — pass `undefined` to unset it.
   *
   * @param data - the full serialized output of the editor
   * @param api - blok.js api
   */
  onSave?(data: OutputData, api: API): void;

  /**
   * Fires when the user presses Enter inside a block, right before blok would
   * split the block or create a new one. Return `true` to mark the event as
   * handled — blok then suppresses its default block split/create (it still
   * calls `preventDefault()` so the browser doesn't insert a native newline).
   * Return `false`/`undefined` to keep the default behavior.
   *
   * Designed for chat-input-style consumers ("Enter sends the message") — pair
   * it with a single-block setup instead of subclassing Paragraph. It never
   * fires for tools with `enableLineBreaks` (e.g. code) or while a
   * popover/toolbar flipper owns the Enter key. It also does not fire for a
   * soft-line-break Shift+Enter — except on iOS, where Safari reports a
   * Shift+Enter for a sentence-ending ". " and blok creates a block instead,
   * so the hook fires there just as it would for a plain Enter.
   *
   * Runtime setter: `handlers.set({ onEnter })` — pass `undefined` to unset it.
   *
   * @param event - the original keydown event
   * @param api - blok.js api
   * @returns true when the event was handled and the default split/create should be suppressed
   */
  onEnter?(event: KeyboardEvent, api: API): boolean | void;

  /**
   * Fires with the full serialized {@link OutputData} when the user presses the
   * Enter that would otherwise create or split a block — the "Enter sends"
   * gesture for chat-input-style consumers. Blok serializes the document for you
   * and suppresses its default block split/create, so you get the current
   * content without wiring `saver.save()` into `onEnter` by hand.
   *
   * It fires on exactly the same Enter as {@link onEnter} (after all the built-in
   * escapes: `enableLineBreaks` tools, an open toolbar flipper, and the
   * soft-line-break Shift+Enter — which is normalized for iOS just like
   * `onEnter`, so you never need a hand-written `event.shiftKey` guard). When
   * both hooks are set, a handled `onEnter` (one returning `true`) takes
   * precedence and suppresses `onSubmit`.
   *
   * Its PRESENCE is load-bearing: setting it is what turns Enter from
   * "split the block" into "serialize and submit". Unset it (rather than
   * pointing it at a no-op function) to restore the default Enter.
   *
   * Runtime setter: `handlers.set({ onSubmit })` — pass `undefined` to unset it.
   *
   * @param data - the full serialized output of the editor
   * @param api - blok.js api
   */
  onSubmit?(data: OutputData, api: API): void;

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
   * Runtime setter: `handlers.set({ onBeforeRender })` — pass `undefined` to
   * unset it.
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
   * Runtime setter: `handlers.set({ onAfterRender })` — pass `undefined` to
   * unset it.
   *
   * @param api - blok.js api
   */
  onAfterRender?(api: API): void;
}

/**
 * Editor options consumed at mount time. Changing one of these through the
 * config requires recreating the editor — though a few have dedicated runtime
 * APIs of their own (`placeholder.set`, `blocks.render` for `data`,
 * `tokens.set` for `style.tokens`). Options whose config value itself is live
 * belong in {@link BlokState} instead; `BlokConfig = BlokMountOptions & BlokState`.
 */
export interface BlokMountOptions {
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
   * Host-supplied per-type block migrations: `{ [blockType]: (data) => data }`.
   *
   * Each rule upgrades a block's stored `data` from an old shape to the current
   * one, and is applied at load BEFORE format analysis — so `dataModel: 'auto'`
   * detects (and on save preserves) the POST-migration shape, and a rule that
   * upgrades a legacy shape is not quietly undone by an 'auto' round-trip. Rules
   * also run again when a block is composed later (e.g. inserted through the
   * API), which is why they must be idempotent. Unlike
   * `upgradeData`, these rules live OUTSIDE the tool class — so a host can
   * migrate a third-party tool it doesn't own, or its own tool without editing
   * the class. Rules must be pure and idempotent; a throwing rule falls back to
   * the stored data (never a blank editor). The same map can be passed to
   * `migrateOutputData` from `@bloklabs/core/migrate` for offline batch upgrades.
   */
  migrations?: BlockMigrations;

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
   * Editor-level uploader, keyed by asset kind rather than by tool.
   *
   * Every media tool routes through it, so one implementation covers images,
   * video, audio and files — and covers assets a tool holds outside its own
   * media family, such as the audio block's cover art (`kind: 'image'`), which
   * has no tool-level uploader of its own.
   *
   * A tool-level `uploader` (e.g. `tools.image.config.uploader`) stays
   * authoritative for its own kind and takes precedence; this is the fallback.
   * Without either, assets become `blob:` URLs that do not survive a reload.
   * @example
   * uploader: {
   *   async uploadByFile(file, { kind, tool }) {
   *     const res = await fetch(`/upload/${kind}`, { method: 'POST', body: file });
   *     return { url: (await res.json()).url };
   *   },
   * }
   */
  /**
   * Base URL of a service speaking Blok's upload and unfurl contracts, e.g.
   * `https://blok.myapp.com` or a same-origin path like `/api/blok`.
   *
   * Shorthand only: it fills in `uploader` and the bookmark tool's `endpoint`
   * if you have not set them yourself. Anything you set explicitly wins, so
   * taking the service for link previews while uploading into your own S3 needs
   * no extra wiring.
   *
   * It does NOT configure document storage — that stays yours.
   */
  server?: string;

  /**
   * Endpoint in YOUR app that mints a short-lived access pass for the signed-in
   * user, answering `{ "ticket": "<pass>" }`. Only needed when `server` points
   * at a standalone service — routes running inside your own app already know
   * who the caller is.
   *
   * The editor caches the pass and replaces it ahead of expiry, and uploads and
   * link previews share the same one.
   */
  ticket?: string;

  /**
   * Load the document on mount and save it as it changes, against YOUR OWN
   * endpoint — the Blok service stores no documents.
   *
   * Two functions rather than a URL: the shape of your endpoint, its auth and
   * the document id are yours, and a URL template would need an option for
   * each. Saves are queued, never run in parallel, and only the newest pending
   * document is sent — otherwise a slow save finishing after a fast one brings
   * stale content back.
   *
   * Setting `onSave` yourself wins: this fills it in only when you have not.
   *
   * Versioning is opt-in and Blok only CARRIES the version: `load` may report
   * one, every `save` is told the version it is overwriting, and the version a
   * `save` returns is what the next one is told. Deciding that a write is stale
   * is your endpoint's job — it owns the storage and the transaction, and Blok
   * storing a second opinion about a record it does not keep would be a second
   * source of truth.
   *
   * A rejecting `save` is retried a few times with a short backoff before
   * `onError` hears about it, and the payload stays queued afterwards so the
   * next change carries it out rather than losing it. While anything is queued
   * or in flight the tab asks for confirmation before it closes. None of this
   * survives a page reload — the queue lives in memory only.
   * @example
   * persistence: {
   *   load: () => fetch('/api/doc/42').then((r) => r.json()),
   *   save: async (data) => { await fetch('/api/doc/42', { method: 'PUT', body: JSON.stringify(data) }); },
   * }
   * @example
   * // Versioned: an ETag in, an ETag out.
   * persistence: {
   *   load: async () => {
   *     const response = await fetch('/api/doc/42');
   *
   *     return { data: await response.json(), version: response.headers.get('etag') ?? undefined };
   *   },
   *   save: async (data, { version }) => {
   *     const response = await fetch('/api/doc/42', {
   *       method: 'PUT',
   *       headers: version === null ? {} : { 'If-Match': version },
   *       body: JSON.stringify(data),
   *     });
   *
   *     return { version: response.headers.get('etag') ?? undefined };
   *   },
   * }
   */
  persistence?: {
    /** Read the document. Return null for "nothing saved yet". */
    load(): Promise<OutputData | PersistedDocument | null>;
    /** Write the document. Called at most once at a time. */
    save(data: OutputData, ctx: SaveContext): Promise<SaveResult | void>;
    /**
     * Called once a save has rejected and its retries are spent — not once per
     * attempt. Without it, failures are silent.
     */
    onError?(error: unknown): void;
  };

  uploader?: BlokUploader;

  /**
   * Turn on real-time multiplayer editing against the `server`'s sync service.
   *
   * Absent, collaboration is off and costs nothing — Blok never opens a socket.
   * Present, the document is loaded from and streamed to the sync service, so
   * two editors pointed at the same `doc` see each other's edits live.
   *
   * - `doc` — the document id shared with the sync service. It becomes one path
   *   segment of the sync URL, so it must be a SINGLE path segment: not empty,
   *   and free of `/`, `%2f`/`%2F`, or a `.`/`..` dot segment. Anything else is
   *   refused at construction (mirrors the server's own 4400 refusal).
   * - `user` — the display identity shown to the other people in the document
   *   (their name, and an optional cursor/avatar `color`). OPTIONAL: without
   *   it this editor still appears to everyone else, as an anonymous avatar in
   *   a colour assigned from the built-in palette, and their peer entry carries
   *   an empty `name`. This is PURELY presentational and is INDEPENDENT of the
   *   {@link BlokMountOptions.user} `{ id }` option, which records edit
   *   attribution on each block: one is "who gets credit for this edit", the
   *   other is "whose cursor is that". Set either, both, or neither.
   *
   * EVERY REGISTERED TOOL MUST SUPPORT READ-ONLY (`static isReadOnlySupported
   * = true`). A collaboration editor boots read-only whatever `readOnly` says —
   * an edit made before the first sync has nowhere to go — so a tool that
   * cannot render read-only fails the contract immediately, and the editor's
   * ready promise REJECTS with a CriticalError naming the tool. This is not
   * special to collaboration; it is the ordinary read-only contract, reached on
   * every collaboration session rather than only when a host asks for
   * `readOnly: true`.
   *
   * Mutually exclusive with {@link BlokMountOptions.persistence}: the sync
   * service owns the whole document round-trip, so a second load/save endpoint
   * would give the document two owners. Requires {@link BlokMountOptions.server}
   * — the sync URL is derived from it. Both are refused at construction.
   *
   * Fixed for the editor's life; changing it requires recreating the editor.
   */
  collaboration?: {
    /** The document id shared with the sync service. Must be a single path segment. */
    doc: string;
    /**
     * The display identity shown to peers — independent of `user: { id }`
     * attribution. Omit it and this editor is still visible to everyone else,
     * drawn as an anonymous avatar in a colour from the presence palette.
     */
    user?: {
      /** Display name shown to the other people in the document. */
      name: string;
      /**
       * Optional cursor/avatar color. HEX ONLY — `#rgb`, `#rgba`, `#rrggbb`
       * or `#rrggbbaa`. The value is written into a CSS custom property, so
       * anything else (`rebeccapurple`, `rgb(...)`, `hsl(...)`) is rejected
       * and silently replaced with a colour assigned from the built-in
       * presence palette.
       */
      color?: string;
    };

    /**
     * Keep a local copy of the document so edits made while disconnected
     * survive a reload, and ship on the next connection. Off by default.
     *
     * OPT-IN ON PURPOSE: it writes document content into this browser's
     * storage for this origin, which is a decision about the host's data, not
     * about the editor. Without it, a reload while the editor says it is
     * offline loses whatever was typed offline — the tab held the only copy.
     *
     * The copy is per browser and per document, and it is DROPPED whenever the
     * server says its history no longer matches (a reset), so a stale copy can
     * never be mistaken for the live document. Nothing is cached until the
     * first successful sync, so an editor that never reached the service still
     * cannot come up editable from a copy of its own.
     *
     * IT IS NOT SCOPED TO A PERSON. The copy belongs to the browser, so on a
     * shared profile the next person to open that page sees the previous
     * one's document on screen before any connection is made — the server
     * refuses them a moment later, but the content was already drawn. If the
     * same browser serves more than one account, give each one its own
     * document ids, or leave this off.
     */
    offline?: boolean;
  };

  /**
   * Data to render on Blok start.
   *
   * Accepts the strict saved shape ({@link OutputData}) as well as the loose
   * wire shape ({@link LooseOutputData}) where `data`/`id`/`time` may be
   * `null` — nulls are normalized at the boundary, so backend DTOs can be
   * passed as-is.
   *
   * A whole-document `null` is also accepted and means "empty document": a
   * controlled consumer holding nullable state (`data={value}` where `value`
   * can be `null`) can pass it straight through. It is normalized to
   * `{ blocks: [] }` at construction and on the reactive re-render path, so it
   * never needs a defensive `value ?? { blocks: [] }`.
   */
  data?: OutputData | LooseOutputData | null;

  /**
   * Height of Blok's bottom area that allows to set focus on the last Block
   */
  minHeight?: number;

  /**
   * Opt-in: clicks on the host page below the editor append a block, with zero
   * layout footprint. Typically paired with `minHeight: 0` to remove the
   * bottom zone entirely.
   *
   * A click appends only when it lands below the editor within its horizontal
   * band, on the background of an element containing the editor (the holder or
   * one of its ancestors) — clicks on sibling host content are ignored. The
   * listener never stops propagation, so host click handlers on those
   * containers still run alongside.
   *
   * @default false
   */
  captureClicksBelowEditor?: boolean;

  /**
   * Blok's log level (how many logs you want to see)
   */
  logLevel?: LogLevels;

  /**
   * Internalization config.
   *
   * Runtime setter: `i18n.update({ locale, messages, direction })` — switches
   * language in place, so caret, focus, selection and undo history survive a
   * language switch (the framework adapters push prop changes through it
   * automatically). `defaultLocale` is the exception: it only decides the
   * fallback while resolving the initial locale, so it is mount-only.
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

    /**
     * Fine-grained trust list for generic embeds. Entries are hostnames
     * (`dashboards.example.com`) or wildcard subdomain patterns
     * (`*.internal.example.dev` — matches any subdomain depth, never the bare
     * suffix). A stored generic embed whose https URL matches an entry is
     * framed; any other generic embed renders as a safe link card instead.
     * `allowGenericEmbed: true` subsumes this list.
     */
    allowedEmbedOrigins?: string[];
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
   * Fires when an editor operation fails in a way blok would otherwise only
   * log. Today the sole source is serialization: when the debounced auto-save
   * (or an explicit `save()`) throws, blok reports the error here instead of
   * silently dropping the output. Pair it with `onSave` to distinguish a
   * successful serialization from a failed one.
   *
   * @param error - the error that was raised
   * @param context - where the error originated (see {@link BlokErrorContext})
   */
  onError?(error: Error, context: BlokErrorContext): void;

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
     * Per-block, per-scenario font sizes. Each entry writes that block's
     * `--blok-*-font-size` custom property, so a host retypes one block from
     * the config instead of targeting Blok's internal class names.
     *
     * Per-tool size config still wins where it exists (`tools.paragraph`'s
     * `styles.size`, the list's `itemSize`) — those are inline styles.
     *
     * Read once at construction. To change a size AFTER mount, write the same
     * token through `editor.tokens.set()`: the theme-token sheet is injected
     * after this one at equal specificity, so it wins. The token NAMES are
     * published as {@link BLOK_FONT_SIZE_TOKENS}, so they never have to be
     * hand-copied.
     *
     * The sheet is scoped to this editor (its wrapper carries
     * `data-blok-instance`), so a second editor on the page keeps its own
     * typography. The one exception is body-mounted UI — popovers and tooltips
     * live outside every editor's subtree, so those rules stay page-level and
     * follow `<head>` order when instances disagree.
     *
     * Callout body text is a child paragraph block: it follows `callout` and
     * falls back to `paragraph` when `callout` is unset.
     * @example
     * ```typescript
     * style: {
     *   fontSize: {
     *     paragraph: '17px',
     *     heading: { 1: '2.25rem', 2: '1.75rem' },
     *     quote: { large: '1.4em' },
     *     table: { comfortable: '17px' },
     *     image: { caption: '13px' },
     *   },
     * }
     * ```
     */
    fontSize?: BlokFontSizeConfig;

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
     *
     * Layout hooks worth knowing by name (all read with a fallback and never
     * declared by Blok, so they also inherit from any ancestor CSS rule):
     * - `--blok-block-padding-top` / `--blok-block-padding-bottom` /
     *   `--blok-block-padding-inline` — the padding of every block wrapper.
     *   Fall back to each tool's historical value (7px/7px/2px for most,
     *   0.2em vertical for quotes), so one override retunes block rhythm
     *   everywhere at once.
     * - `--blok-column-gutter` — the gap between columns (default
     *   `min(2rem, 4vw)`); in edit mode the resize separators carry it.
     * - `--blok-column-min-width` — how far a column may be squeezed, both by
     *   layout and by a resizer drag (default `0`: a column can be dragged all
     *   the way to collapse).
     * - `--blok-block-indent-step` — the indent a nested block gets per level
     *   of nesting (default `24px`; `0px` switches nesting indentation off).
     *   Blok zeroes it inside every `[data-blok-nested-blocks]` child slot, so
     *   a container tool's own children are never indented on top of the
     *   layout it already gives them; declare it on your slot to opt back in.
     *
     * Per-block text sizes have their own names — see
     * {@link BlokFontSizeTokens} / `BLOK_FONT_SIZE_TOKENS`.
     * @example { '--blok-selection': 'rgba(35, 131, 226, 0.28)' }
     */
    tokens?: Record<string, string>;

    /**
     * Opt out of Blok's text-selection repaint inside the editor.
     * When true, the editor wrapper is stamped with `data-blok-native-selection`,
     * Blok's `::selection` rules skip the editor, and selection falls back to the
     * browser/host-defined colors. The fake-background highlight (shown while a
     * menu input holds focus) follows along by using the UA `Highlight` color.
     * Popovers keep Blok's selection color.
     *
     * This is a static config flag rather than a `tokens` key because CSS-wide
     * keywords like `revert` cannot be expressed through a custom property.
     * @default false
     */
    nativeSelection?: boolean;
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

/**
 * Full Blok configuration: the mount-fixed options ({@link BlokMountOptions})
 * plus the live, runtime-mutable state ({@link BlokState}). Structurally
 * identical to the pre-split BlokConfig — existing consumers compile unchanged.
 */
export interface BlokConfig extends BlokMountOptions, BlokState {}

/**
 * Named aliases for the config's callback and nested-object members.
 *
 * A wrapper component (React/Vue/Angular props, a controlled-editor facade)
 * that needs to type one of these handlers otherwise reaches in with
 * `NonNullable<BlokConfig['onSave']>` / `BlokConfig['style']` index-access —
 * which silently breaks the day a field is renamed or its shape is refactored.
 * Bind to these stable names instead. Each is derived from the exact config
 * member, so it can never drift from the option it aliases.
 * ------------------------------------------------------------------------- */

/** {@link BlokMountOptions.onReady} handler. */
export type OnReadyHandler = NonNullable<BlokMountOptions['onReady']>;
/** {@link BlokState.onChange} handler. */
export type OnChangeHandler = NonNullable<BlokState['onChange']>;
/** {@link BlokState.onSave} handler. */
export type OnSaveHandler = NonNullable<BlokState['onSave']>;
/** {@link BlokMountOptions.onError} handler. */
export type OnErrorHandler = NonNullable<BlokMountOptions['onError']>;
/** {@link BlokState.onEnter} handler. */
export type OnEnterHandler = NonNullable<BlokState['onEnter']>;
/** {@link BlokState.onSubmit} handler. */
export type OnSubmitHandler = NonNullable<BlokState['onSubmit']>;
/** {@link BlokState.onBeforeRender} handler. */
export type OnBeforeRenderHandler = NonNullable<BlokState['onBeforeRender']>;
/** {@link BlokState.onAfterRender} handler. */
export type OnAfterRenderHandler = NonNullable<BlokState['onAfterRender']>;
/** {@link BlokMountOptions.onThemeChange} handler. */
export type OnThemeChangeHandler = NonNullable<BlokMountOptions['onThemeChange']>;
/** {@link BlokMountOptions.onBeforePaste} handler. */
export type OnBeforePasteHandler = NonNullable<BlokMountOptions['onBeforePaste']>;
/** {@link BlokMountOptions.style} — the editor style/theming config object. */
export type BlokStyleConfig = NonNullable<BlokMountOptions['style']>;
/** {@link BlokMountOptions.link} — the anchor-building config object. */
export type BlokLinkConfig = NonNullable<BlokMountOptions['link']>;
