import type { Component, DefineComponent, InjectionKey, MaybeRefOrGetter, Ref, ShallowRef } from 'vue';
import type {
  API,
  Blok,
  BlockAPI,
  BlockMutationEvent,
  BlockToolConstructable,
  BlockToolData,
  BlokConfig,
  EditorWidth,
  OutputBlockData,
  OutputData,
  ResolvedTheme,
  ToolboxConfig,
} from './index';
import type { BlockTuneData } from './block-tunes/block-tune-data';
import type { MarkdownImportConfig } from './markdown';

/**
 * Configuration for the `useBlok` composable and `<BlokEditor>`.
 * Accepts all `BlokConfig` properties except `holder` (managed by the adapter),
 * plus a reactive `width` prop.
 *
 * Reactive props (sync after mount without recreation):
 * - `readOnly` — calls `editor.readOnly.set(value)`
 * - `autofocus` — calls `editor.focus()` when changed to true
 * - `theme` — calls `editor.theme.set(value)`
 * - `width` — calls `editor.width.set(value)`
 * - `placeholder` — calls `editor.placeholder.set(value)`
 * - `data` — re-renders via `editor.render(value)` when content changes
 *   (deep-equal–deduped and serialized; seeds the initial content at creation)
 *
 * All other config is consumed once at editor creation.
 */
export interface UseBlokConfig extends Omit<BlokConfig, 'holder'> {
  /** Editor content width mode. Synced reactively after mount via `editor.width.set()`. */
  width?: EditorWidth;
}

/** Props for the `BlokContent` component. */
export interface BlokContentProps {
  /** The Blok editor instance from `useBlok`. Pass null before it is ready. */
  editor: Blok | null;
}

/**
 * Composable that creates and manages a Blok editor instance.
 *
 * @param config - reactive config source (ref/getter), all `BlokConfig` props except `holder`
 * @param recreateKey - reactive value whose identity change destroys and recreates the editor
 * @returns a ref to the live Blok instance, or null before ready / after destroy
 *
 * @example
 * ```ts
 * const editor = useBlok(() => ({ tools, data, readOnly: false }));
 * ```
 */
export declare function useBlok(
  config: MaybeRefOrGetter<UseBlokConfig>,
  recreateKey?: MaybeRefOrGetter<unknown>
): Ref<Blok | null>;

/**
 * Component that provides the DOM mount point for a Blok editor. Renders a
 * `<div>` and adopts the editor's detached holder into it.
 */
export declare const BlokContent: DefineComponent<BlokContentProps>;

/**
 * Props for `<BlokEditor>` — every `UseBlokConfig` option except the callbacks
 * surfaced as emits (`onReady`/`onChange`/`onSave`/`onAfterRender`/`onThemeChange`),
 * plus `recreateKey`. The return-valued transform hooks (`onBeforeRender`,
 * `onBeforePaste`) stay props. Any extra attribute falls through to the container.
 */
export interface BlokEditorProps
  extends Partial<Omit<UseBlokConfig, 'onReady' | 'onChange' | 'onSave' | 'onAfterRender' | 'onThemeChange'>> {
  /** Changing this prop's identity destroys and recreates the editor. */
  recreateKey?: unknown;
}

/** Events emitted by `<BlokEditor>`. */
export interface BlokEditorEmits {
  /** The editor became ready — fires once with the live instance. */
  (event: 'ready', instance: Blok): void;
  /** Raw block mutation channel (core `onChange`). */
  (event: 'change', payload: { api: API; event: BlockMutationEvent | BlockMutationEvent[] }): void;
  /** Full serialized content on every change (notification half). */
  (event: 'save', data: OutputData): void;
  /** Two-way `v-model:data` update half. */
  (event: 'update:data', data: OutputData): void;
  /** Fires after the editor finishes (re-)rendering (core `onAfterRender`). */
  (event: 'after-render', api: API): void;
  /** Fires when the resolved theme changes (core `onThemeChange`). */
  (event: 'theme-change', resolvedTheme: ResolvedTheme): void;
  /** Fires after a batch render completes (core `blocks:rendered`). */
  (event: 'blocks-rendered', payload: unknown): void;
  /** Fires for each block rendered into the DOM (core `block:rendered`). */
  (event: 'block-rendered', payload: unknown): void;
}

/** The instance surface exposed via a template ref on `<BlokEditor>`. */
export interface BlokEditorExposed {
  /** The live Blok instance, or null before ready. */
  instance: Blok | null;
  /** Serialize the current content (undefined until ready). */
  save(): Promise<OutputData> | undefined;
  /** Move the caret into the editor. */
  focus(atEnd?: boolean): void;
  /** Replace the editor content (undefined until ready). */
  render(data: OutputData): Promise<void> | undefined;
}

/**
 * The blessed all-in-one component for embedding Blok in Vue. Wires `useBlok`
 * and `BlokContent`, exposes the live instance (see {@link BlokEditorExposed}),
 * and forwards fallthrough attributes to the editor container.
 *
 * @example
 * ```vue
 * <BlokEditor :tools="tools" v-model:data="data" theme="dark" @ready="onReady" />
 * ```
 */
export declare const BlokEditor: DefineComponent<
  BlokEditorProps,
  BlokEditorExposed,
  unknown,
  Record<string, never>,
  Record<string, never>,
  unknown,
  unknown,
  BlokEditorEmits
>;

/** Injection key holding app-wide Blok defaults (merged under per-instance props). */
export declare const BLOK_DEFAULT_CONFIG: InjectionKey<Partial<UseBlokConfig>>;

/**
 * Registers app-wide Blok defaults in the current component's provide scope
 * (call inside a parent component's `setup`). Mirrors Angular's `provideBlok`.
 */
export declare function provideBlok(defaults: Partial<UseBlokConfig>): void;

/**
 * Reads the app-wide Blok defaults from the nearest `provideBlok` (or `{}`).
 * Mirrors React's `useBlokDefaults`. Call inside `setup`.
 */
export declare function useBlokDefaults(): Partial<UseBlokConfig>;

/**
 * A plain, serializable view of one block in the tree. Snapshot-volatile: every
 * read allocates a fresh node and `contentIds` is derived per read — depend on
 * the `id`, don't stash the node.
 */
export interface BlockNode {
  id: string;
  type: string;
  parentId: string | null;
  contentIds: readonly string[];
}

/** Where to place the caret within a block. */
export interface CaretTarget {
  position?: 'start' | 'end' | 'default';
  offset?: number;
}

/** Where to place a block among its siblings. */
export type InsertPosition = 'start' | 'end' | { before: string } | { after: string };

/** Spec for {@link UseBlocksApi.insert}. */
export interface InsertSpec {
  type?: string;
  data?: BlockToolData;
  parentId?: string | null;
  position?: InsertPosition;
  focus?: boolean;
  replace?: boolean;
  id?: string;
  tunes?: { [name: string]: BlockTuneData };
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

/** Where to move an existing block. */
export type MoveTarget = { before: string } | { after: string } | { toIndex: number };

/**
 * Reactive, id/parentId-relative view of the block tree returned by
 * {@link useBlocks}. Reads are reactive (re-run inside a `computed`/template on
 * `block changed`); mutators delegate to the editor's `blocks` API.
 *
 * This is the SAME 28-method surface React's `useBlocks` exposes — both adapters
 * are thin reactivity wrappers over one shared `createBlocksApiForEditor` core,
 * so the surfaces are identical and cannot drift.
 */
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
   * (returns `[]`, opens no transaction).
   */
  insertMany(specs: InsertSpec[]): BlockNode[];
  /**
   * Insert a pre-built NESTED subtree in ONE atomic operation (one undo step).
   * Each {@link TreeInsertSpec} node becomes a block; its `children` are inserted
   * nested under it (recursively, in array order). Placement is root-only: the
   * root node's `parentId`/`position` position the whole subtree; nested children
   * ignore those fields. A dangling root `parentId` (or a colliding explicit id)
   * is rejected — nothing is inserted and `null` is returned. Returns the root
   * {@link BlockNode}.
   */
  insertTree(spec: TreeInsertSpec): BlockNode | null;
  /**
   * Convert a Markdown string to blocks and insert them ADDITIVELY at a position,
   * WITHOUT clearing the document. Async: the converter is lazy-loaded, so
   * `await` the returned promise. The whole batch is one atomic undo step.
   * `parentId` nests the import (top-level converted blocks are reparented under
   * it); a dangling `parentId` (re-checked after the async convert) and a
   * converter failure both return `[]`. Returns all created {@link BlockNode}s in
   * document order. `config` is forwarded to the converter (gfm/toolMap/extensions).
   */
  insertMarkdown(
    markdown: string,
    options?: { parentId?: string | null; position?: InsertPosition; config?: MarkdownImportConfig }
  ): Promise<BlockNode[]>;
  /**
   * Move `id` to a flat slot, as a single operation. No-op when `id` is unknown.
   * For a relative `{ before|after }` target it is also a no-op when the ref is
   * `id` itself, a descendant of `id`, OR does not exist. A `{ toIndex }` target
   * is an absolute flat index, clamped into range. Subtree-aware: a block with
   * descendants relocates its WHOLE subtree (relative targets only — an absolute
   * `{ toIndex }` of a block with descendants is a graceful no-op).
   *
   * Parent-adoption side effect: `before`/`after` make the moved block a SIBLING
   * of the ref — it adopts the ref's parent. Use {@link nest}/{@link unnest} to
   * change the parent without choosing a sibling slot. Returns void.
   */
  move(id: string, target: MoveTarget): void;
  /**
   * Nest `id` (and its whole subtree) under `parentId`, as one undo step.
   * Graceful no-op when either id is unknown, when `parentId === id`, or when
   * `parentId` is a DESCENDANT of `id`. Column boundary caveat: nesting a block
   * that lives inside a `column` (or into one) is a GRACEFUL no-op. Returns void.
   */
  nest(id: string, parentId: string): void;
  /**
   * Promote `id` (and its subtree) to root, as one undo step. Graceful no-op when
   * the id is unknown or already at root. Same column-boundary caveat as
   * {@link nest}. Returns void.
   */
  unnest(id: string): void;
  /**
   * Remove a block by id. DESTRUCTIVE: deletes the block AND its entire subtree
   * (all transitive descendants), deepest-first so a container's children aren't
   * promoted to root. The whole cascade is one undo step. Unknown id is a silent
   * no-op. Returns void.
   */
  remove(id: string): void;
  /**
   * Update a block's data and/or tunes by id. Delegates to core's async
   * `blocks.update`, which forms its OWN undo step (not wrapped in `transact`).
   * Unknown id is a silent no-op; a rejected update is swallowed. Returns void.
   */
  update(id: string, data?: BlockToolData, tunes?: { [name: string]: BlockTuneData }): void;
  /**
   * Convert a block to another type ("turn into") by id. Delegates to core's
   * async `blocks.convert`; both tools must provide a `conversionConfig` or core
   * rejects (swallowed → graceful no-op). Unknown id is a silent no-op. Returns void.
   */
  convert(
    id: string,
    newType: string,
    dataOverrides?: BlockToolData,
    options?: { caret?: CaretTarget }
  ): void;
  /**
   * Run `fn` as a single atomic undo step: every mutation it makes is grouped
   * into one history entry. (`insert`/`insertMany`/`nest`/`unnest`/`remove`
   * already wrap themselves; use this to group several calls.) Returns void.
   */
  transact(fn: () => void): void;
  /**
   * Run `fn` as one atomic operation NOT captured in the undo history — for
   * silent auto-repair a user's undo should never step through. Mutations inside
   * still emit reactively. Pre-ready it just runs `fn`.
   */
  transactWithoutCapture(fn: () => void): void;
  /** The current block count. Reactive (re-reads on 'block changed'). Pre-ready: 0. */
  getBlocksCount(): number;
  /** The flat index of the block holding the caret, or -1 when none. Pre-ready: -1. */
  getCurrentBlockIndex(): number;
  /** The block at a flat index as a snapshot {@link BlockNode}, or null. */
  getBlockByIndex(index: number): BlockNode | null;
  /**
   * The absolute flat index of a block by id, or null when unknown. Unknown ids
   * return null silently (no console warn). Pre-ready: null.
   */
  getBlockIndex(id: string): number | null;
  /**
   * Read a block's current `data` and `tunes` by id WITHOUT mutating anything —
   * the synchronous last-extracted view. Unknown id returns null. Pre-ready: null.
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
   * Replace the WHOLE document with blocks parsed from an HTML string — delegates
   * to core's `renderFromHTML`. Unlike {@link insertMarkdown} (additive), this
   * CLEARS existing content first. Async. Pre-ready: resolves immediately (no-op).
   */
  renderFromHTML(html: string): Promise<void>;
  /**
   * Insert a flat array of already-serialized {@link OutputBlockData} (the
   * `save()` shape) directly, honoring each block's `parent`/`content` links. One
   * atomic undo step. Returns the created nodes; pre-ready: `[]` (no insert).
   */
  insertOutputData(blocks: OutputBlockData[], options?: { index?: number }): BlockNode[];
  /**
   * Atomically split a block: update `currentBlockId` with `currentBlockData` and
   * insert a new `newBlockType` block at `insertIndex`, as ONE undo step.
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
   * `blocks.insertInsideParent`. A dangling `parentId` is a no-op returning `null`;
   * `childData` defaults to an empty paragraph. Returns the created node. Pre-ready: `null`.
   */
  insertInsideParent(parentId: string, insertIndex: number, childData?: BlockToolData): BlockNode | null;
  /**
   * Replace the WHOLE document with blocks parsed from saved {@link OutputData} —
   * delegates to core's `blocks.render`. CLEARS existing content first (a
   * document-LOAD primitive). Async. Pre-ready: resolves immediately (no-op).
   */
  render(data: OutputData): Promise<void>;
  /**
   * Remove EVERY block from the document — delegates to core's `blocks.clear`. A
   * document-reset primitive (pairs with {@link render}). Async. Pre-ready:
   * resolves immediately (no-op).
   */
  clear(): Promise<void>;
  /**
   * Whether a Yjs sync (undo/redo) is currently in progress — the Vue mirror of
   * core's `blocks.isSyncingFromYjs`. A METHOD (not a property) so it reads the
   * LIVE flag at call time. Pre-ready: `false`.
   */
  isSyncingFromYjs(): boolean;
}

/**
 * Composable exposing a reactive, id/parentId-relative view of the block tree
 * for connection ops (insert/move/nest/unnest/remove) — the "everything is a
 * block" tree, manipulated without flat-index math. Mirrors React's `useBlocks`.
 *
 * @param editor - the Blok instance (value/ref/getter), or null before ready
 *
 * @example
 * ```ts
 * const editor = useBlok(() => ({ tools }));
 * const blocks = useBlocks(editor);
 * blocks.transact(() => {
 *   const created = blocks.insert({ type: 'paragraph', parentId: 'toggle-1', position: 'end' });
 *   blocks.move(created!.id, { after: 'sibling-2' });
 * });
 * ```
 */
export declare function useBlocks(editor: MaybeRefOrGetter<Blok | null>): UseBlocksApi;

/** One field of a {@link CreateVueBlockSpec.propSchema}. */
export interface PropSchemaEntry {
  default: unknown;
  values?: readonly unknown[];
}

/**
 * Declarative data shape. Its keys are EXACTLY the keys `save()` returns to Yjs
 * (a cleared field is written as its default, never dropped).
 */
export type PropSchema = Record<string, PropSchemaEntry>;

/** Context handed to a Vue block's `setup` (the only data write path is `commit`). */
export interface VueBlockRenderProps<Data> {
  /** Reactive, frozen snapshot of the block data. Read `data.value`; never mutate. */
  data: ShallowRef<Readonly<Data>>;
  /** The ONLY data write path: merge a partial patch and sync once. */
  commit: (patch: Partial<Data>) => void;
  /** This block's per-block API. */
  block: BlockAPI;
  /**
   * Reactive read-only flag. Read `readOnly.value` in render to disable editing.
   * Toggled IN PLACE by core's read-only switch (no remount, ephemeral state
   * survives). Honor it — a block that ignores it stays interactive when the
   * editor is read-only.
   */
  readOnly: Readonly<ShallowRef<boolean>>;
  /** Engine-owned child slot — render `h(BlockChildren)` for a container block. */
  BlockChildren: Component;
}

/** Spec for {@link createVueBlock}. Authored as a `.ts` render function (no SFC). */
export interface CreateVueBlockSpec<Data extends BlockToolData = BlockToolData> {
  type: string;
  toolbox?: ToolboxConfig;
  propSchema: PropSchema;
  setup: (props: VueBlockRenderProps<Data>) => () => unknown;
  onRendered?: (block: BlockAPI) => void;
  onMoved?: (block: BlockAPI) => void;
  onRemoved?: (block: BlockAPI) => void;
}

/**
 * Author a first-party Vue block: returns a `BlockToolConstructable` registered
 * exactly like a vanilla tool (`tools: { type: { class: createVueBlock(...) } }`).
 * The factory owns the mutation-free host, a frozen defaults-filled data mirror,
 * and a reactive snapshot the component reads; it bridges Blok's block lifecycle
 * to Vue (in-place `setData`, complete-mirror `save`, deterministic unmount).
 *
 * @example
 * ```ts
 * const Callout = createVueBlock<{ text: string }>({
 *   type: 'callout',
 *   propSchema: { text: { default: '' } },
 *   setup({ data, commit }) {
 *     return () => h('aside', { onClick: () => commit({ text: 'hi' }) }, data.value.text);
 *   },
 * });
 * ```
 */
export declare function createVueBlock<Data extends BlockToolData = BlockToolData>(
  spec: CreateVueBlockSpec<Data>
): BlockToolConstructable;
