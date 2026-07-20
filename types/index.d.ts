/**
 * For export type there should be one entry point,
 * so we export all types from this file
 * ------------------------------------
 */

import {
  BlokConfig,
  I18nConfig,
  I18nDictionary,
} from './configs';
import { InlineToolConstructable, InlineToolConstructorOptions } from './tools';

import {
  Blocks,
  Caret,
  Events,
  History,
  InlineToolbar,
  Listeners,
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
} from './api';

import { LooseOutputData, OutputData } from './data-formats';
import { BlockMutationEvent, BlockMutationEventMap, BlockMutationType } from './events/block';
import { BlockAddedMutationType, BlockAddedEvent } from './events/block/BlockAdded';
import { BlockChangedMutationType, BlockChangedEvent } from './events/block/BlockChanged';
import { BlockMovedMutationType, BlockMovedEvent } from './events/block/BlockMoved';
import { BlockRemovedMutationType, BlockRemovedEvent } from './events/block/BlockRemoved';
import { BlokEditorEventMap, BlockRenderedPayload, BlocksRenderedPayload } from './events/editor-events';

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
  EditorWidth,
  Placeholder,
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
 * document round-tripped through `save()` compares equal to its echo. Nullish
 * documents compare equal to `{ blocks: [] }`. Accepts the loose wire shape
 * ({@link LooseOutputData}) as-is.
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
   * Resolves once every Blok instance constructed so far has finished booting
   * (each instance's `isReady` has settled — rejections count as settled).
   * Collective-readiness signal for pages hosting several instances (e.g. a
   * list of read-only editors plus a composer): await it before autofocusing
   * or measuring layout, instead of hand-aggregating per-instance `onReady`
   * callbacks. Instances constructed while the returned promise is pending
   * extend the wait; instances constructed after it resolves are not covered —
   * call again for a fresh aggregate.
   */
  public static whenAllReady(): Promise<void>;

  public blocks: Blocks;
  public caret: Caret;
  public history: History;
  public sanitizer: Sanitizer;
  public saver: Saver;
  public selection: Selection;
  public styles: Styles;
  public toolbar: Toolbar;
  public inlineToolbar: InlineToolbar;
  public tooltip: Tooltip;
  public readOnly: ReadOnly;
  public theme: Theme;
  public width: Width;
  public placeholder: Placeholder;
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
  public clear(): void;

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
