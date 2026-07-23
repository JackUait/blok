/**
 * For export type there should be one entry point,
 * so we export all types from this file
 * ------------------------------------
 */

import {
  BlokConfig,
  I18nConfig,
  I18nDictionary,
  SanitizerConfig,
} from './configs';
import { InlineToolConstructable, InlineToolConstructorOptions, ToolConstructable, ToolSettings } from './tools';

import {
  Blocks,
  Caret,
  Events,
  History,
  InlineToolbar,
  Listeners,
  Marks,
  MarkSpec,
  Notifier,
  ReadOnly,
  Sanitizer,
  Saver,
  Selection,
  Styles,
  Toolbar,
  Tooltip,
  I18n,
  Ui,
  Tools,
  Theme,
  ThemeMode,
  ResolvedTheme,
  Width,
  Placeholder,
  Tokens,
  EditorI18n,
} from './api';

import { LooseOutputData, OutputData } from './data-formats';
import { BlockMutationEvent, BlockMutationEventMap, BlockMutationType } from './events/block';
import { BlockAddedMutationType, BlockAddedEvent } from './events/block/BlockAdded';
import { BlockChangedMutationType, BlockChangedEvent } from './events/block/BlockChanged';
import { BlockMovedMutationType, BlockMovedEvent } from './events/block/BlockMoved';
import { BlockRemovedMutationType, BlockRemovedEvent } from './events/block/BlockRemoved';
import { BlokEditorEventMap, BlockRenderedPayload, BlocksRenderedPayload, I18nChangedPayload } from './events/editor-events';

/**
 * Interfaces used for development
 */
export {
  BaseTool,
  BaseToolConstructable,
  InlineTool,
  InlineToolConstructable,
  InlineToolConstructorOptions,
  BlockToolConstructable,
  BlockToolConstructorOptions,
  BlockTool,
  BlockToolData,
  Tool,
  ToolConstructable,
  ToolboxConfig,
  ToolboxConfigEntry,
  ToolSettings,
  ToolConfig,
  PasteEvent,
  PasteEventDetail,
  PatternPasteEvent,
  PatternPasteEventDetail,
  HTMLPasteEvent,
  HTMLPasteEventDetail,
  FilePasteEvent,
  FilePasteEventDetail,
  MenuConfig,
  MoveEvent,
} from './tools';
export {BlockTune, BlockTuneConstructable, BlockTuneRenderContext} from './block-tunes';
export {
  BlokConfig,
  BlokMountOptions,
  BlokState,
  ReadOnlyModeConfig,
  SanitizerConfig,
  SanitizerRule,
  ToolSanitizerConfig,
  PasteConfig,
  LogLevels,
  ConversionConfig,
  I18nDictionary,
  I18nConfig,
  UserInfo,
} from './configs';

export * from './utils/popover';

export { OutputData, OutputBlockData, LooseOutputData, LooseOutputBlockData} from './data-formats/output-data';
export {
  PropertyType,
  SelectOption,
  SelectPropertyConfig,
  PropertyConfig,
  PropertyDefinition,
  PropertyValue,
  DatabaseRow,
  ViewType,
  SortConfig,
  FilterConfig,
  DatabaseViewConfig,
  DatabaseRowData,
  DatabaseData,
  DatabaseAdapter,
  DatabaseConfig,
} from './tools/database';
export { BlockId } from './data-formats/block-id';
export {
  BlockAPI,
  Blocks,
  Caret,
  Events,
  History,
  InlineToolbar,
  Listeners,
  Marks,
  MarkSnapshot,
  MarkSpec,
  MarkValue,
  Notifier,
  ReadOnly,
  Sanitizer,
  Saver,
  Selection,
  Styles,
  Toolbar,
  Tooltip,
  I18n,
  EditorI18n,
  I18nUpdateOptions,
  Ui,
  Tools,
  Theme,
  ThemeMode,
  ResolvedTheme,
  Width,
  EditorWidth,
  Placeholder,
  Tokens,
} from './api';
export {
  BlockMutationType,
  BlockMutationEvent,
  BlockMutationEventMap,
  BlockAddedMutationType,
  BlockAddedEvent,
  BlockRemovedMutationType,
  BlockRemovedEvent,
  BlockMovedMutationType,
  BlockMovedEvent,
  BlockChangedMutationType,
  BlockChangedEvent,
  BlokEditorEventMap,
  BlockRenderedPayload,
  BlocksRenderedPayload,
  I18nChangedPayload,
}

/**
 * We have a namespace API {@link ./api/index.d.ts} (APIMethods) but we can not use it as interface
 * So we should create new interface for exporting API type
 */
export interface API {
  blocks: Blocks;
  caret: Caret;
  tools: Tools;
  events: Events;
  history: History;
  listeners: Listeners;
  notifier: Notifier;
  sanitizer: Sanitizer;
  saver: Saver;
  selection: Selection;
  /** Range-aware inline-mark operations (see {@link Marks}). */
  marks: Marks;
  styles: Styles;
  toolbar: Toolbar;
  inlineToolbar: InlineToolbar;
  tooltip: Tooltip;
  i18n: I18n;
  readOnly: ReadOnly;
  ui: Ui;
  theme: Theme;
  /** Read-only view of selected editor configuration. */
  config: Readonly<Pick<BlokConfig, 'linkPaste' | 'link'>>;
  rectangleSelection: {
    cancelActiveSelection: () => void;
    isRectActivated: () => boolean;
    clearSelection: () => void;
    startSelection: (pageX: number, pageY: number, shiftKey?: boolean) => void;
    endSelection: () => void;
  };
}

import { DATA_ATTR, DataAttrKey, DataAttrValue, createSelector } from './data-attributes';

export { DATA_ATTR, DataAttrKey, DataAttrValue, createSelector };

/**
 * Blok version string
 */
export const version: string;

/**
 * Structural equality for saved documents. Compares the `blocks` arrays
 * deeply; the volatile `time` and `version` envelope fields are ignored, so a
 * document round-tripped through `save()` compares equal to its echo. Block
 * ids participate only when BOTH sides carry one — the editor mints fresh ids
 * for id-less content, so a legacy document still compares equal to its saved
 * echo. Nullish documents compare equal to `{ blocks: [] }`. Accepts the
 * loose wire shape ({@link LooseOutputData}) as-is.
 * @param a - first document to compare
 * @param b - second document to compare
 */
export function equalsOutputData(
  a: OutputData | LooseOutputData | null | undefined,
  b: OutputData | LooseOutputData | null | undefined,
): boolean;

/**
 * True when the document carries no user content: it is nullish, has no
 * blocks, or every block's data holds only empty values (blank/whitespace
 * strings, empty arrays/objects, nulls). Numbers and booleans are treated as
 * presentation metadata (`level`, `checked`, …) and never count as content.
 * Content-less visual blocks (e.g. a divider with `{}` data) therefore count
 * as empty — check `blocks.length` when mere block presence matters.
 * @param data - document to inspect
 */
export function isEmptyOutputData(data: OutputData | LooseOutputData | null | undefined): boolean;

/**
 * Composes a base sanitizer config from a list of per-tool sanitize configs
 * using the exact merge semantics of the editor's `baseSanitizeConfig`:
 * a later-wins `Object.assign` fold (inline tools first, then tunes).
 * Function rules are carried by reference; rules for the same tag are
 * replaced, never deep-merged.
 * @param configs - sanitize configs in composition order
 */
export function composeBaseSanitizeConfig(configs: SanitizerConfig[]): SanitizerConfig;

/**
 * Derive an inline tool's sanitizer rule from its MarkSpec: allowlists the
 * spec's tag, strips style properties and classes the spec does not declare,
 * and keeps declared attributes. Function-form values are handled by property
 * NAME (names are always known even when values are dynamic), so dynamic
 * values can never be silently dropped on save.
 * @param spec - mark description
 */
export function markSanitizerConfig<State = void>(spec: MarkSpec<State>): SanitizerConfig;

/**
 * Config accepted by {@link defineBlokSchema}. Only `tools`, `inlineToolbar`
 * and `tunes` participate in schema resolution; everything else is passed
 * through untouched via `editorConfig`.
 */
export type BlokSchemaConfig = BlokConfig;

/**
 * A tool resolved from the user config: its constructable plus the Blok-level
 * settings that accompanied it (everything except `class`).
 */
export interface ResolvedSchemaTool {
  toolClass: ToolConstructable;
  settings: Omit<ToolSettings, 'class'>;
}

/**
 * The view side of a defined schema: the composed base sanitize allowlist and
 * the resolved tool map, for consumption by the view renderer.
 */
export interface BlokViewSchema {
  baseSanitize: SanitizerConfig;
  tools: { [toolName: string]: ResolvedSchemaTool };
}

/**
 * Result of {@link defineBlokSchema}.
 */
export interface DefinedBlokSchema<Config extends BlokSchemaConfig = BlokSchemaConfig> {
  editorConfig: Config;
  viewSchema: BlokViewSchema;
}

/**
 * Resolves the composed base sanitize allowlist and tool map for a Blok
 * configuration WITHOUT instantiating an editor. Pure, synchronous and
 * module-scope-safe (no DOM access), so it can run in Node/RSC contexts.
 *
 * Spread `editorConfig` into `new Blok({...})` and hand `viewSchema` to the
 * view renderer: both sides then share the exact same allowlist composition,
 * so a viewer can never silently strip marks the editor wrote.
 * @param config - subset of BlokConfig ({ tools, inlineToolbar, tunes, link, i18n, ... })
 */
export function defineBlokSchema<Config extends BlokSchemaConfig>(config: Config): DefinedBlokSchema<Config>;

/**
 * Compatibility shim for migrating Editor.js custom inline tools.
 * Adapts a legacy Editor.js-style inline tool class (render()→HTMLElement plus
 * surround()/checkState()) into a Blok-compatible inline tool whose render()
 * returns a MenuConfig.
 * @param LegacyToolClass - an Editor.js-style inline tool class
 */
export function wrapLegacyInlineTool(
  LegacyToolClass: new (options: InlineToolConstructorOptions) => {
    render(): HTMLElement | null | undefined;
    surround?(range: Range): void;
    // globalThis.Selection: the DOM type (window.getSelection()), not Blok's
    // imported Selection API, which shadows the global name in this file.
    checkState?(selection?: globalThis.Selection | null): boolean | void;
    renderActions?(): HTMLElement | null | undefined;
    clear?(): void;
  }
): InlineToolConstructable;

/**
 * The surface of a Blok instance that is guaranteed to exist synchronously,
 * immediately after `new Blok()` and before `isReady` has resolved.
 *
 * Blok constructs its module APIs (`blocks`, `caret`, `history`, `readOnly`, …)
 * asynchronously: they only become available once `isReady` resolves. Accessing
 * them earlier returns `undefined` at runtime. Type a reference you hold during
 * that window as `PendingBlok` so the not-yet-available members are unreachable,
 * then await `isReady` to obtain the fully-initialized {@link Blok}:
 *
 * @example
 * const pending: PendingBlok = new Blok(config);
 * const editor = await pending.isReady; // editor is a ready Blok
 * editor.blocks.render(data);
 */
export interface PendingBlok {
  /** Resolves with the fully-initialized Blok instance once core modules are ready. */
  isReady: Promise<Blok>;
  /** Synchronous render-readiness flag; false until the first render batch lands in the DOM. */
  readonly isRendered: boolean;
  /** Destroy the instance. Safe to call before `isReady` resolves. */
  destroy(): void;
  /** Theme API, exposed immediately after construction. */
  theme: Theme;
  /** Width API, exposed immediately after construction. */
  width: Width;
  /** Placeholder API, exposed immediately after construction. */
  placeholder: Placeholder;
  /** Runtime theme-tokens API, exposed immediately after construction. */
  tokens: Tokens;
  /** Runtime i18n API (read + `update`), exposed immediately after construction. */
  i18n: EditorI18n;
}

/** How deep a readiness query looks: boot completion, or content in the DOM. */
export type ReadySettleOn = 'ready' | 'rendered';

/**
 * Narrows a readiness query to a DOM subtree and a readiness depth.
 *
 * An instance that has not finished booting *and* whose wrapper is not
 * attached to the document counts in every scope: it may still turn out to
 * live inside `within` (framework adapters build the editor holder detached
 * and append it later). Over-waiting is safe; under-waiting is a bug.
 */
export interface ReadyScopeOptions {
  /** Only count instances whose wrapper lives inside this element. */
  within?: Element | null;
  /** Readiness depth. Defaults to `'ready'`. */
  settleOn?: ReadySettleOn;
}

/** Synchronous readiness snapshot for a scope. */
export interface ReadyStateSnapshot {
  /** Instances matching the scope. */
  total: number;
  /** Matching instances that are not settled yet. */
  pending: number;
  /** True when nothing in the scope is pending (an empty scope is settled). */
  ready: boolean;
}

/**
 * Main Blok class
 */
export class Blok {
  public isReady: Promise<Blok>;

  /**
   * Synchronous render-readiness flag. True once the current render batch has
   * landed in the DOM (mirrors the `data-blok-rendered` wrapper attribute);
   * false before first render and while a re-render is in flight. Unlike
   * `isReady`/`onReady` this needs no await or callback, so consumers
   * coordinating several editor instances can poll mount state synchronously.
   */
  public readonly isRendered: boolean;

  /**
   * Resolves once every Blok instance in scope has finished booting (each
   * instance's `isReady` has settled — rejections count as settled).
   * Collective-readiness signal for pages hosting several instances (e.g. a
   * list of read-only editors plus a composer): await it before autofocusing
   * or measuring layout, instead of hand-aggregating per-instance `onReady`
   * callbacks.
   *
   * Pass `within` to restrict the wait to instances mounted inside a DOM
   * subtree you own, and `settleOn: 'rendered'` to extend readiness from
   * construction to content-in-the-DOM (which also covers post-boot
   * re-renders). An empty scope resolves immediately.
   *
   * Instances that appear while the returned promise is pending extend the
   * wait; instances constructed after it resolves are not covered — call again
   * for a fresh aggregate, or use `subscribeReady()` for a live signal.
   */
  public static whenAllReady(options?: ReadyScopeOptions): Promise<void>;

  /**
   * Synchronous readiness snapshot for a scope: how many instances match, how
   * many are still pending, and whether the scope is settled. An empty scope
   * reports `ready: true`.
   */
  public static readyState(options?: ReadyScopeOptions): ReadyStateSnapshot;

  /**
   * Subscribes to readiness changes across all instances (construction, boot,
   * render-state flip, destroy) and returns an unsubscribe function. The
   * listener takes no arguments — re-read `Blok.readyState(scope)` when it
   * fires. Pairs with `useSyncExternalStore` and other store adapters.
   */
  public static subscribeReady(listener: () => void): () => void;

  public blocks: Blocks;
  public caret: Caret;
  public history: History;
  public sanitizer: Sanitizer;
  public saver: Saver;
  public selection: Selection;
  public styles: Styles;
  public tools: Tools;
  public toolbar: Toolbar;
  public inlineToolbar: InlineToolbar;
  public tooltip: Tooltip;
  public readOnly: ReadOnly;
  public theme: Theme;
  public width: Width;
  public placeholder: Placeholder;
  public tokens: Tokens;
  /**
   * Runtime i18n API. Everything tools get through `api.i18n` plus
   * `update({ locale, messages, direction })`, which relabels the editor in
   * place instead of forcing a recreation. Exposed immediately after
   * construction; updates issued before `isReady` are replayed once modules exist.
   */
  public i18n: EditorI18n;
  constructor(configuration?: BlokConfig|string);

  /**
   * API shorthands
   */

  /**
   * @see Saver.save
   */
  public save(): Promise<OutputData>;

  /**
   * @see Blocks.clear
   */
  public clear(): Promise<void>;

  /**
   * @see Blocks.render
   */
  public render(data: OutputData | LooseOutputData): Promise<void>;

  /**
   * @see Caret.focus
   */
  public focus(atEnd?: boolean): boolean;

  /**
   * @see Events.on
   */
  public on(eventName: string, callback: (data?: any) => void): void;

  /**
   * @see Events.off
   */
  public off(eventName: string, callback: (data?: any) => void): void;

  /**
   * @see Events.emit
   */
  public emit(eventName: string, data: any): void;

  /**
   * Destroy Blok instance and related DOM elements
   */
  public destroy(): void;
}

export { Blok as EditorJS };
export default Blok;

/**
 * Per-tune persisted data, keyed by tune name. Exposed publicly so the
 * standalone adapter packages (@bloklabs/react, @bloklabs/vue, @bloklabs/angular) can
 * type block tunes without deep-importing into the types tree.
 */
export type { BlockTuneData } from './block-tunes/block-tune-data';
