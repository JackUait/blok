import { createContext, useContext, useMemo, type ComponentType, type ReactElement } from 'react';
import { markSanitizerConfig } from '@bloklabs/core/adapters';
import {
  BLOK_PORTAL_REGISTRY_CONFIG_KEY,
  BLOK_TOOL_NAME_CONFIG_KEY,
  type BlockPortalRegistry,
} from './block-portal-registry';
import type { API, SanitizerConfig } from '@/types';
import type { MarkSnapshot, MarkSpec } from '@/types';
import type { InlineTool, InlineToolConstructorOptions, MenuConfig } from '@/types/tools';

/** Adapter-internal config keys, stripped before the config reaches the component. */
const INTERNAL_CONFIG_KEYS: readonly string[] = [
  BLOK_PORTAL_REGISTRY_CONFIG_KEY,
  BLOK_TOOL_NAME_CONFIG_KEY,
];

/**
 * Unique portal-registry key per tool instance (inline tools have no block id
 * to key on, and multiple instances of the same tool can coexist — e.g. the
 * visible toolbar's instance plus a shortcut render-probe).
 * @param toolName - name the tool is registered under
 */
const generatePortalKey = (toolName: string): string =>
  `__blok-inline-tool__:${toolName}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

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

const InlineToolContext = createContext<InlineToolHandle | null>(null);

/**
 * Reach the enclosing React inline tool from any component inside its
 * portaled UI: live `active` state, the tool `config`, the editor `api`, and
 * the spec's mark operations bound to the live selection.
 */
export function useInlineTool<Config = Record<string, unknown>, State = void>(): InlineToolHandle<Config, State> {
  const handle = useContext(InlineToolContext);

  if (handle === null) {
    throw new Error('useInlineTool() must be called from a component rendered by createReactInlineTool');
  }

  return handle as InlineToolHandle<Config, State>;
}

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
  component: ComponentType<ReactInlineToolRenderProps<Config>>;
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
 * Author a first-party React inline tool. Returns an inline-tool constructable
 * registered exactly like a vanilla tool (`tools: { color: createReactInlineTool(...) }`).
 *
 * Mirrors the `createReactBlock` portal pattern: `render()` returns a
 * `MenuConfig` whose `icon` is a Blok-owned host element
 * (`data-blok-mutation-free`) the component is portaled into via the editor's
 * shared `BlockPortalHost` tree — app-level context (themes, styled-components
 * providers) reaches the icon with no consumer-managed `createRoot`, and
 * `destroy()` (called by the inline toolbar on close/teardown) unregisters the
 * portal so the component unmounts deterministically — no leaked React roots.
 *
 * The editor `api` handed to the constructor is kept: it reaches `surround`/
 * `checkState` as their second argument, powers the `mark` derivation, and is
 * exposed to the portaled component tree via {@link useInlineTool}.
 *
 * Without an injected registry (vanilla core, no `useBlok`), the tool still
 * renders a valid MenuConfig — the host element just stays empty.
 */
export function createReactInlineTool<Config = Record<string, unknown>, State = void>(
  spec: CreateReactInlineToolSpec<Config, State>
): (new (options: InlineToolConstructorOptions) => InlineTool) & {
  readonly __isBlokReactInlineTool: true;
  readonly isInline: true;
  readonly title: string | undefined;
  readonly titleKey: string | undefined;
  readonly shortcut: string | undefined;
  readonly sanitize: SanitizerConfig | undefined;
  readonly isReadOnlySupported: boolean;
} {
  return class ReactInlineTool implements InlineTool {
    /** Marker so `useBlok` can detect react inline tools and inject the registry. */
    public static readonly __isBlokReactInlineTool = true as const;
    public static readonly isInline = true as const;

    public static get title(): string | undefined {
      return spec.title;
    }

    public static get titleKey(): string | undefined {
      return spec.titleKey;
    }

    public static get shortcut(): string | undefined {
      return spec.shortcut;
    }

    public static get sanitize(): SanitizerConfig | undefined {
      if (spec.sanitize !== undefined) {
        return spec.sanitize;
      }

      return spec.mark !== undefined ? markSanitizerConfig(spec.mark) : undefined;
    }

    public static get isReadOnlySupported(): boolean {
      return spec.isReadOnlySupported ?? false;
    }

    private readonly registry: BlockPortalRegistry | undefined;
    /** The editor API — kept (not discarded) so the tool has the same reach as a vanilla one. */
    private readonly api: API | undefined;
    /** Name this tool is registered under in the consumer's `tools` map. */
    private readonly toolName: string;
    /** Unique portal-registry key — inline tools have no block id. */
    private readonly portalKey: string;
    /** The consumer's tool config with adapter-internal keys stripped. */
    private readonly toolConfig: Readonly<Partial<Config>>;
    /**
     * Stable provider component wrapping `spec.component` with the
     * {@link useInlineTool} context. Created once per instance so prop pushes
     * (setProps) re-render without remounting the consumer's component.
     */
    private readonly portalComponent: ComponentType<ReactInlineToolRenderProps<Config>>;
    /** Last active state pushed to the mounted component (change-dedup baseline). */
    private active = false;
    /** True while this instance owns a registered portal entry. */
    private registered = false;

    public constructor(options: InlineToolConstructorOptions) {
      const config: Record<string, unknown> = options?.config ?? {};

      this.api = options?.api;
      this.registry = config[BLOK_PORTAL_REGISTRY_CONFIG_KEY] as BlockPortalRegistry | undefined;

      const toolName = config[BLOK_TOOL_NAME_CONFIG_KEY];

      this.toolName = typeof toolName === 'string' ? toolName : spec.type;
      this.portalKey = generatePortalKey(this.toolName);

      const publicConfig: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(config)) {
        if (!INTERNAL_CONFIG_KEYS.includes(key)) {
          publicConfig[key] = value;
        }
      }
      this.toolConfig = Object.freeze(publicConfig) as Readonly<Partial<Config>>;
      this.portalComponent = this.createPortalComponent();
    }

    public render(): MenuConfig {
      // The Blok-owned host: React reconciles the icon portaled INTO it, and
      // this attribute makes core's MutationObserver ignore those mutations.
      const host = document.createElement('div');

      host.setAttribute('data-blok-mutation-free', 'true');

      if (this.registry !== undefined) {
        this.registry.register(this.portalKey, {
          hostEl: host,
          component: this.portalComponent as unknown as ComponentType<Record<string, unknown>>,
          props: { active: this.active, config: this.toolConfig },
          toolName: this.toolName,
        });
        this.registered = true;
      }

      return {
        name: this.toolName,
        title: spec.title,
        icon: host,
        onActivate: (): void => {
          this.activate();
        },
        isActive: (): boolean => this.refreshActiveState(),
      };
    }

    /**
     * Idempotent teardown, called by the inline toolbar when this instance is
     * dropped (toolbar close, editor destroy, or a throwaway render probe).
     * Unregisters the portal entry so React unmounts the icon component —
     * the unmount signal consumer-managed `createRoot` hacks never had.
     */
    public destroy(): void {
      if (!this.registered) {
        return;
      }

      this.registered = false;
      this.registry?.unregister(this.portalKey);
    }

    /**
     * Run the tool's formatting action: an explicit `surround` on the LIVE
     * selection's range (captured at activation time, matching
     * wrapLegacyInlineTool — never a range snapshotted at render), or the
     * mark derivation (`api.marks.toggle`) when only a `mark` is declared.
     */
    private activate(): void {
      if (typeof spec.surround === 'function') {
        const selection = window.getSelection();

        if (!selection || selection.rangeCount === 0) {
          return;
        }

        spec.surround(selection.getRangeAt(0), this.api);

        return;
      }

      if (spec.mark !== undefined && this.api?.marks !== undefined) {
        this.api.marks.toggle(spec.mark);
      }
    }

    /**
     * Recompute the active state from the live selection and push it to the
     * mounted component ONLY when it actually changed (no redundant
     * external-store notifications).
     */
    private refreshActiveState(): boolean {
      const active = this.computeActiveState();

      if (active !== this.active) {
        this.active = active;

        if (this.registered) {
          this.registry?.setProps(this.portalKey, { active });
        }
      }

      return active;
    }

    /**
     * Explicit `checkState` wins; otherwise the mark derivation answers
     * "does the WHOLE selection carry the mark" via `api.marks.has`.
     */
    private computeActiveState(): boolean {
      if (typeof spec.checkState === 'function') {
        return Boolean(spec.checkState(window.getSelection(), this.api));
      }

      if (spec.mark !== undefined && this.api?.marks !== undefined) {
        return this.api.marks.has(spec.mark);
      }

      return false;
    }

    /**
     * Build the per-instance provider component: the consumer's component
     * rendered inside the {@link useInlineTool} context, so nested
     * swatches/popovers reach the tool without prop-drilling.
     */
    private createPortalComponent(): ComponentType<ReactInlineToolRenderProps<Config>> {
      const api = this.api;
      const mark = spec.mark;
      const Component = spec.component;

      const markOps: InlineToolMarkOps<State> | null = mark !== undefined && api?.marks !== undefined
        ? {
            has: (): boolean => api.marks.has(mark),
            toggle: (state?: State): boolean => api.marks.toggle(mark, state),
            apply: (state?: State): HTMLElement[] => api.marks.apply(mark, state),
            remove: (): HTMLElement[] => api.marks.remove(mark),
            read: (): MarkSnapshot | null => api.marks.read(mark),
          }
        : null;

      const PortalComponent = (props: ReactInlineToolRenderProps<Config>): ReactElement => {
        const handle = useMemo<InlineToolHandle>(
          () => ({
            active: props.active,
            config: props.config,
            api,
            mark: markOps as InlineToolMarkOps | null,
          }),
          [props.active, props.config]
        );

        return (
          <InlineToolContext.Provider value={handle}>
            <Component active={props.active} config={props.config} />
          </InlineToolContext.Provider>
        );
      };

      PortalComponent.displayName = `BlokInlineTool(${this.toolName})`;

      return PortalComponent;
    }
  };
}
