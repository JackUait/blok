import type { BlokConfig, BlockToolData } from './index';
import type { Blok, EditorWidth, BlockRenderedPayload, BlocksRenderedPayload } from './index';
import type { BlockTuneData } from './block-tunes/block-tune-data';
import type React from 'react';

/**
 * Configuration for the useBlok hook.
 * Accepts all BlokConfig properties except `holder`, plus a React-only `width` prop.
 *
 * Reactive props (sync after mount without recreation):
 * - `readOnly` — calls `editor.readOnly.set(value)`
 * - `autofocus` — calls `editor.focus()` when changed to true
 * - `theme` — calls `editor.theme.set(value)`
 * - `width` — calls `editor.width.set(value)`
 * - `placeholder` — calls `editor.placeholder.set(value)`
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
 * @param deps - Optional dependency array. When any dep changes, the editor is destroyed and recreated. Keep each value referentially stable (primitives or useMemo-stable objects) so the editor isn't recreated every render.
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
}

export interface TreeInsertSpec {
  type?: string;
  data?: BlockToolData;
  tunes?: { [name: string]: BlockTuneData };
  /**
   * Explicit id for this node (generated when omitted). Unlike `insert`, this is
   * NOT insert-if-absent: a tree insert always creates fresh blocks, so a
   * colliding id is the caller's responsibility.
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
   * (returns `[]`, opens no transaction), matching {@link insert}.
   *
   * Returns the created {@link BlockNode}s in document order; empty or
   * whitespace-only markdown (and a dangling `parentId`) returns `[]` and opens
   * no transaction. The nodes are fresh-snapshot volatile — read them now, don't
   * stash them in dep arrays.
   */
  insertMarkdown(
    markdown: string,
    options?: { parentId?: string | null; position?: InsertPosition }
  ): Promise<BlockNode[]>;
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
  convert(id: string, newType: string, dataOverrides?: BlockToolData): void;
  /**
   * Run `fn` as a single atomic undo step: every mutation it makes is grouped
   * into one history entry, so a single undo reverts the whole batch. Delegates
   * to core's `blocks.transact` when available and otherwise just invokes `fn`
   * directly. (`insert`/`insertMany`/`nest`/`unnest`/`remove` already wrap
   * themselves; use this to group several calls into one step.) Returns void.
   */
  transact(fn: () => void): void;
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
