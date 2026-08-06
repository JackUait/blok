import { isValidElement, useEffect, useRef, type ComponentType, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  applyChildDecoration,
  BlockChildrenMounted,
  createChildDecorationLedger,
  DATA_ATTR,
  deepEqual,
  fillDefaults,
  mountChildBlocks,
  type PropSchema,
} from '@bloklabs/core/adapters';
import {
  BLOK_PORTAL_REGISTRY_CONFIG_KEY,
  BLOK_TOOL_NAME_CONFIG_KEY,
  type BlockPortalRegistry,
} from './block-portal-registry';
import type { API } from '@/types';
import type { BlockAPI } from '@/types/api';
import type {
  BlockOrigin,
  BlockToolConstructable,
  BlockToolConstructorOptions,
  BlockToolData,
  ToolboxConfig,
  ToolboxConfigEntry,
} from '@/types/tools';

export type { PropSchema, PropSchemaEntry } from '@bloklabs/core/adapters';

/** Adapter-internal config keys, stripped before the config reaches the component. */
const INTERNAL_CONFIG_KEYS: readonly string[] = [
  BLOK_PORTAL_REGISTRY_CONFIG_KEY,
  BLOK_TOOL_NAME_CONFIG_KEY,
];

/**
 * Every STATIC member of core's block-tool contract a React block may declare
 * for itself — `ownsChildren`, `keepsChildrenOnEnter`, `conversionConfig`,
 * `pasteConfig`, `sanitize`, `shortcut`, `upgradeData`, and whatever core adds
 * next. Derived from
 * `BlockToolConstructable` rather than enumerated, so a new core static needs no
 * adapter change to become reachable.
 *
 * `toolbox` and `isReadOnlySupported` are excluded because the factory owns
 * them: `toolbox` is authored as {@link CreateReactBlockSpec.toolbox} (React
 * elements and all), and in-place read-only support is unconditional.
 */
export type BlockToolStatics = Omit<BlockToolConstructable, 'toolbox' | 'isReadOnlySupported'>;

/**
 * Announce that a container's child holders have settled in its slot — the
 * signal a host waits on before putting the caret into a freshly inserted
 * child, since the portal commits a frame after core's `rendered()`.
 *
 * Optional-chained: the editor always supplies `events`, but a host unit test
 * may hand a block a partial `api`, and an observability signal must never be
 * able to break a render.
 * @param api - the editor-level API
 * @param blockId - the container block's id
 * @param children - the container's model children, in model order
 */
const emitChildrenMounted = (api: API, blockId: string, children: BlockAPI[]): void => {
  api?.events?.emit(BlockChildrenMounted, {
    blockId,
    childIds: children.map(child => child.id),
  });
};

/**
 * Origins that mean "the author just made this block" — the only ones that fire
 * {@link CreateReactBlockSpec.onCreated}. Written as an allow-list so a future
 * core origin fails CLOSED (no creation signal) instead of silently opting in.
 *
 * `undefined` is included because core always supplies an origin: an absent one
 * means a host hand-built the constructor options, which is an explicit
 * creation — the same reading core's own container tools apply.
 *
 * Note what is NOT the axis here: `origin === 'user'`. A container gated on that
 * alone would refuse to seed for `api.blocks.insert('steps')` and for a
 * turn-into, leaving an empty, unusable container.
 */
const CREATION_ORIGINS: ReadonlySet<BlockOrigin | undefined> = new Set<BlockOrigin | undefined>([
  undefined,
  'user',
  'api',
  'convert',
]);

/** Statics the generated class owns; an authored `statics` bag can never take them over. */
const RESERVED_STATICS: readonly string[] = [
  'toolbox',
  'isReadOnlySupported',
  '__isBlokReactBlock',
  '__buildPortalToolbox',
];

/** Props handed to a React block's `component` (the only data write path is `commit`). */
export interface ReactBlockRenderProps<Data, Config = Record<string, unknown>> {
  /** Frozen snapshot of the block data. Re-rendered with a new value on change; never mutate. */
  data: Readonly<Data>;
  /**
   * The ONLY data write path: merge a partial patch and sync once. Idempotency
   * is part of the public contract — a patch that changes nothing is a FULL
   * no-op (no re-render, no change event), so effects may echo current values
   * through `commit` on any render, including mount, without a guard.
   */
  commit: (patch: Partial<Data>) => void;
  /** This block's per-block API (id, connection methods, dispatchChange…). */
  block: BlockAPI;
  /**
   * The EDITOR-level API this block belongs to (`api.blocks`, `api.caret`,
   * `api.toolbar`…) — the same object a vanilla tool receives in its
   * constructor. Reach for it when a block has to drive the document around it
   * (insert a sibling, move the caret, open the toolbox) instead of routing
   * everything through `block.call()` string dispatch.
   *
   * For the reactive, id/parentId-relative view of the tree (and to re-render
   * when your own children change), pair `useBlocks` with `useBlokInstance()`
   * instead — the api handle itself is not reactive.
   */
  api: API;
  /**
   * Read-only flag. Render disabled/inert UI when true (e.g. drop
   * `contentEditable`, hide controls). Toggled IN PLACE by core's read-only
   * switch — the component re-renders without remounting, so ephemeral state
   * survives. Honor it: a block that ignores `readOnly` stays interactive when
   * the editor is read-only (same contract as a vanilla tool's `setReadOnly`).
   */
  readOnly: boolean;
  /**
   * The tool's `config` from the consumer's `tools` map (adapter-internal keys
   * stripped) — the first-class channel for host props (permissions, CDN/upload
   * URLs, locale…). No context provider needed. Under `useBlok`/`BlokEditor`
   * this prop is LIVE: functions always call the latest render's closure, and
   * changed non-function values are pushed to mounted blocks in place — so
   * config values never belong in `deps`.
   */
  config: Readonly<Partial<Config>>;
  /** Engine-owned child slot — render `<BlockChildren />` for a container block. */
  BlockChildren: ComponentType<BlockChildrenProps>;
  /**
   * Attach this to the element the +/drag toolbar should vertically center on:
   * `<div ref={toolbarAnchorRef}>`. The React-native way to answer core's
   * `getToolbarAnchorElement`, which is otherwise a `(host, block) => Element`
   * hook resolved OUTSIDE the component tree — so pointing at an element you
   * render meant inventing a data attribute and `querySelector`-ing for it from
   * {@link CreateReactBlockSpec.getToolbarAnchorElement}.
   *
   * A container block whose own chrome is not editable needs an anchor: with
   * none, core centers the toolbar on the first `[contenteditable]` under the
   * host, which for a container is its FIRST CHILD BLOCK — parking the +/drag
   * handles halfway down, beside content that has a toolbar of its own.
   *
   * The ref is stable across renders and outranks
   * {@link CreateReactBlockSpec.getToolbarAnchorElement} while it holds a
   * MOUNTED element; when the element unmounts (React calls the ref with null,
   * or it is detached) the declared hook takes over again, so the toolbar is
   * never positioned against a stale node. Leave it unattached to keep core's
   * default.
   */
  toolbarAnchorRef: (element: HTMLElement | null) => void;
}

/**
 * One child's decoration: attribute name → value. `null`/`undefined` removes the
 * attribute; a boolean or number is stringified (so `false` writes
 * `data-active="false"`, which CSS can select, rather than dropping the hook).
 */
export type ChildAttributes = Record<string, string | number | boolean | null | undefined>;

/** Props of the engine-owned {@link ReactBlockRenderProps.BlockChildren} slot. */
export interface BlockChildrenProps {
  /**
   * Per-child decoration, applied to each child's HOLDER after the holders are
   * mounted. Named hooks (`data-step-index`, `data-active`…) replace positional
   * `:nth-child()` CSS over Blok's holders, which silently breaks the moment a
   * child is inserted, removed or reordered.
   *
   * The holders themselves stay DIRECT children of the slot — core requires that
   * (hierarchy reparenting looks for the next sibling whose
   * `holder.parentElement` IS the container, and caret navigation decides
   * "same container" by that identity), so decoration is expressed as attributes
   * rather than as wrapper elements. Attributes the callback stops producing are
   * removed on the next pass, so a reordered child never keeps a dead index.
   *
   * Writing on a child's holder is inert by design: core's mutation filter drops
   * a holder-targeted attribute record for the child block (the holder is the
   * child tool element's ANCESTOR, not its descendant) and suppresses it for the
   * container (whose own host is the nearest `data-blok-mutation-free` ancestor).
   * The guarantee stops at the holder and its `[data-blok-element-content]`
   * wrapper — writing AT or BELOW a child's tool root DOES score as that child's
   * edit.
   * @param child - the child block's API
   * @param index - the child's position in the container's model children
   */
  childAttributes?: (child: BlockAPI, index: number) => ChildAttributes;
  /**
   * The same per-child decoration, applied one level IN: on each child's
   * `[data-blok-element-content]` wrapper instead of its holder. Core's
   * child-holder decoration law blesses both, and a container needs both — the
   * holder is the child's outer box (rails, indices, hover states), while the
   * content wrapper is where the child's own text box begins, which is what a
   * numbered rail or a connector line has to align to.
   *
   * Reach for it instead of walking core's wrapper chain from a holder hook
   * (`[data-step] > [data-blok-element-content] > …`): those selectors encode
   * engine DOM structure in host CSS and break the moment that structure changes.
   * With a named hook the selector is one flat attribute.
   *
   * Same cleanup and same inertness as {@link BlockChildrenProps.childAttributes}
   * — attributes the callback stops producing are removed on the next pass, and
   * writes here are still not the child's edit. A child whose DOM has not
   * committed yet (a portal-rendered block, on the first pass) has no wrapper to
   * write to and is skipped, then stamped on the next pass.
   * @param child - the child block's API
   * @param index - the child's position in the container's model children
   */
  childContentAttributes?: (child: BlockAPI, index: number) => ChildAttributes;
}

/**
 * Props handed to a React block's `viewComponent` (the read-only renderer):
 * the entry props minus `commit` — a display renderer has no write path.
 */
export type ReactBlockViewProps<Data, Config = Record<string, unknown>> = Omit<
  ReactBlockRenderProps<Data, Config>,
  'commit' | 'readOnly'
>;

/** A toolbox entry whose `icon`/`title` may be a React element instead of a string. */
export type ReactToolboxConfigEntry = Omit<ToolboxConfigEntry, 'icon' | 'title'> & {
  /**
   * Toolbox icon. Core's toolbox chrome consumes markup strings, but React
   * authors may pass the same element they render in the block body — the
   * factory serializes it to markup once (lazily, cached) so icons are never
   * duplicated as parallel raw SVG strings. Without a DOM (SSR) the element is
   * returned as-is and serialization retries on the next browser-side access.
   */
  icon?: string | ReactElement;
  /**
   * Toolbox label. A plain string is translated by core through the
   * `toolNames.*` namespace as usual. A ReactElement instead renders live in
   * the HOST's React tree (via the editor's shared BlockPortalHost), so the
   * label tracks the host's OWN i18n — no mirroring of strings into Blok's
   * dictionary. Pair a ReactElement title with `titleKey` so multilingual
   * search still resolves an English term. Requires the editor to be created
   * through `useBlok`/`BlokEditor` (which wires the portal registry); a
   * ReactElement title is dropped when the tool is used with vanilla core.
   */
  title?: string | ReactElement;
};

/** Toolbox config for React blocks: single entry or several variants. */
export type ReactToolboxConfig = ReactToolboxConfigEntry | ReactToolboxConfigEntry[];

/**
 * Second argument of {@link CreateReactBlockSpec.onMounted} and
 * {@link CreateReactBlockSpec.onCreated} — everything the block cannot read off
 * its own `BlockAPI`.
 */
export interface ReactBlockMountedContext {
  /**
   * Why this block instance was constructed: a CREATION origin (`user`, `api`,
   * `convert`) means the author just made it, so seeding default children is
   * correct; a RESTORE origin (`load`, `replay`, `paste`) means the document
   * already says what the children are. `probe` is an off-tree instance built
   * only to read a tool's default data — it must not touch the block tree at
   * all. Defaults to `'api'` when the constructor was handed no origin.
   */
  origin: BlockOrigin;
  /** The editor-level API (`api.blocks`, `api.caret`, `api.events`…). */
  api: API;
}

/** Spec for {@link createReactBlock}. */
export interface CreateReactBlockSpec<Data = BlockToolData, Config = Record<string, unknown>> {
  /** Tool type name (registered key). */
  type: string;
  /** Optional toolbox entry; `icon` accepts a React element (see {@link ReactToolboxConfigEntry}). */
  toolbox?: ReactToolboxConfig;
  /** Declarative defaults that also define the exact `save()` key set. */
  propSchema: PropSchema;
  /** The component rendered for each block instance. */
  component: ComponentType<ReactBlockRenderProps<Data, Config>>;
  /**
   * Optional read-only renderer: when the editor is read-only, this component
   * is rendered INSTEAD of `component`, so blocks don't hand-plumb a
   * display-vs-edit ternary. It receives the entry props minus `commit` (no
   * write path) and minus `readOnly` (always true by definition). Toggling read-only
   * swaps renderers — ephemeral state does not survive the swap; omit
   * `viewComponent` to keep the single-component in-place toggle instead.
   */
  viewComponent?: ComponentType<ReactBlockViewProps<Data, Config>>;
  /**
   * Static members of core's tool contract, forwarded verbatim onto the
   * generated tool class — the single channel for everything core reads off the
   * CLASS rather than the instance (`ownsChildren`, `keepsChildrenOnEnter`,
   * `conversionConfig`, `pasteConfig`, `sanitize`, `shortcut`, `upgradeData`…).
   * Without it the only way to declare one was to subclass the generated class.
   *
   * `keepsChildrenOnEnter` is the per-tool Enter POLICY: declare it and Enter on
   * this container's empty LAST child creates the new line INSIDE the container
   * instead of escaping to the container's parent (Blok's default, which is
   * Notion's callout behaviour). Core cannot read that off the DOM — a callout
   * renders the same `data-blok-nested-blocks` slot as a column yet wants the
   * escape — so before it existed a layout container (a card, a `steps` block)
   * had to hijack the editor-global `config.onEnter` and re-derive containment.
   *
   * `toolbox` and `isReadOnlySupported` are owned by the factory and cannot be
   * overridden here (see {@link BlockToolStatics}).
   * @example
   * ```ts
   * statics: { ownsChildren: true, conversionConfig: { export: 'text', import: 'text' } }
   * ```
   */
  statics?: BlockToolStatics;
  /**
   * The element the +/drag toolbar should vertically center on — core's
   * `getToolbarAnchorElement` hook, resolved against this block's host element
   * on every call (never cached, so it tracks re-renders).
   *
   * A container block whose own chrome is not editable needs it: with no anchor,
   * core centers the toolbar on the first `[contenteditable]` it finds under the
   * host, which for a container is its FIRST CHILD BLOCK — parking the +/drag
   * handles halfway down the block, beside content that has a toolbar of its
   * own. Return `null`/`undefined` (or omit the field) to keep core's default.
   * @param host - this block's mutation-free host element
   * @param block - this block's per-block API
   */
  getToolbarAnchorElement?: (host: HTMLElement, block: BlockAPI) => HTMLElement | null | undefined;
  /** Optional lifecycle callbacks mapped from Blok's block hooks. */
  onRendered?: (block: BlockAPI) => void;
  /**
   * Fired ONCE per block instance, after the portal's FIRST commit — the first
   * moment this block's rendered DOM exists (and, for a container, the moment
   * `<BlockChildren />` has adopted the child holders). `onRendered` cannot
   * mean that: core calls `rendered()` in the same tick as `render()`, a commit
   * BEFORE React has drawn anything, which is why hosts ended up setting the
   * caret twice around a `requestAnimationFrame`.
   *
   * It is also the create-vs-restore signal: `context.origin` says whether the
   * author just made this block (`user`/`api`/`convert`) or the document is
   * being re-materialised (`load`/`replay`/`paste`) — so a container can seed
   * its default children here exactly once, without the "children are
   * transiently empty during a replay" trap.
   * @example
   * ```ts
   * onMounted: (block, { origin, api }) => {
   *   if (origin === 'user' && block.getChildren().length === 0) {
   *     api.blocks.insertInsideParent(block.id);
   *   }
   * }
   * ```
   */
  onMounted?: (block: BlockAPI, context: ReactBlockMountedContext) => void;
  /**
   * The SEEDING hook: `onMounted`, narrowed to a genuine creation. Fired ONCE
   * per block instance, after the portal's first commit, and only when this
   * instance is the author making a new block (`origin` of `user`, `api` or
   * `convert`) — never for a `load`/`replay`/`paste` restore, and never for the
   * off-tree `probe` instance core builds to read a tool's default data.
   *
   * That predicate is why the hook exists rather than leaving every block to
   * read `context.origin` in `onMounted`: the intuitive `origin === 'user'` test
   * is wrong. It drops `api.blocks.insert('steps')` and turn-into, so a
   * container seeded that way comes up empty for every path except a keystroke.
   * Core refused to ship that axis into its own `column`/`column_list`; this
   * encodes the correct one once, here.
   *
   * The `context` is the same object {@link CreateReactBlockSpec.onMounted}
   * receives, so a block that only seeds can read `origin` for finer decisions
   * (e.g. seed a different default for a turn-into).
   * @example
   * ```ts
   * onCreated: (block, { api }) => {
   *   if (block.getChildren().length === 0) {
   *     api.blocks.insertInsideParent(block.id);
   *   }
   * }
   * ```
   */
  onCreated?: (block: BlockAPI, context: ReactBlockMountedContext) => void;
  onMoved?: (block: BlockAPI) => void;
  onRemoved?: (block: BlockAPI) => void;
}

/**
 * Author a first-party React block. Returns a `BlockToolConstructable`
 * registered exactly like a vanilla tool (`tools: { type: createReactBlock(...) }`).
 *
 * The factory owns the host element (`data-blok-mutation-free`), a frozen
 * defaults-filled data mirror, and the entry props the component reads. It
 * portals the component into the host via the editor's shared portal registry
 * (the TipTap `ReactNodeViewRenderer` pattern) — every block renders inside the
 * SAME React tree that renders `BlokContent`, so app-level context (themes,
 * design-system providers, stores) flows into blocks with no bridge. Blok's
 * block lifecycle maps to React:
 * - `render()` creates the host and registers the portal entry (returned sync).
 * - `setData()` dedups, pushes the new snapshot, and flushes React's commit
 *   before resolving `true` — defeating core's default remount.
 * - `save()` returns the complete frozen mirror (never the DOM, never partial).
 * - `commit()` merges a patch and fires `dispatchChange` exactly once.
 * - `removed()`/`destroy()` unregister the portal (deterministic unmount).
 */
export function createReactBlock<Data = BlockToolData, Config = Record<string, unknown>>(
  spec: CreateReactBlockSpec<Data, Config>
): (new (options: BlockToolConstructorOptions) => {
  render(): HTMLElement;
  save(): BlockToolData;
  setData(newData: BlockToolData): Promise<boolean>;
  setReadOnly(state: boolean): void;
  getToolbarAnchorElement(): HTMLElement | undefined;
  rendered(): void;
  moved(): void;
  removed(): void;
  destroy(): void;
}) & BlockToolStatics & {
  readonly __isBlokReactBlock: true;
  readonly toolbox: ToolboxConfig | undefined;
  /**
   * Adapter-internal: builds a per-editor toolbox whose ReactElement titles are
   * live portals registered in `registry`. Called by `useBlok`; returns
   * undefined when no entry has a ReactElement title. Not part of the public
   * tool contract.
   */
  __buildPortalToolbox(registry: BlockPortalRegistry, toolName: string): ToolboxConfig | undefined;
  readonly isReadOnlySupported: boolean;
} {
  /**
   * Serialize a React element (an icon) to markup with a throwaway synchronous
   * root. Returns null when serialization cannot complete: without a DOM
   * (SSR — core never reads `toolbox` server-side, but a consumer may), or
   * when the flush was deferred because React was already rendering (flushSync
   * inside a render is a no-op with a warning, leaving the mount empty). A
   * null result is NOT cached, so the next access retries.
   */
  const renderElementToMarkup = (element: ReactElement): string | null => {
    if (typeof document === 'undefined') {
      return null;
    }

    const mount = document.createElement('div');
    const root = createRoot(mount);

    flushSync(() => {
      root.render(element);
    });

    const markup = mount.innerHTML;

    root.unmount();

    return markup === '' ? null : markup;
  };

  /**
   * Convert one React toolbox entry to a core-valid entry: serialize a React
   * icon to markup, and DROP a ReactElement title (core titles are
   * string | HTMLElement only). A string title passes through untouched; the
   * live element title is re-attached per-editor by `buildPortalToolbox`.
   *
   * `deferred` is true when icon serialization could not complete (SSR /
   * mid-render) and must be retried; the entry is returned with its element
   * icon left in place.
   *
   * @param entry - the authored React toolbox entry
   */
  const toCoreEntry = (
    entry: ReactToolboxConfigEntry
  ): { entry: ToolboxConfigEntry; deferred: boolean } => {
    const { icon, title, ...rest } = entry;
    const core: ToolboxConfigEntry = { ...(rest as ToolboxConfigEntry) };

    if (typeof title === 'string') {
      core.title = title;
    }

    if (!isValidElement(icon)) {
      if (icon !== undefined) {
        core.icon = icon;
      }

      return { entry: core, deferred: false };
    }

    const markup = renderElementToMarkup(icon);

    if (markup === null) {
      // Serialization deferred (SSR / mid-render): leave the element in place
      // and skip caching so a later browser-side access serializes it.
      (core as ReactToolboxConfigEntry).icon = icon;

      return { entry: core, deferred: true };
    }

    core.icon = markup;

    return { entry: core, deferred: false };
  };

  const convertToolbox = (): { value: ToolboxConfig | undefined; complete: boolean } => {
    if (spec.toolbox === undefined) {
      return { value: undefined, complete: true };
    }

    const entries = Array.isArray(spec.toolbox) ? spec.toolbox : [spec.toolbox];
    const converted = entries.map((entry) => toCoreEntry(entry));
    const complete = converted.every((result) => !result.deferred);
    const coreEntries = converted.map((result) => result.entry);
    const value = Array.isArray(spec.toolbox) ? coreEntries : coreEntries[0];

    return { value, complete };
  };

  /**
   * Build a per-editor toolbox in which every ReactElement title is a live
   * portal: a Blok-owned mutation-free host element registered in the editor's
   * `registry`, into which the ReactNode renders through the shared
   * BlockPortalHost — so the label tracks the host's own i18n.
   *
   * Returns undefined when no entry has a ReactElement title (nothing to
   * override; the static string/`toolNames.*` path already covers it).
   *
   * The override carries only what it uniquely owns. `useBlok` calls this from
   * a passive effect, i.e. inside React's commit phase, where `flushSync`
   * cannot flush — so an element ICON never serializes here. Such an icon is
   * OMITTED rather than shipped raw (core `insertAdjacentHTML`s it, writing the
   * literal `[object Object]`); core then merges this override OVER the static
   * toolbox, which serializes the same element successfully later, outside
   * React's commit. That merge is also why the authored SHAPE is preserved: a
   * single-object spec must stay a single object, or core replaces the tool
   * entry wholesale instead of merging and the entry ends up icon-less — which
   * silently drops it from the convert menu and block settings.
   *
   * @param registry - the editor's portal registry (from `useBlok`)
   * @param toolName - the name the tool is registered under
   */
  const buildPortalToolbox = (
    registry: BlockPortalRegistry,
    toolName: string
  ): ToolboxConfig | undefined => {
    if (spec.toolbox === undefined) {
      return undefined;
    }

    const entries = Array.isArray(spec.toolbox) ? spec.toolbox : [spec.toolbox];

    // Nothing to override unless at least one entry has a ReactElement title;
    // the static string/`toolNames.*` path already covers the rest.
    if (!entries.some((entry) => isValidElement(entry.title))) {
      return undefined;
    }

    const overrides = entries.map((entry, index): ToolboxConfigEntry => {
      const { entry: core, deferred } = toCoreEntry(entry);

      if (deferred) {
        // Omit the key entirely: an explicit `icon: undefined` would still
        // shadow the tool entry's icon in core's spread merge.
        delete core.icon;
      }

      if (!isValidElement(entry.title)) {
        return core;
      }

      const host = document.createElement('span');

      host.setAttribute('data-blok-mutation-free', 'true');

      const node = entry.title;
      const TitleComponent: ComponentType<Record<string, unknown>> = (): ReactElement => <>{node}</>;

      TitleComponent.displayName = `BlokToolboxTitle(${toolName})`;

      // Unique within this per-editor registry; register() is idempotent, so a
      // StrictMode double-build replaces rather than duplicates.
      registry.register(`__blok-toolbox-title__:${toolName}:${index}`, {
        hostEl: host,
        component: TitleComponent,
        props: {},
        toolName,
      });

      return { ...core, titleEl: host };
    });

    // Keep the authored shape (see the merge note above).
    return Array.isArray(spec.toolbox) ? overrides : overrides[0];
  };

  /** Lazily-computed core-compatible toolbox (React element icons serialized once). */
  const toolboxCache: { resolved: boolean; value: ToolboxConfig | undefined } = {
    resolved: false,
    value: undefined,
  };

  const resolveToolbox = (): ToolboxConfig | undefined => {
    if (toolboxCache.resolved) {
      return toolboxCache.value;
    }

    const { value, complete } = convertToolbox();

    // Only a fully-serialized toolbox is cached; an incomplete pass (no DOM,
    // deferred flush) is returned as-is and recomputed on the next access.
    if (complete) {
      toolboxCache.value = value;
      toolboxCache.resolved = true;
    }

    return value;
  };

  /**
   * The component actually registered with the portal: when the spec provides a
   * `viewComponent`, this chooser swaps to it while read-only (dropping the
   * write-path props); otherwise the edit component is registered directly and
   * keeps its in-place read-only toggle semantics.
   */
  const ReadOnlySwitch = (props: ReactBlockRenderProps<Data, Config>): ReactElement => {
    const ViewComponent = spec.viewComponent;

    if (props.readOnly && ViewComponent !== undefined) {
      const { commit: _commit, readOnly: _readOnly, ...viewProps } = props;

      return <ViewComponent {...(viewProps)} />;
    }

    const EditComponent = spec.component;

    return <EditComponent {...props} />;
  };

  const entryComponent: ComponentType<ReactBlockRenderProps<Data, Config>> =
    spec.viewComponent === undefined ? spec.component : ReadOnlySwitch;

  const ReactBlockTool = class ReactBlockTool {
    /** Marker so `useBlok` can detect react-block tools and inject the registry. */
    public static readonly __isBlokReactBlock = true as const;

    public static get toolbox(): ToolboxConfig | undefined {
      return resolveToolbox();
    }

    /**
     * Adapter-internal (see the return-type doc): builds the per-editor toolbox
     * override whose ReactElement titles are live portals in `registry`.
     */
    public static __buildPortalToolbox(
      registry: BlockPortalRegistry,
      toolName: string
    ): ToolboxConfig | undefined {
      return buildPortalToolbox(registry, toolName);
    }

    /**
     * React blocks support read-only mode: `setReadOnly` pushes a new prop the
     * component reads, so the block re-renders read-only IN PLACE. Without this
     * flag core's ReadOnly module throws a critical error when read-only is
     * enabled and a React block is present.
     */
    public static get isReadOnlySupported(): boolean {
      return true;
    }

    private readonly blockApi: BlockAPI;
    /** The editor-level API, handed to the component as the `api` prop. */
    private readonly api: API;
    private readonly registry: BlockPortalRegistry | undefined;
    /** Name this tool is registered under in the consumer's `tools` map. */
    private readonly toolName: string | undefined;
    /** The consumer's tool config with adapter-internal keys stripped. */
    private readonly toolConfig: Readonly<Partial<Config>>;
    private readonly pointerDrag: () => boolean;
    private readonly childrenComponent: ComponentType<BlockChildrenProps>;
    /** Why core built this instance — gates `onCreated`, handed to `onMounted`. */
    private readonly origin: BlockOrigin;
    /** The component registered with the portal (the post-mount gate, if any). */
    private readonly entryComponent: ComponentType<ReactBlockRenderProps<Data, Config>>;
    /** True once the post-mount hooks fired; keeps a StrictMode remount from re-firing them. */
    private mountSignalled = false;
    private mirror: Readonly<Data>;
    /** Dedup baseline: skip a redundant render of identical data. */
    private lastRendered: Readonly<Data>;
    /** Read-only flag mirrored into the entry props by setReadOnly. */
    private readOnly: boolean;
    private hostEl: HTMLElement | null = null;
    /** True while a deferred dispatch is waiting for a pointer drag to end. */
    private pendingDispatch = false;
    /** Element the component pointed `toolbarAnchorRef` at, if any. */
    private anchorEl: HTMLElement | null = null;
    /**
     * The `toolbarAnchorRef` prop. A bound field so its identity is STABLE
     * across renders — a fresh callback ref each render would make React detach
     * (null) and re-attach it on every commit.
     * @param element - the element React attached, or null on detach
     */
    private readonly toolbarAnchorRef = (element: HTMLElement | null): void => {
      this.anchorEl = element;
    };

    public constructor(options: BlockToolConstructorOptions) {
      this.blockApi = options.block;

      const config = (options.config ?? {}) as Record<string, unknown>;

      this.registry = config[BLOK_PORTAL_REGISTRY_CONFIG_KEY] as BlockPortalRegistry | undefined;
      const toolName = config[BLOK_TOOL_NAME_CONFIG_KEY];

      this.toolName = typeof toolName === 'string' ? toolName : undefined;

      const publicConfig: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(config)) {
        if (!INTERNAL_CONFIG_KEYS.includes(key)) {
          publicConfig[key] = value;
        }
      }
      this.toolConfig = Object.freeze(publicConfig) as Readonly<Partial<Config>>;

      this.api = options.api;

      // Read the LIVE pointer-drag flag so a mid-drag commit can be deferred
      // (core silently drops a dispatchChange while a drag is active).
      const drag = options.api as unknown as { blocks?: { isPointerDragActive?: boolean } } | undefined;

      this.pointerDrag = (): boolean => drag?.blocks?.isPointerDragActive === true;

      this.mirror = fillDefaults<Data>(spec.propSchema, (options.data ?? {}) as Record<string, unknown>);
      this.lastRendered = this.mirror;
      this.readOnly = options.readOnly;
      // Absent origin means a caller that predates the signal; 'api' is core's
      // own default, so it is never mistaken for a user gesture.
      this.origin = options.origin ?? 'api';

      const blockApi = this.blockApi;
      const api = this.api;

      // Per-instance child slot: a childless ref'd div Blok owns; mountChildBlocks
      // appends the real child holders imperatively (React never reconciles them).
      this.childrenComponent = function BlockChildren({
        childAttributes,
        childContentAttributes,
      }: BlockChildrenProps): ReactElement {
        const slotRef = useRef<HTMLDivElement | null>(null);
        // What the last decoration pass wrote, so a dropped key is cleaned up.
        const ledgerRef = useRef(createChildDecorationLedger());

        // No dep array: re-adopt children after EVERY render (mirrors the Vue
        // adapter's onMounted + onUpdated pair).
        useEffect(() => {
          if (slotRef.current === null) {
            return;
          }

          const children = blockApi.getChildren();

          mountChildBlocks(slotRef.current, children);
          applyChildDecoration(ledgerRef.current, children, { childAttributes,
            childContentAttributes });
          emitChildrenMounted(api, blockApi.id, children);
        });

        return <div ref={slotRef} {...{ [DATA_ATTR.nestedBlocks]: '' }} />;
      };

      this.entryComponent = this.buildEntryComponent();
    }

    /**
     * The component actually registered with the portal. Without a post-mount
     * hook it is the shared per-TYPE component; with one it is a thin
     * per-INSTANCE gate whose mount effect fires the hooks after React's first
     * commit — children first, since React runs effects bottom-up, so the child
     * holders are already in the slot by then.
     */
    private buildEntryComponent(): ComponentType<ReactBlockRenderProps<Data, Config>> {
      const onMounted = spec.onMounted;
      const onCreated = spec.onCreated;

      if (onMounted === undefined && onCreated === undefined) {
        return entryComponent;
      }

      const Entry = entryComponent;
      const fire = (): void => {
        // Once per block instance: React StrictMode double-invokes mount
        // effects, and a second "the author just created me" signal would seed
        // a container's default children twice.
        if (this.mountSignalled) {
          return;
        }

        this.mountSignalled = true;

        const context = { origin: this.origin, api: this.api };

        onMounted?.(this.blockApi, context);

        // Creation-only, and after onMounted: a seeding hook must see whatever
        // the mount hook already put in place.
        if (CREATION_ORIGINS.has(this.origin)) {
          onCreated?.(this.blockApi, context);
        }
      };

      const MountGate = (props: ReactBlockRenderProps<Data, Config>): ReactElement => {
        useEffect(fire, []);

        return <Entry {...props} />;
      };

      MountGate.displayName = `BlokBlockMount(${spec.type})`;

      return MountGate;
    }

    public render(): HTMLElement {
      const host = document.createElement('div');

      // The Blok-owned host: React reconciles the chrome portaled INTO it, but
      // this attribute makes core's MutationObserver ignore those mutations, so
      // React's reconciliation never registers as a user edit.
      host.setAttribute('data-blok-mutation-free', 'true');
      this.hostEl = host;

      this.registry?.register(this.blockApi.id, {
        hostEl: host,
        component: this.entryComponent as unknown as ComponentType<Record<string, unknown>>,
        props: this.buildProps(),
        toolName: this.toolName,
      });

      // Returned synchronously; React flushes the portal on its next commit.
      return host;
    }

    public rendered(): void {
      spec.onRendered?.(this.blockApi);
    }

    public save(): BlockToolData {
      // The complete, frozen mirror — never the DOM, never partial.
      return this.mirror;
    }

    public async setData(newData: BlockToolData): Promise<boolean> {
      const next = fillDefaults<Data>(spec.propSchema, newData ?? {});

      // Dedup: identical data → skip the render entirely, but still return true
      // so core keeps the block in place (no remount).
      if (deepEqual(next, this.lastRendered)) {
        return true;
      }

      this.mirror = next;
      this.lastRendered = next;

      // Flush React's commit before resolving. Core drives setData inside its
      // RAF-extended Yjs-suppression window, so the re-render must land before
      // suppression lifts — without ever remounting.
      this.pushProps({ data: next });

      return true;
    }

    /**
     * In-place read-only toggle. Pushes a new `readOnly` prop the component
     * reads, so the block re-renders read-only WITHOUT a remount (ephemeral
     * component state survives). A regular prototype method (not an arrow
     * field) so core's `supportsInPlaceReadOnly` — which probes the
     * constructable's PROTOTYPE for `setReadOnly` — selects the in-place path.
     */
    public setReadOnly(state: boolean): void {
      this.readOnly = state;
      this.pushProps({ readOnly: state });
    }

    /**
     * Core's toolbar-anchor hook. Always defined so the delegation is one
     * `typeof … === 'function'` probe away, and always resolved fresh against
     * the LIVE host — the anchor element is React-rendered, so it does not exist
     * yet when the tool is constructed and may be replaced on any re-render. A
     * spec without a resolver returns undefined, which is exactly what core's
     * default positioning already assumes.
     */
    public getToolbarAnchorElement(): HTMLElement | undefined {
      /**
       * A ref the component attached wins — it names the exact element, chosen
       * from inside the tree. `isConnected` is the guard that matters: React
       * nulls the ref on unmount, but a component that re-parents its anchor can
       * leave a detached node here, and positioning the toolbar against one
       * silently parks it at 0,0.
       */
      const fromRef = this.anchorEl;

      if (fromRef !== null && fromRef.isConnected) {
        return fromRef;
      }

      const host = this.hostEl;

      if (host === null || spec.getToolbarAnchorElement === undefined) {
        return undefined;
      }

      return spec.getToolbarAnchorElement(host, this.blockApi) ?? undefined;
    }

    public moved(): void {
      // No remount: Blok relocates the host element; the portal follows it.
      spec.onMoved?.(this.blockApi);
    }

    public removed(): void {
      // Ownership-scoped: core composes a REPLACEMENT block (which registers
      // under the SAME id) before it tears this one down, so an unqualified
      // unregister here would delete the live entry and blank the block.
      this.registry?.unregister(this.blockApi.id, this.hostEl ?? undefined);
      spec.onRemoved?.(this.blockApi);
    }

    public destroy(): void {
      // Idempotent with removed(); unregister is safe when already absent.
      this.registry?.unregister(this.blockApi.id, this.hostEl ?? undefined);
    }

    /** The full entry props handed to the component on (re-)register. */
    private buildProps(): Record<string, unknown> {
      const props: ReactBlockRenderProps<Data, Config> = {
        data: this.mirror,
        commit: this.commit,
        block: this.blockApi,
        api: this.api,
        readOnly: this.readOnly,
        config: this.toolConfig,
        BlockChildren: this.childrenComponent,
        toolbarAnchorRef: this.toolbarAnchorRef,
      };

      return props as unknown as Record<string, unknown>;
    }

    /** Push a prop patch to the mounted component and flush React's commit. */
    private pushProps(props: Record<string, unknown>): void {
      const registry = this.registry;

      if (registry === undefined) {
        return;
      }

      // setData/setReadOnly arrive from core outside React's render phase, so a
      // synchronous flush is safe and makes the DOM update deterministic.
      flushSync(() => {
        registry.setProps(this.blockApi.id, props);
      });
    }

    /**
     * The only data write path. Merges the patch into the frozen mirror, pushes
     * the new snapshot, records the dedup baseline, and fires dispatchChange
     * EXACTLY once — deferring it while a pointer drag is active (core would
     * otherwise silently drop it).
     */
    private readonly commit = (patch: Partial<Data>): void => {
      const next = fillDefaults<Data>(spec.propSchema, {
        ...(this.mirror as Record<string, unknown>),
        ...(patch as Record<string, unknown>),
      });

      // Idempotent: a patch that changes nothing is a full no-op — no props
      // push, no dispatchChange. This is what makes an effect that echoes the
      // current value back through commit safe without a consumer-side guard
      // (an unguarded echo would otherwise loop commit → render → effect).
      if (deepEqual(next, this.mirror)) {
        return;
      }

      this.mirror = next;
      this.lastRendered = next;
      // No flushSync here: commit is called from React event handlers (inside a
      // render batch), where a sync flush is illegal — the normal async commit
      // is fine because the change originates from the component itself.
      this.registry?.setProps(this.blockApi.id, { data: next });

      this.flushDispatch();
    };

    /** Dispatch the change, or retry on the next frame if a drag is in progress. */
    private flushDispatch(): void {
      if (!this.pointerDrag()) {
        this.pendingDispatch = false;
        this.blockApi.dispatchChange();

        return;
      }

      if (this.pendingDispatch) {
        return;
      }

      this.pendingDispatch = true;

      const retry = (): void => {
        if (this.pointerDrag()) {
          requestAnimationFrame(retry);

          return;
        }

        this.pendingDispatch = false;
        this.blockApi.dispatchChange();
      };

      requestAnimationFrame(retry);
    }
  };

  // Forward the authored statics onto the generated class. `defineProperty`
  // (not assignment) because `toolbox`/`isReadOnlySupported` are accessors on
  // the prototype chain and a plain write would throw in strict mode; the
  // reserved list keeps a stray bag from taking those — or the adapter's own
  // markers — over.
  for (const [key, value] of Object.entries(spec.statics ?? {})) {
    if (RESERVED_STATICS.includes(key)) {
      continue;
    }

    Object.defineProperty(ReactBlockTool, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  return ReactBlockTool;
}
