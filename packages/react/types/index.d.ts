import type { BlokConfig, BlockToolData, OutputBlockData, OutputData, LooseOutputData } from '@bloklabs/core';
import type { BlocksToHtmlOptions } from '@bloklabs/core/view';
import type { BlockAPI, BlockToolConstructable, ToolboxConfigEntry } from '@bloklabs/core';
import type { InlineToolConstructable, SanitizerConfig } from '@bloklabs/core';
import type { API, MarkSnapshot, MarkSpec } from '@bloklabs/core';
import type { Blok, EditorWidth, BlockRenderedPayload, BlocksRenderedPayload } from '@bloklabs/core';
import type { BlockTuneData } from '@bloklabs/core';
import type { MarkdownImportConfig } from '@bloklabs/core/markdown';
import type React from 'react';

/**
 * Configuration for the useBlok hook.
 * Accepts all BlokConfig properties except `holder`, plus a React-only `width` prop.
 *
 * Reactive props (sync after mount without recreation):
 * - `readOnly` — calls `editor.readOnly.set(value)`; the object form also
 *   syncs `hideControls` via `editor.readOnly.set(enabled, { hideControls })`
 * - `hideToolbar` — calls `editor.toolbar.setHidden(value)`
 * - `inlineToolbar` — calls `editor.tools.setInlineToolbar(value)` (arrays
 *   are compared by content, so a re-created literal is a no-op)
 * - `autofocus` — calls `editor.focus()` when changed to true
 * - `theme` — calls `editor.theme.set(value)`
 * - `width` — calls `editor.width.set(value)`
 * - `placeholder` — calls `editor.placeholder.set(value)`
 * - `style.tokens` — calls `editor.tokens.set(value)` (deep-equal–deduped;
 *   replace semantics, so pass the complete token set on each change)
 * - `i18n` — calls `editor.i18n.update({ locale, messages, direction })`
 *   (deep-equal–deduped; relabels the editor chrome in place, so caret, focus
 *   and undo history survive a language switch). `defaultLocale` is not
 *   forwarded — it only affects the initial locale resolution.
 * - `data` — re-renders via `editor.render(value)` when the content changes
 *   (deep-equal–deduped and serialized; seeds the initial content at creation)
 *
 * All other config is consumed once at editor creation.
 */
export interface UseBlokConfig extends Omit<BlokConfig, 'holder'> {
  /** Editor content width mode. Synced reactively after mount. */
  width?: EditorWidth;
}

/**
 * Props for the BlokContent component.
 * Renders a `<div>` that becomes the Blok editor's DOM mount point.
 * Passes through all standard HTML div attributes.
 */
export interface BlokContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The Blok editor instance from useBlok. Null during SSR or before initialization. */
  editor: Blok | null;
}

/**
 * React hook that creates and manages a Blok editor instance.
 *
 * @param config - Editor configuration (all BlokConfig props except `holder`)
 * @param deps - Optional dependency array. When any dep changes, the editor is destroyed and recreated. Keep each value referentially stable (primitives or useMemo-stable objects) so the editor isn't recreated every render. Reserve it for true identity changes (e.g. the document id): tool-config functions are re-bound to the latest render's closure automatically, and non-function config values of `createReactBlock` tools are pushed to mounted blocks in place — neither belongs in deps.
 * @returns The Blok editor instance, or null during SSR / before initialization.
 *
 * @example
 * ```tsx
 * const editor = useBlok({
 *   tools: defaultTools,
 *   data: savedData,
 *   readOnly: false,
 *   onChange: (api, event) => console.log(event),
 * });
 * ```
 */
export function useBlok(
  config: UseBlokConfig,
  deps?: React.DependencyList
): Blok | null;

/**
 * Component that provides the DOM mount point for a Blok editor.
 * Renders a `<div>` and adopts the editor's DOM tree into it.
 *
 * @example
 * ```tsx
 * <BlokContent editor={editor} className="my-editor" />
 * ```
 */
export declare const BlokContent: React.ForwardRefExoticComponent<BlokContentProps & React.RefAttributes<HTMLDivElement>>;

/**
 * Props for the BlokEditor component — all useBlok config (except `onReady`,
 * re-typed to receive the ready instance) plus every standard HTML div attribute
 * (forwarded to the container, like `BlokContent`) and an optional `deps` list
 * that forces recreation when changed. `style`/`onChange` keep editor-config meaning.
 */
export interface BlokEditorProps
  extends Omit<UseBlokConfig, 'onReady'>,
    Omit<React.HTMLAttributes<HTMLDivElement>, 'style' | 'onChange'> {
  /**
   * When any value changes, the editor is destroyed and recreated. Keep each
   * value referentially stable (primitives or useMemo-stable objects) — a dep
   * whose identity changes every render recreates the editor each time.
   * Reserve it for true identity changes (e.g. the document id): tool-config
   * functions and `createReactBlock` config values stay live without it.
   */
  deps?: React.DependencyList;
  /** Test id forwarded to the editor container element (via data-testid). */
  'data-testid'?: string;
  /** Called once the editor is ready, with the live Blok instance (ref is also committed). */
  onReady?: (editor: Blok) => void;
  /**
   * Called after a batch render completes (core `blocks:rendered` event). The
   * declarative analog of `ref.current.on('blocks:rendered', …)` — mirrors the
   * Vue/Angular adapters' rendered-lifecycle outputs.
   */
  onBlocksRendered?: (payload: BlocksRenderedPayload) => void;
  /** Called for each block rendered into the DOM (core `block:rendered` event). */
  onBlockRendered?: (payload: BlockRenderedPayload) => void;
}

/**
 * The recommended all-in-one React component. Wires useBlok + BlokContent and
 * forwards a ref to the live Blok instance (null before the editor is ready).
 *
 * Don't wrap this component in `styled()` or any HOC that reserves the `theme`
 * prop — styled-components claims `theme` for its own `ThemeProvider`, so it
 * never reaches the editor and theme sync silently breaks. Render it directly
 * and style the container via `className`.
 *
 * @example
 * ```tsx
 * const ref = useRef<Blok | null>(null);
 * <BlokEditor ref={ref} tools={tools} data={data} theme="dark" />;
 * ```
 */
export declare const BlokEditor: React.ForwardRefExoticComponent<
  BlokEditorProps & React.RefAttributes<Blok | null>
>;

/**
 * Registers app-wide Blok defaults for every `useBlok` / `<BlokEditor>` rendered
 * beneath it. Per-instance config overrides these, and the `tools` registry is
 * merged (shared registry composes with per-instance additions) rather than
 * replaced. Mirrors Vue's and Angular's `provideBlok`.
 *
 * @example
 * ```tsx
 * <BlokProvider defaults={{ theme: 'dark', tools: sharedTools }}>
 *   <App />
 * </BlokProvider>
 * ```
 */
export declare function BlokProvider(props: {
  defaults: Partial<UseBlokConfig>;
  children?: React.ReactNode;
}): React.ReactElement;

/** Reads the app-wide Blok defaults from the nearest `BlokProvider` (or `{}`). */
export declare function useBlokDefaults(): Partial<UseBlokConfig>;

/**
 * A plain, serializable view of one block in the tree.
 *
 * Snapshot-volatile: every read allocates a fresh `BlockNode`, and `contentIds`
 * is DERIVED per read from the children that currently name this block as parent
 * (it is not a stored field). Read a node in render and re-read after a change —
 * don't stash one in a `useMemo`/`useEffect` dependency array expecting stable
 * identity; depend on the `id` instead.
 */
export interface BlockNode {
  id: string;
  type: string;
  parentId: string | null;
  contentIds: readonly string[];
}

/** Where to place a block among its siblings. */
export type InsertPosition = 'start' | 'end' | { before: string } | { after: string };

/**
 * Where to place the caret within a block. `position` selects the input
 * (`'start'`/`'end'`/`'default'`) and `offset` is the character offset within it.
 */
export interface CaretTarget {
  position?: 'start' | 'end' | 'default';
  offset?: number;
}

export interface InsertSpec {
  type?: string;
  data?: BlockToolData;
  parentId?: string | null;
  position?: InsertPosition;
  /**
   * Move the caret into the new block. Defaults to `false`: a programmatic
   * insert from React must not steal focus from wherever the user is typing.
   * Set `true` for an explicit "add a block and start editing it" flow.
   */
  focus?: boolean;
  /**
   * Replace the block at the resolved slot instead of inserting a new one — a
   * programmatic "turn into". Combine with a `position` that targets the block
   * to replace, e.g. `{ position: { before: id }, replace: true }`.
   */
  replace?: boolean;
  /**
   * Explicit id for the new block (generated when omitted). Passing a stable id
   * makes the insert idempotent: if a block with this id already exists the
   * existing node is returned and nothing is inserted ("insert if absent"),
   * so an effect that re-runs won't create duplicates.
   */
  id?: string;
  /** Block tune data to apply at creation, keyed by tune name. */
  tunes?: { [name: string]: BlockTuneData };
  /**
   * Place the caret inside the newly-created block at a specific position/offset
   * (e.g. `{ offset: 3 }`). Implies focus. Applied ONLY when a block is actually
   * created — an insert-if-absent hit (existing id) does not move the caret.
   */
  caret?: CaretTarget;
}

/**
 * One node of a pre-built nested subtree for {@link UseBlocksApi.insertTree}.
 *
 * Each node maps to one block; `children` are inserted nested under it (their
 * `parentId` set to this node's id) in array order, recursively. Placement
 * options (`parentId`/`position`) are ROOT-ONLY — they position the whole
 * subtree among existing blocks and are ignored on nested children, whose parent
 * is always their enclosing node.
 */
export interface TreeInsertSpec {
  type?: string;
  data?: BlockToolData;
  tunes?: { [name: string]: BlockTuneData };
  /**
   * Explicit id for this node (generated when omitted). Unlike `insert`, this is
   * NOT insert-if-absent: a tree insert always creates fresh blocks. A colliding
   * id — one that already exists in the document, or is reused by another node
   * in the same spec — is REJECTED up front: nothing is inserted and `insertTree`
   * returns `null` (a duplicate id would corrupt every id-keyed lookup).
   */
  id?: string;
  /** Direct children, inserted nested under this node, in array order. */
  children?: TreeInsertSpec[];
  /** Root-only: where to place the whole subtree. Ignored on nested children. */
  parentId?: string | null;
  /** Root-only: slot among siblings of `parentId`. Ignored on nested children. */
  position?: InsertPosition;
}

/**
 * Where to move an existing block.
 *
 * `before`/`after` are POSITION targets, not parent assignments: the block is
 * relocated to that flat slot and — because Blok keeps the flat array as the
 * canonical document order — ADOPTS the parent of wherever it lands. Moving a
 * nested block to `{ after: someRootBlock }` therefore unnests it to root, and
 * moving a root block in among a container's children nests it. Use
 * `nest`/`unnest` when you want to change the parent without choosing a sibling
 * slot. `toIndex` is an absolute flat index (clamped into range).
 */
export type MoveTarget = { before: string } | { after: string } | { toIndex: number };

export interface UseBlocksApi {
  getById(id: string): BlockNode | null;
  getChildren(parentId: string | null): BlockNode[];
  /**
   * Insert one block; returns the created node or null when rejected (unknown
   * tool type, dangling `parentId`, or a `replace` whose target is missing). An
   * explicit `id` that already exists is insert-if-absent (returns the existing
   * node, creates nothing). Atomic — one undo step. The returned node is
   * {@link BlockNode}-volatile; read it now, don't put it in a dep array.
   *
   * `replace: true` is a positional "turn into": it REQUIRES a `before`/`after`
   * `position` whose ref IS the block to overwrite. It returns `null` if
   * `replace` is set without an object `position`, or if that target ref does
   * not exist. The replacement keeps the overwritten block's own parent (the
   * caller's `parentId` is ignored under `replace`).
   */
  insert(spec?: InsertSpec): BlockNode | null;
  /**
   * Insert several blocks atomically, in array order, as ONE undo step. Each
   * spec is a full {@link InsertSpec} (own type/data/parentId/position), routed
   * through the same single-`insert` path, so per-spec parent assertion and
   * positioning still apply. Specs that fail to insert (e.g. a dangling
   * parentId, or a replace whose target is missing) are dropped; the returned
   * array holds only the successfully created nodes. An empty input is a no-op
   * (returns `[]`, opens no transaction). Like `insert`, the returned nodes are
   * fresh-snapshot volatile — read them now, don't stash them in dep arrays.
   */
  insertMany(specs: InsertSpec[]): BlockNode[];
  /**
   * Insert a pre-built NESTED subtree in ONE atomic operation (one undo step).
   * Each {@link TreeInsertSpec} node becomes a block; its `children` are inserted
   * nested under it (recursively, in array order) so the whole hierarchy lands in
   * a single call — no follow-up `nest` round-trips. Delegates to core's
   * tree-aware `blocks.insertMany`, which composes the flat DFS pre-order array
   * honoring each node's `parent`/`content` links.
   *
   * Placement is root-only: the root node's `parentId`/`position` position the
   * whole subtree among existing blocks (default: appended at the document end);
   * nested children ignore those fields (their parent is their enclosing node). A
   * dangling root `parentId` is rejected — nothing is inserted and `null` is
   * returned (mirrors {@link insert}). Returns the root {@link BlockNode}, which
   * is fresh-snapshot volatile — read it now, don't stash it in a dep array.
   */
  insertTree(spec: TreeInsertSpec): BlockNode | null;
  /**
   * Convert a Markdown string to blocks and insert them ADDITIVELY at a
   * position, WITHOUT clearing the document (unlike core's `importMarkdown` /
   * `renderFromHTML`, which replace the whole document). This is the React
   * "paste markdown → blocks appear" path.
   *
   * Async: the markdown converter is lazy-loaded (kept out of the main bundle),
   * so this is the ONE async creator in the API — `await` the returned promise.
   * The whole batch is inserted as a single atomic undo step.
   *
   * `position` (default `'end'`) places the converted run among `parentId`'s
   * children (or root siblings when `parentId` is omitted/null), reusing the
   * same `start`/`end`/`before`/`after` semantics as {@link insert}.
   *
   * `parentId` (default `null` = root) nests the import: every TOP-LEVEL
   * converted block (one the converter left un-parented) is reparented under
   * `parentId`, while blocks the markdown nested internally (e.g. table-cell
   * children) keep their intra-import parent. A dangling `parentId` is a no-op
   * (returns `[]`, opens no transaction), matching {@link insert}; it is
   * re-checked AFTER the async convert, so a parent removed mid-flight also
   * no-ops instead of orphaning the blocks.
   *
   * `config` (optional {@link MarkdownImportConfig}) is forwarded to the
   * converter so custom-tool consumers can map markdown nodes into their tools
   * (`toolMap`/`onUnknownNode`), toggle GFM, or add micromark/mdast extensions.
   *
   * Returns ALL created {@link BlockNode}s in document order — including any the
   * markdown nested internally (e.g. a table's cell children), not just the
   * top-level run (this differs from {@link insertTree}, which returns only the
   * root). Empty or whitespace-only markdown, a dangling `parentId`, and a
   * converter failure (chunk-load or parse error, swallowed) all return `[]` and
   * open no transaction. The nodes are fresh-snapshot volatile — read them now,
   * don't stash them in dep arrays.
   */
  insertMarkdown(
    markdown: string,
    options?: { parentId?: string | null; position?: InsertPosition; config?: MarkdownImportConfig }
  ): Promise<BlockNode[]>;
  /**
   * Serialize the WHOLE document to a Markdown string — the outbound twin of
   * core's `blocks.exportMarkdown` (and the read-side counterpart of the
   * additive {@link insertMarkdown}). Async: the serializer is lazy-loaded, like
   * the importer. Markdown cannot express every block, so some structure is
   * dropped (table `colspan`/`rowspan`, heading columns). Returns `''` for an
   * empty document. Pre-ready: resolves to `''`.
   */
  exportMarkdown(): Promise<string>;
  /**
   * Move `id` to a flat slot, as a single operation. No-op when `id` is unknown.
   * For a relative `{ before|after }` target it is also a no-op when the ref is
   * `id` itself, a descendant of `id` (a block can't be a sibling of its own
   * child), OR does not exist — a missing ref is NOT relocated to the document
   * end. A `{ toIndex }` target is an absolute flat index, clamped into range,
   * and no-ops if the clamped slot would land inside the block's own subtree.
   *
   * Parent-adoption side effect: `before`/`after` are POSITION targets, so the
   * moved block ADOPTS the parent of wherever it lands (moving into a
   * container's children nests it; moving out to a root sibling unnests it).
   * Use {@link nest}/{@link unnest} to change the parent without choosing a
   * sibling slot. Returns void.
   */
  move(id: string, target: MoveTarget): void;
  /**
   * Nest `id` (and its whole subtree) under `parentId`, as one undo step.
   * Graceful no-op when either id is unknown, when `parentId === id`, or when
   * `parentId` is a DESCENDANT of `id` (a block can't be nested under its own
   * child).
   *
   * Column boundary caveat: nesting a block that lives inside a `column` (or
   * into one) is a GRACEFUL no-op — Blok's move() clamps cross-column-boundary
   * moves, so the relocation can't run and the parent isn't changed. Use the
   * drag UI for column membership changes. Returns void.
   */
  nest(id: string, parentId: string): void;
  /**
   * Promote `id` (and its subtree) to root, as one undo step. Graceful no-op
   * when the id is unknown or already at root. Same column-boundary caveat as
   * {@link nest}: unnesting out of a `column` is a graceful no-op. Returns void.
   */
  unnest(id: string): void;
  /**
   * Remove a block by id. DESTRUCTIVE: this deletes the block AND its entire
   * subtree (all transitive descendants), NOT just the single block. Deletion
   * runs deepest-first (descending flat index) so each parent is childless when
   * it's removed — this avoids Blok's single-block delete, which would otherwise
   * PROMOTE a (non-columns) container's children to root and orphan the nested
   * structure the caller meant to discard. The whole cascade is one undo step.
   * An unknown id is a silent no-op. Returns void.
   */
  remove(id: string): void;
  /**
   * Update a block's data and/or tunes by id. Delegates to core's async
   * `blocks.update`, which forms its OWN undo step — the call is NOT wrapped in
   * `transact` (that would close the group before the async write lands). An
   * unknown id is a silent no-op; a rejected update is swallowed so it can't
   * surface as an unhandled rejection. Reads refresh reactively once core emits
   * 'block changed'. Returns `void`.
   */
  update(id: string, data?: BlockToolData, tunes?: { [name: string]: BlockTuneData }): void;
  /**
   * Convert a block to another type ("turn into") by id. Delegates to core's
   * async `blocks.convert`; both tools must provide a `conversionConfig` or core
   * rejects — that rejection (and any other) is swallowed so a non-convertible
   * block is a graceful no-op rather than an unhandled rejection. An unknown id
   * is a silent no-op. Not wrapped in `transact` (core owns its history step).
   * Returns `void`.
   */
  convert(
    id: string,
    newType: string,
    dataOverrides?: BlockToolData,
    options?: { caret?: CaretTarget }
  ): void;
  /**
   * Run `fn` as a single atomic undo step: every mutation it makes is grouped
   * into one history entry, so a single undo reverts the whole batch. Delegates
   * to core's `blocks.transact` when available and otherwise just invokes `fn`
   * directly. (`insert`/`insertMany`/`nest`/`unnest`/`remove` already wrap
   * themselves; use this to group several calls into one step.) Returns void.
   */
  transact(fn: () => void): void;
  /**
   * Run `fn` as one atomic operation that is NOT captured in the undo history —
   * the React-surface counterpart of core's `transactWithoutCapture`. Use for
   * silent auto-repair/normalization that a user's undo should never step
   * through. Mutations inside still emit reactively. Pre-ready it just runs `fn`.
   */
  transactWithoutCapture(fn: () => void): void;
  /** The current block count. Reactive (re-reads on 'block changed'). Pre-ready: 0. */
  getBlocksCount(): number;
  /** The flat index of the block holding the caret, or -1 when none. Pre-ready: -1. */
  getCurrentBlockIndex(): number;
  /** The block at a flat index as a snapshot {@link BlockNode}, or null. */
  getBlockByIndex(index: number): BlockNode | null;
  /**
   * The absolute flat index of a block by id, or null when unknown. The
   * counterpart to {@link getBlockByIndex} — use it to target an off-caret
   * {@link splitBlock} (whose `insertIndex` is absolute) without the ref. Unknown
   * ids return null silently (no console warn). Pre-ready: null.
   */
  getBlockIndex(id: string): number | null;
  /**
   * Read a block's current `data` and `tunes` by id WITHOUT mutating anything —
   * the synchronous last-extracted view (the same snapshot clipboard ops use).
   * Makes a client-side duplicate composable from the hook alone: read a node,
   * then `insert({ type, data, tunes, position })`, no ref escape hatch. Unknown
   * id returns null. Pre-ready: null.
   */
  getBlockData(id: string): { data: BlockToolData; tunes: { [name: string]: BlockTuneData } } | null;
  /**
   * The block whose holder contains/equals `element`, as a snapshot
   * {@link BlockNode}, or null. Maps a DOM event target back to a block.
   */
  getBlockByElement(element: HTMLElement): BlockNode | null;
  /**
   * Read a tool's default empty data WITHOUT inserting anything — delegates to
   * core's `composeBlockData`. Async; rejects for an unknown tool. Pre-ready: `{}`.
   */
  composeBlockData(toolName: string): Promise<BlockToolData>;
  /**
   * Replace the WHOLE document with blocks parsed from an HTML string —
   * delegates to core's `renderFromHTML`. Unlike {@link insertMarkdown} (which is
   * additive), this CLEARS existing content first, so it's a document-load
   * primitive, not an insert. Async. Pre-ready: resolves immediately (no-op).
   */
  renderFromHTML(html: string): Promise<void>;
  /**
   * Insert a flat array of already-serialized {@link OutputBlockData} (the
   * `save()` shape) directly, honoring each block's `parent`/`content` links —
   * the raw counterpart of core's `blocks.insertMany`. Use to re-insert a saved
   * document fragment without reshaping it into {@link TreeInsertSpec}. One atomic
   * undo step. Returns the created nodes; pre-ready: `[]` (no insert).
   */
  insertOutputData(blocks: OutputBlockData[], options?: { index?: number }): BlockNode[];
  /**
   * Atomically split a block: update `currentBlockId` with `currentBlockData`
   * and insert a new `newBlockType` block at `insertIndex`, as ONE undo step.
   * Delegates to core's `splitBlock`. Returns the new node, or null pre-ready.
   */
  splitBlock(
    currentBlockId: string,
    currentBlockData: Partial<BlockToolData>,
    newBlockType: string,
    newBlockData: BlockToolData,
    insertIndex: number
  ): BlockNode | null;
  /**
   * Insert a single child block under `parentId` at flat `insertIndex`, atomically
   * (block creation AND parent assignment in ONE undo step) — delegates to core's
   * `blocks.insertInsideParent`. This is the atomic nested-child creator: prefer it
   * over `insert()` + `nest()`, which is TWO undo steps. A dangling `parentId` is a
   * no-op returning `null` (mirrors {@link insert}); an unknown child tool returns
   * `null`. `childData` defaults to an empty paragraph. Returns the created
   * {@link BlockNode}, fresh-snapshot volatile — read it now, don't stash it in a
   * dep array. Pre-ready: `null`.
   */
  insertInsideParent(parentId: string, insertIndex: number, childData?: BlockToolData): BlockNode | null;
  /**
   * Replace the WHOLE document with blocks parsed from saved {@link OutputData}
   * (the `save()` shape) — delegates to core's `blocks.render`. Unlike
   * {@link insertOutputData}/{@link insertMarkdown} (which are ADDITIVE), this
   * CLEARS existing content first: a document-LOAD primitive, not an insert. The
   * HTML counterpart is {@link renderFromHTML}. Async. Pre-ready: resolves
   * immediately (no-op).
   */
  render(data: OutputData): Promise<void>;
  /**
   * Remove EVERY block from the document — delegates to core's `blocks.clear`. A
   * document-reset primitive (pairs with {@link render}). Async. Pre-ready:
   * resolves immediately (no-op).
   */
  clear(): Promise<void>;
  /**
   * Whether a Yjs sync (undo/redo) is currently in progress — the React mirror of
   * core's `blocks.isSyncingFromYjs`. A METHOD (not a property) so it reads the
   * LIVE flag at call time even though the api handle is memoized. Use it to skip
   * cleanup that would fight Yjs state during an undo/redo. Pre-ready: `false`.
   */
  isSyncingFromYjs(): boolean;
}

/**
 * React hook exposing an id/parentId-relative, reactive view of the block tree.
 * Re-renders whenever the editor emits 'block changed' — including programmatic
 * `nest`/`unnest` reparents, which Blok surfaces as a structural mutation.
 *
 * Reactivity contract: reads refresh ONLY in response to the editor's
 * 'block changed' event. A mutation that advances the editor state WITHOUT
 * emitting it (a tool that mutates its own data without a sync, say) would leave
 * these reads frozen on the previous snapshot until the next emission. The
 * built-in mutators here all route through paths that emit, so this only bites
 * out-of-band tool writes.
 *
 * Pre-ready contract: while `editor` is null (before `useBlok` resolves) the
 * returned API is a stable handle — `insert`/`getById` return `null`,
 * `getChildren` returns `[]`, and the mutators (`move`/`nest`/`unnest`/`remove`/
 * `update`/`convert`/`insertMany`) are no-ops. The one exception is `transact`,
 * which still RUNS its callback even when the editor is null (it is `fn => fn()`)
 * — so it is NOT a pure no-op like the others. Calls made before the editor is
 * ready are otherwise silently dropped, so guard on a non-null editor (or
 * render-gate on it) when an insert must not be lost.
 *
 * Referential stability: the returned API object is stable across renders (it
 * only changes when `editor` does), but each `getById`/`getChildren` call
 * allocates fresh `BlockNode` objects/arrays from a live snapshot. Read them in
 * render and re-read after a change — do NOT put a `getById`/`getChildren`
 * result (or the api handle) in a `useMemo`/`useEffect` dependency array
 * expecting it to change identity per mutation; depend on the node `id`s instead.
 *
 * @param editor - the Blok instance from useBlok, or null before it is ready
 */
export declare function useBlocks(editor: Blok | null): UseBlocksApi;

// ---------------------------------------------------------------------------
// Scoped readiness (useBlokReady)
// ---------------------------------------------------------------------------

/** Options accepted by {@link useBlokReady}. */
export interface UseBlokReadyOptions {
  /**
   * Restrict the wait to editors mounted inside this element. Accepts the ref
   * you already hold on the container; it is re-read on every readiness
   * change, so a ref that attaches after the first render is picked up.
   *
   * Omit it to observe every editor on the page.
   */
  within?: React.RefObject<Element | null> | Element | null;
  /**
   * `'ready'` (default) settles when each editor has finished booting.
   * `'rendered'` also waits for its content to be in the DOM and re-arms on
   * every post-boot re-render.
   */
  settleOn?: 'ready' | 'rendered';
}

/**
 * Live readiness of the Blok editors in a DOM scope.
 *
 * Returns `false` until every editor inside `within` is settled, and keeps
 * following the scope afterwards: editors mounted later re-close the gate, and
 * with `settleOn: 'rendered'` so does each re-render. A scope holding no
 * editors is ready, so callers need no "nothing to wait for" special case.
 *
 * The first render always reports `false` — the scope element is not attached
 * yet, and over-waiting is safe while under-waiting is a bug.
 *
 * @param options - scope and readiness depth
 */
export declare function useBlokReady(options?: UseBlokReadyOptions): boolean;

// ---------------------------------------------------------------------------
// Block authoring (createReactBlock + portal host)
// ---------------------------------------------------------------------------

/** One field of a {@link CreateReactBlockSpec.propSchema}. */
export interface PropSchemaEntry {
  default: unknown;
  values?: readonly unknown[];
}

/**
 * Declarative data shape. Its keys are EXACTLY the keys `save()` returns to Yjs
 * (a cleared field is written as its default, never dropped).
 */
export type PropSchema = Record<string, PropSchemaEntry>;

/** Props handed to a React block's `component` (the only data write path is `commit`). */
export interface ReactBlockRenderProps<Data, Config = Record<string, unknown>> {
  /** Frozen snapshot of the block data. Re-rendered with a new value on change; never mutate. */
  data: Readonly<Data>;
  /**
   * The ONLY data write path: merge a partial patch and sync once. Idempotent —
   * a patch that changes nothing is a full no-op (no re-render, no change
   * event), so effects may safely echo current values without a guard.
   */
  commit: (patch: Partial<Data>) => void;
  /** This block's per-block API. */
  block: BlockAPI;
  /**
   * Read-only flag. Toggled IN PLACE by core's read-only switch (no remount,
   * ephemeral state survives). Honor it — a block that ignores it stays
   * interactive when the editor is read-only.
   */
  readOnly: boolean;
  /**
   * The tool's `config` from the consumer's `tools` map (adapter-internal keys
   * stripped) — the first-class channel for host props (permissions, CDN/upload
   * URLs, locale…). LIVE under `useBlok`/`BlokEditor`: functions always call
   * the latest render's closure, and changed non-function values are pushed to
   * mounted blocks in place — config values never belong in `deps`.
   */
  config: Readonly<Partial<Config>>;
  /** Engine-owned child slot — render `<BlockChildren />` for a container block. */
  BlockChildren: React.ComponentType;
}

/**
 * Props handed to a React block's `viewComponent` (the read-only renderer):
 * the entry props minus `commit` (no write path) and `readOnly` (always true).
 */
export type ReactBlockViewProps<Data, Config = Record<string, unknown>> = Omit<
  ReactBlockRenderProps<Data, Config>,
  'commit' | 'readOnly'
>;

/** A toolbox entry whose `icon` may be a React element instead of an SVG string. */
export type ReactToolboxConfigEntry = Omit<ToolboxConfigEntry, 'icon'> & {
  /**
   * Toolbox icon. Accepts the markup string core consumes directly, or the same
   * React element rendered in the block body — the factory serializes elements
   * to markup once (lazily, cached), so icons are never duplicated as parallel
   * raw SVG strings. Without a DOM (SSR) the element is returned as-is and
   * serialization retries on the next browser-side access.
   */
  icon?: string | React.ReactElement;
};

/** Toolbox config for React blocks: single entry or several variants. */
export type ReactToolboxConfig = ReactToolboxConfigEntry | ReactToolboxConfigEntry[];

/** Spec for {@link createReactBlock}. */
export interface CreateReactBlockSpec<
  Data extends BlockToolData = BlockToolData,
  Config = Record<string, unknown>
> {
  type: string;
  toolbox?: ReactToolboxConfig;
  propSchema: PropSchema;
  component: React.ComponentType<ReactBlockRenderProps<Data, Config>>;
  /**
   * Optional read-only renderer: rendered INSTEAD of `component` while the
   * editor is read-only, so blocks need no display-vs-edit ternary. Toggling
   * read-only swaps renderers (ephemeral state does not survive the swap);
   * omit it to keep the single-component in-place toggle.
   */
  viewComponent?: React.ComponentType<ReactBlockViewProps<Data, Config>>;
  onRendered?: (block: BlockAPI) => void;
  onMoved?: (block: BlockAPI) => void;
  onRemoved?: (block: BlockAPI) => void;
}

/**
 * Author a first-party React block: returns a `BlockToolConstructable`
 * registered exactly like a vanilla tool (`tools: { type: createReactBlock(...) }`).
 * Every block renders through the editor's shared portal host INSIDE the React
 * tree that renders `BlokContent`/`BlokEditor`, so app-level context (themes,
 * design-system providers, stores) reaches block components with no bridge, and
 * fresh render closures reach them with no editor recreation.
 *
 * @example
 * ```tsx
 * const Callout = createReactBlock<{ text: string }>({
 *   type: 'callout',
 *   propSchema: { text: { default: '' } },
 *   component: ({ data, commit }) => (
 *     <aside onClick={() => commit({ text: 'hi' })}>{data.text}</aside>
 *   ),
 * });
 * ```
 */
export declare function createReactBlock<
  Data extends BlockToolData = BlockToolData,
  Config = Record<string, unknown>
>(spec: CreateReactBlockSpec<Data, Config>): BlockToolConstructable;

// ---------------------------------------------------------------------------
// Inline-tool authoring (createReactInlineTool)
// ---------------------------------------------------------------------------

/** Props handed to a React inline tool's `component` (its toolbar icon/UI). */
export interface ReactInlineToolRenderProps<Config = Record<string, unknown>> {
  /**
   * Whether the tool's formatting is active for the current selection —
   * derived from the spec's `checkState` every time the toolbar queries it.
   * Pushed IN PLACE (no remount), so the icon restyles live.
   */
  active: boolean;
  /**
   * The tool's `config` from the consumer's `tools` map (adapter-internal
   * keys stripped) — the channel for host props (palette, locale…).
   */
  config: Readonly<Partial<Config>>;
}

/** The spec's mark operations, bound to the live selection via `api.marks`. */
export interface InlineToolMarkOps<State = void> {
  /** Whether the whole selection currently carries the mark. */
  has(): boolean;
  /** Toggle the mark on the selection; returns true when now applied. */
  toggle(state?: State): boolean;
  /** Apply (or update in place) the mark on the selection. */
  apply(state?: State): HTMLElement[];
  /** Remove the mark from the selection. */
  remove(): HTMLElement[];
  /** Read the mark's current declared values at the selection. */
  read(): MarkSnapshot | null;
}

/**
 * Everything a React inline tool's component (and any component nested in it —
 * swatches, popovers) can reach via {@link useInlineTool} without prop-drilling.
 */
export interface InlineToolHandle<Config = Record<string, unknown>, State = void> {
  /** Live active state, same value as the component's `active` prop. */
  active: boolean;
  /** The tool's config, same value as the component's `config` prop. */
  config: Readonly<Partial<Config>>;
  /** The editor API handed to the tool's constructor (undefined outside core). */
  api: API | undefined;
  /**
   * Operations bound to the spec's `mark` — null when the spec declares no
   * mark or the editor api provides no `marks` surface.
   */
  mark: InlineToolMarkOps<State> | null;
}

/**
 * Reach the enclosing React inline tool from any component inside its
 * portaled UI: live `active` state, the tool `config`, the editor `api`, and
 * the spec's mark operations bound to the live selection.
 */
export declare function useInlineTool<Config = Record<string, unknown>, State = void>(): InlineToolHandle<Config, State>;

/** Spec for {@link createReactInlineTool}. */
export interface CreateReactInlineToolSpec<Config = Record<string, unknown>, State = void> {
  /** Tool type name — the MenuConfig item name (fallback when the tools-map key is unavailable). */
  type: string;
  /** Optional toolbar item title (shown in overflow/search contexts). */
  title?: string;
  /**
   * Translation key for the toolbar label, resolved by core i18n as
   * `toolNames.{titleKey}` (or used verbatim when it contains a dot). Without
   * it a custom tool's label is only localizable through the legacy
   * capitalized-tool-name fallback.
   */
  titleKey?: string;
  /** The component rendered as the tool's toolbar icon/UI. */
  component: React.ComponentType<ReactInlineToolRenderProps<Config>>;
  /**
   * Declarative description of the wrapper this tool produces. When present,
   * `surround` (toggle), `checkState` (whole-range coverage) and `sanitize`
   * are derived from it — range-aware splitting, adjacent-run semantics and
   * the trailing-whitespace fix come from the editor's mark engine
   * (`api.marks`) with no DOM plumbing in the tool.
   */
  mark?: MarkSpec<State>;
  /**
   * Applies/removes the formatting on the LIVE selection's range (captured at
   * activation time). Receives the editor API as its second argument.
   * Takes precedence over the `mark` derivation.
   */
  surround?: (range: Range, api: API | undefined) => void;
  /**
   * Reports whether the formatting is active for the given selection.
   * Receives the editor API as its second argument.
   * Takes precedence over the `mark` derivation.
   */
  checkState?: (selection: Selection | null, api: API | undefined) => boolean;
  /** Keyboard shortcut (e.g. `CMD+SHIFT+C`). */
  shortcut?: string;
  /**
   * Inline sanitizer config declaring the markup this tool produces.
   * Defaults to the config derived from `mark` when one is declared.
   */
  sanitize?: SanitizerConfig;
  /** Whether the tool stays available in read-only mode. */
  isReadOnlySupported?: boolean;
}

/**
 * Author a first-party React inline tool: returns an inline-tool
 * constructable registered exactly like a vanilla tool
 * (`tools: { color: createReactInlineTool(...) }`). The tool's toolbar icon is
 * a React component portaled through the editor's shared portal host INSIDE
 * the React tree that renders `BlokContent`/`BlokEditor` — app-level context
 * (themes, styled-components providers) reaches the icon with no
 * consumer-managed `createRoot`, and the inline toolbar's teardown unmounts it
 * deterministically (no leaked React roots).
 *
 * @example
 * ```tsx
 * const DescriptionColor = createReactInlineTool({
 *   type: 'descriptionColor',
 *   title: 'Text color',
 *   component: ({ active }) => <FontColorIcon active={active} />,
 *   mark: { tag: 'span', className: 'hl-description' },
 * });
 * ```
 */
export declare function createReactInlineTool<Config = Record<string, unknown>, State = void>(
  spec: CreateReactInlineToolSpec<Config, State>
): InlineToolConstructable;

/**
 * Tool-config key carrying the editor's portal registry into a
 * `createReactBlock` tool. Injected automatically by `useBlok`; exposed for
 * advanced setups that construct tools outside `useBlok`.
 */
export declare const BLOK_PORTAL_REGISTRY_CONFIG_KEY: '__blokPortalRegistry';

/**
 * Tool-config key carrying the name a react-block tool is registered under in
 * the consumer's `tools` map. Injected automatically by `useBlok`; routes live
 * tool-config updates to the tool's mounted blocks.
 */
export declare const BLOK_TOOL_NAME_CONFIG_KEY: '__blokToolName';

/** One mounted React block in the portal registry. */
export interface BlockPortalEntry {
  hostEl: HTMLElement;
  component: React.ComponentType<Record<string, unknown>>;
  props: Record<string, unknown>;
  /** Name the tool is registered under — routes per-tool live config updates. */
  toolName?: string;
}

/**
 * Per-editor registry of React blocks, shaped as an external store
 * (`subscribe`/`getSnapshot`) consumed by `BlockPortalHost` via
 * `useSyncExternalStore`. Snapshots are immutable and referentially stable
 * between mutations.
 */
export interface BlockPortalRegistry {
  register(id: string, entry: BlockPortalEntry): void;
  unregister(id: string): void;
  setProps(id: string, props: Record<string, unknown>): void;
  /**
   * Replace the `config` prop of every entry registered under `toolName`, and
   * remember it so entries registered later start from the latest config.
   */
  setToolConfig(toolName: string, config: Record<string, unknown>): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ReadonlyMap<string, BlockPortalEntry>;
}

/** Create a fresh portal registry (one per editor instance). */
export declare function createBlockPortalRegistry(): BlockPortalRegistry;

/** Props for {@link BlockPortalHost}. */
export interface BlockPortalHostProps {
  registry: BlockPortalRegistry;
}

/**
 * The single shared render tree that portals each registered React block into
 * its Blok-owned host element. Mounted automatically by `BlokContent`; exposed
 * for advanced setups that manage the registry themselves.
 */
export declare function BlockPortalHost(props: BlockPortalHostProps): React.ReactElement;

/**
 * Props for {@link BlokView}.
 *
 * @experimental Built on the `@experimental` view tree of
 * `@bloklabs/core/view` — not frozen until a second framework adapter
 * consumes it.
 */
export interface BlokViewProps {
  /** Saved document to display (strict or loose wire shape; nullish tolerated). */
  data: OutputData | LooseOutputData | null | undefined;
  /** View schema from `defineBlokSchema` — display under the composition that produced the document. */
  schema?: BlocksToHtmlOptions['schema'];
  /** Custom per-tool renderers; win over built-ins. */
  renderers?: BlocksToHtmlOptions['renderers'];
  /** Unknown-tool policy (default 'skip'). */
  onUnknownBlock?: BlocksToHtmlOptions['onUnknownBlock'];
  /** Class for the single wrapper div. */
  className?: string;
}

/**
 * Display a saved Blok document synchronously — one `<div>` wrapper, no
 * editor chrome, no ids, no async, no effects. Content is mapped from the
 * sanitized view tree to real React elements, so it renders identically
 * under SSR.
 *
 * @experimental Not frozen until a second framework adapter consumes the
 * underlying view tree.
 */
export declare function BlokView(props: BlokViewProps): React.ReactNode;

/**
 * Render a saved Blok document to React elements with NO wrapper element —
 * a Fragment of the block elements, for placement inside labels, table
 * cells, and other slots where an extra `<div>` is invalid or unwanted.
 * Synchronous, effect-free (SSR-safe), memoized on the data reference and
 * the individual option values.
 *
 * @experimental Not frozen until a second framework adapter consumes the
 * underlying view tree.
 */
export declare function useBlokView(
  data: OutputData | LooseOutputData | null | undefined,
  options?: BlocksToHtmlOptions
): React.ReactNode;
