import { ConversionConfig, PasteConfig, ToolSanitizerConfig } from '../configs';
import { BlockToolData } from './block-tool-data';
import { BaseTool, BaseToolConstructable, BaseToolConstructorOptions } from './tool';
import { ToolConfig } from './tool-config';
import { API, BlockAPI, ToolboxConfig } from '../index';
import { PasteEvent } from './paste-events';
import { MoveEvent } from './hook-events';
import { MenuConfig } from './menu-config';

/**
 * Describe Block Tool object
 * @see {@link docs/tools.md}
 */
export interface BlockTool extends BaseTool {
  /**
   * Sanitizer rules description
   */
  sanitize?: ToolSanitizerConfig;

  /**
   * Process Tool's element in DOM and return raw data
   * @param {HTMLElement} block - element created by {@link BlockTool#render} function
   * @return {BlockToolData}
   */
  save(block: HTMLElement): BlockToolData;

  /**
   * Create Block's settings block
   */
  renderSettings?(): HTMLElement | MenuConfig;

  /**
   * Validate Block's data
   * @param {BlockToolData} blockData
   * @return {boolean}
   */
  validate?(blockData: BlockToolData): boolean;

  /**
   * Method that specified how to merge two Blocks with same type.
   * Called by backspace at the beginning of the Block
   * @param {BlockToolData} blockData
   */
  merge?(blockData: BlockToolData): void;

  /**
   * On paste callback. Fired when pasted content can be substituted by a Tool
   * @param {PasteEvent} event
   */
  onPaste?(event: PasteEvent): void;

  /**
   * Cleanup resources used by your tool here
   * Called when the blok is destroyed
   */
  destroy?(): void;

  /**
   * Lifecycle hooks
   */

  /**
   * Called after block content added to the page
   */
  rendered?(): void;

  /**
   * Called each time block content is updated
   */
  updated?(): void;

  /**
   * Called after block removed from the page but before instance is deleted
   */
  removed?(): void;

  /**
   * Called after block was moved
   */
  moved?(event: MoveEvent): void;

  /**
   * Returns the horizontal offset of the content at the hovered element.
   * Used by the toolbar to position itself closer to nested content (e.g., nested list items).
   *
   * @param hoveredElement - The element that is currently being hovered
   * @returns Object with left offset in pixels, or undefined if no offset should be applied
   */
  getContentOffset?(hoveredElement: Element): { left: number } | undefined;

  /**
   * Returns the element that the toolbar should vertically center on.
   * Used by tools whose editable area is deeply nested below non-editable UI
   * (e.g., a header bar), where the default contenteditable-descendant search
   * would position the toolbar too far down inside the block.
   *
   * Return undefined to use the default positioning logic.
   */
  getToolbarAnchorElement?(): HTMLElement | undefined;

  /**
   * Called when read-only mode is toggled without re-rendering the block.
   * Implementations should update the DOM in place: toggle contentEditable,
   * bind/unbind event listeners, show/hide interactive elements, etc.
   *
   * Optional — tools without this method trigger a full save/clear/render
   * fallback when read-only mode is toggled.
   */
  setReadOnly?(state: boolean): void;
}

/**
 * The kind of host-uploaded asset a media tool stores at `data.url`.
 *
 * A tool that declares a static `assetKind` advertises that every instance
 * keeps its canonical asset URL at `data.url`, letting consumers enumerate the
 * media-bearing tool set (via `api.tools.getBlockTools()`) and reconcile a saved
 * document against a CDN — e.g. to garbage-collect orphaned uploads — without
 * hardcoding each tool's data shape.
 */
export type AssetKind = 'image' | 'video' | 'audio' | 'file';

/**
 * Where a Block instance came from — the create-vs-restore signal on the Tool
 * contract.
 *
 * A container Tool that seeds default children (a `column_list` that starts with
 * two columns, a layout block that starts with a heading) can only do that once,
 * at creation. Every other time the Tool is constructed the document already
 * says what its children are — and during a restore those children commonly land
 * a tick AFTER `rendered()` runs, so an empty `api.blocks.getChildren()` there is
 * transient. Seeding on that empty read fabricates phantom children beside the
 * real ones.
 *
 * CREATION origins — the author just made this block, so seeding is correct:
 * - `user`    — a direct editing gesture: Enter, the plus button, the slash /
 *               plus toolbox, block settings, a markdown shortcut
 * - `api`     — a programmatic `blocks.insert` / `insertMany` / `insertInsideParent`
 * - `convert` — a turn-into that replaces an existing block with another Tool
 *
 * RESTORE origins — the block is being re-materialised, so whatever children the
 * document holds are authoritative and the Tool must never seed:
 * - `load`   — a document render (`blocks.render`, the editor's initial content)
 * - `replay` — an undo/redo replay or a remote collaborative update
 * - `paste`  — pasted content that brings its own children
 * - `probe`  — an OFF-TREE instance built only to read a Tool's default data
 *              (`blocks.composeBlockData`). It is never inserted into the
 *              document, yet it still runs `render()` and `rendered()`, so it
 *              must not touch the block tree at all.
 */
export type BlockOrigin = 'user' | 'api' | 'convert' | 'load' | 'replay' | 'paste' | 'probe';

/**
 * Describe constructor parameters
 */
export interface BlockToolConstructorOptions<D extends object = any, C extends object = any> extends BaseToolConstructorOptions<C> {
  data: BlockToolData<D>;
  block: BlockAPI;
  readOnly: boolean;

  /**
   * Why this Block instance is being constructed — see {@link BlockOrigin}.
   *
   * Blok always supplies it. It is optional only so a host can hand-build the
   * options object in a unit test; treat an absent value as `'api'`, the same
   * default Blok applies, so an un-updated caller is never mistaken for a user
   * gesture.
   */
  readonly origin?: BlockOrigin;
}

export interface BlockToolConstructable extends BaseToolConstructable {
  /**
   * Tool's Toolbox settings
   */
  toolbox?: ToolboxConfig;

  /**
   * Paste substitutions configuration
   */
  pasteConfig?: PasteConfig | false;

  /**
   * Rules that specified how this Tool can be converted into/from another Tool
   */
  conversionConfig?: ConversionConfig;

  /**
   * Is Tool supports read-only mode, this property should return true
   */
  isReadOnlySupported?: boolean;

  /**
   * Set to true when the Tool exclusively manages its own child blocks — its
   * `contentIds` are the Tool's own machinery (a table's cell blocks, a
   * column_list's columns), not blocks the user put there.
   *
   * Core then refuses to nest an outside block into it via a user gesture such
   * as Tab-indent, which would otherwise create a rogue child that the Tool
   * renders wherever its children go. Leave unset for Tools whose children are
   * plain user content (toggle, callout, a nestable paragraph).
   */
  ownsChildren?: boolean;

  /**
   * Set to true when Enter on this container's empty LAST child must create the
   * new line INSIDE the container instead of leaving it.
   *
   * By default Blok treats an empty trailing line as the author's way out of a
   * container: with siblings present that line is outdented to the container's
   * own parent, and as a sole child a fresh block is inserted after the whole
   * container (Notion's callout behaviour). A layout container — a column, a
   * card, a `steps` block whose children ARE its steps — wants the opposite: the
   * new line belongs to it, and escaping strands content beside the container.
   *
   * This is per-tool POLICY and cannot be derived from the DOM: a callout
   * renders the very same `data-blok-nested-blocks` slot as a column, yet
   * deliberately lets Enter leave. Declare it and the same rule Blok's own
   * `column` / `column_list` / `toggle` follow applies to your Tool — no
   * editor-global `config.onEnter` workaround re-deriving containment.
   *
   * Core also reads it for the symmetric "remove one indent level" gesture
   * (Enter/Backspace on a block nested under a PLAIN parent): a Tool that keeps
   * its children is a container, never a plain structural parent, so its
   * children never stepwise-outdent out of it.
   */
  keepsChildrenOnEnter?: boolean;

  /**
   * Declares that this Tool stores a host-uploaded asset URL at `data.url`.
   *
   * Set it on media tools (image, video, audio, file) so consumers can discover
   * the media-bearing tool set at runtime — `api.tools.getBlockTools().filter(t => t.assetKind)`
   * — and diff a saved document's `data.url`s against a CDN to clean up orphaned
   * uploads, instead of hardcoding each tool's data shape. Leave unset for tools
   * that hold no uploaded asset.
   */
  assetKind?: AssetKind;

  /**
   * Per-tool data-migration hook (a STATIC method on the Tool class). Upgrades a
   * stored block's `data` from a legacy shape the Tool once wrote into the shape
   * it reads today.
   *
   * Blok runs it at load — while composing each stored block, before the Tool is
   * constructed — for the legacy shapes core's global migration cannot know
   * about (a columns layout, a custom media envelope). It must be a pure
   * function of `data`: return the upgraded data, or the input unchanged when it
   * is already current (so it stays safe to run on every load and idempotent
   * across repeated runs). A hook that throws is caught and the block loads with
   * its stored data instead of failing the whole document.
   * @param data - the stored block data (any shape the Tool has ever written)
   * @returns the data in the Tool's current shape
   */
  upgradeData?(data: BlockToolData): BlockToolData;

  /**
   * @constructor
   *
   * @param {BlockToolConstructorOptions} config - constructor parameters
   *
   * @return {BlockTool}
   */
  new(config: BlockToolConstructorOptions): BlockTool;
}
