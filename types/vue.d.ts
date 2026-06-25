import type { DefineComponent, InjectionKey, MaybeRefOrGetter, Ref } from 'vue';
import type {
  API,
  Blok,
  BlockMutationEvent,
  BlokConfig,
  EditorWidth,
  OutputData,
  ResolvedTheme,
} from './index';

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
