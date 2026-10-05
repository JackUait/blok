import { ConversionConfig, PasteConfig, ToolSanitizerConfig } from '../configs';
import { BlockToolData } from './block-tool-data';
import { BaseTool, BaseToolConstructable, BaseToolConstructorOptions } from './tool';
import { ToolConfig } from './tool-config';
import { API, BlockAPI, ToolboxConfig } from '../index';
import { PasteEvent } from './paste-events';
import { MoveEvent } from './hook-events';
import { MenuConfig } from './menu-config';

/**
 * Which block tools may be direct children of a container block.
 *
 * `deny` wins over `allow` for a tool named in both. Empty (or omitted) lists
 * read as "no restriction", so a Tool computing these at runtime cannot
 * accidentally lock its container down.
 *
 * @see BlockToolConstructable.childTools
 */
export interface ChildToolRestrictions {
  /**
   * Only these tool names may be direct children. Anything else is demoted on
   * insert (to `allow[0]`) and refused on move. Omit for "anything but `deny`".
   */
  allow?: string[];
  /** These tool names may never be direct children. */
  deny?: string[];
}

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
   * Returns how far the content at the hovered element is inset from the block's
   * edges. Used by the toolbar to sit closer to nested content (e.g., nested list items).
   *
   * Both insets are PHYSICAL, whatever the text direction. The toolbar reads the
   * one on the side its controls sit: `right` when they are on the right of the
   * content (the default in an RTL editor), `left` otherwise.
   *
   * @param hoveredElement - The element that is currently being hovered
   * @returns `left`: inset from the physical left edge in px; `right` (optional):
   *   inset from the physical right edge in px. Undefined if no offset applies.
   */
  getContentOffset?(hoveredElement: Element): { left: number; right?: number } | undefined;

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
   * Called when the user presses Enter (or Cmd/Ctrl+Enter) on this block while
   * it is the keyboard navigation target (Escape, then arrows).
   *
   * Return true if the tool handled it (e.g. opened a link). Blok then leaves
   * navigation mode without putting the caret in the block. Return false, or
   * omit the method, to keep the default: the caret moves into the block.
   *
   * @param event - the Enter keydown
   */
  onNavigationEnter?(event: KeyboardEvent): boolean;

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

  /**
   * Set only with `origin: 'replay'`: who rebuilt the block. `'history'` is
   * this client's own undo or redo; `'remote'` is a peer's change arriving.
   * A side effect that only the acting client should run (a network fetch,
   * a derived write) belongs to `'history'`.
   */
  readonly replaySource?: 'history' | 'remote';
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
   * Which block tools may be DIRECT children of this Tool's block. Declare it
   * and core enforces the rule for you, at every entry point:
   *
   * - **Insert** — a disallowed tool is DEMOTED, never refused (an Enter
   *   keypress must always produce a block). The demotion target is the first
   *   entry of `allow`, so `allow: ['segment-item']` makes "Enter at the end of
   *   a segment" produce another segment instead of a stray paragraph. With only
   *   a `deny` list the target is the editor's `defaultBlock`.
   * - **Move** — a drag or keyboard reorder that would carry a disallowed block
   *   across the container boundary is refused.
   * - **Toolbox** — disallowed tools are hidden while the caret is in a child.
   *
   * `deny` wins over `allow` for a tool named in both; empty lists read as "no
   * restriction". Leaving this unset accepts any child.
   *
   * This is the selective, insert-aware counterpart to {@link ownsChildren},
   * which is all-or-nothing and clamps moves only. Without it a container Tool
   * has to defend itself downstream — filtering `child.name` in render, keeping
   * its CSS robust against a foreign child, migrating strays out of stored
   * documents.
   *
   * @example
   * class Segments {
   *   static get childTools() {
   *     return { allow: ['segment-item'] };
   *   }
   * }
   */
  childTools?: ChildToolRestrictions;

  /**
   * Set to false when this Tool's block never has children — for example a
   * page block, whose body lives in another document, so a child stored under
   * it would be dropped by every export.
   *
   * Core then refuses every way to nest a block in it: Tab is a no-op, an
   * insert or `moveTo` with it as the parent throws `BlockPlacementError`,
   * `setBlockParent` onto it does nothing, a reorder that would carry a block
   * in is refused, and a drop never nests under it.
   *
   * `childTools` cannot express this: an empty `allow` list means "no
   * restriction". Leave unset (or true) for any block that may hold children.
   */
  acceptsChildren?: boolean;

  /**
   * Set to true when a copy of this Tool's block rebuilds its children from
   * its own data — a table's `content` names its cell blocks, and the copy
   * duplicates them when it renders.
   *
   * Duplicate and Alt-drag then copy only the block and leave its descendants
   * to the Tool, so they are not copied twice. Leave unset when the children
   * are not named in the data (toggle, column_list, database rows): declaring
   * it there loses them from every copy.
   */
  copiesOwnChildren?: boolean;

  /**
   * For a block that stands for something that must exist once, like a page.
   * Copy, Duplicate and Alt-drag carry this link instead of the block, and a
   * pasted copy becomes the link. A cut still moves the block, once.
   * Return null when there is nothing to link to.
   *
   * Core inserts the link as a default block (a paragraph holding
   * `<a href="url">text</a>`), and the block menu's "Copy link" copies `url`.
   * Return an absolute `url`: a copy may be pasted into another app.
   *
   * @param data - the block's saved data
   * @param config - the Tool's config
   */
  copyAsLink?(data: BlockToolData, config: ToolConfig): { url: string; text: string } | null;

  /**
   * The data Duplicate and Alt-drag insert for this Tool's block, instead of
   * a copy or the `copyAsLink` link — for example a page the host copies to
   * a new id. Return null to fall back. Copy and paste never call it.
   *
   * @param data - the block's saved data
   * @param config - the Tool's config
   */
  duplicateData?(data: BlockToolData, config: ToolConfig): BlockToolData | null;

  /**
   * The data a block picked from the toolbox starts with, for data only the
   * host can give, like a page id from a backend. The toolbox waits for it
   * and shows the item as busy, then inserts the block. A rejection inserts
   * nothing. Other inserts never call it.
   *
   * @param config - the Tool's config
   */
  prepareInsert?(config: ToolConfig): Promise<BlockToolData>;

  /**
   * How this Tool's block menu is laid out.
   * `titled` heads the menu with the Tool's toolbox title and puts Turn into
   * before the Tool's own items, like Notion's page menu.
   * `trash` reads Delete as "Move to Trash", for a block that stands for
   * something the host keeps, like a page.
   */
  blockMenu?: { titled?: boolean; trash?: boolean };

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
   * Set to true when deleting this Tool's block must delete its whole subtree.
   *
   * By default Blok keeps a deleted container's body: its children move up one
   * level into the container's slot (a toggle, a callout). A layout container
   * whose children only make sense inside it — a column, a tab — declares this
   * so its children are removed with it instead of leaking out.
   */
  deletesChildren?: boolean;

  /**
   * Set to true when the block is a pure layout piece, like a column or a tab.
   *
   * A layout block never gets the hover toolbar (no drag handle, no block
   * menu) and is never a selection unit: only the blocks inside it are. Blocks
   * inside it take no depth indent, since the layout positions them.
   */
  isLayout?: boolean;

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
   * CSS radius of the rounded frame this Tool draws at its outer edge, for
   * example `'var(--blok-radius-block)'`.
   *
   * Core writes it on the block's content wrapper as `--blok-radius-frame`, and
   * the block selection fill takes its radius from it, so the fill follows the
   * frame's corners instead of a square behind them. A content wrapper does not
   * inherit its parent's value, so nested blocks keep their own fill.
   *
   * Give the radius of the frame where it meets the content wrapper edge. If
   * the frame is inset from the Tool's root, add that inset. Leave unset for a
   * square block: the fill then uses `--blok-radius-control`.
   *
   * @example
   * class Card {
   *   static get frameRadius() {
   *     return 'var(--blok-radius-block)';
   *   }
   * }
   */
  frameRadius?: string;

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
