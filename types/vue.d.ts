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
  OutputData,
  ResolvedTheme,
  ToolboxConfig,
} from './index';
import type { BlockTuneData } from './block-tunes/block-tune-data';

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

/** Where to move an existing block. */
export type MoveTarget = { before: string } | { after: string } | { toIndex: number };

/**
 * Reactive, id/parentId-relative view of the block tree returned by
 * {@link useBlocks}. Reads are reactive (re-run inside a `computed`/template on
 * `block changed`); mutators delegate to the editor's `blocks` API.
 */
export interface UseBlocksApi {
  getById(id: string): BlockNode | null;
  getChildren(parentId: string | null): BlockNode[];
  getBlocksCount(): number;
  getBlockIndex(id: string): number | null;
  insert(spec?: InsertSpec): BlockNode | null;
  move(id: string, target: MoveTarget): void;
  nest(id: string, parentId: string): void;
  unnest(id: string): void;
  remove(id: string): void;
  transact(fn: () => void): void;
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
