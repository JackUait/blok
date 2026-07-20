import type { ComponentType } from 'react';
import {
  BLOK_PORTAL_REGISTRY_CONFIG_KEY,
  BLOK_TOOL_NAME_CONFIG_KEY,
  type BlockPortalRegistry,
} from './block-portal-registry';
import type { SanitizerConfig } from '@/types';
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

/** Spec for {@link createReactInlineTool}. */
export interface CreateReactInlineToolSpec<Config = Record<string, unknown>> {
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
  /** Applies/removes the formatting on the LIVE selection's range (captured at activation time). */
  surround?: (range: Range) => void;
  /** Reports whether the formatting is active for the given selection. */
  checkState?: (selection: Selection | null) => boolean;
  /** Keyboard shortcut (e.g. `CMD+SHIFT+C`). */
  shortcut?: string;
  /** Inline sanitizer config declaring the markup this tool produces. */
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
 * Without an injected registry (vanilla core, no `useBlok`), the tool still
 * renders a valid MenuConfig — the host element just stays empty.
 */
export function createReactInlineTool<Config = Record<string, unknown>>(
  spec: CreateReactInlineToolSpec<Config>
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
      return spec.sanitize;
    }

    public static get isReadOnlySupported(): boolean {
      return spec.isReadOnlySupported ?? false;
    }

    private readonly registry: BlockPortalRegistry | undefined;
    /** Name this tool is registered under in the consumer's `tools` map. */
    private readonly toolName: string;
    /** Unique portal-registry key — inline tools have no block id. */
    private readonly portalKey: string;
    /** The consumer's tool config with adapter-internal keys stripped. */
    private readonly toolConfig: Readonly<Partial<Config>>;
    /** Last active state pushed to the mounted component (change-dedup baseline). */
    private active = false;
    /** True while this instance owns a registered portal entry. */
    private registered = false;

    public constructor(options: InlineToolConstructorOptions) {
      const config: Record<string, unknown> = options?.config ?? {};

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
    }

    public render(): MenuConfig {
      // The Blok-owned host: React reconciles the icon portaled INTO it, and
      // this attribute makes core's MutationObserver ignore those mutations.
      const host = document.createElement('div');

      host.setAttribute('data-blok-mutation-free', 'true');

      if (this.registry !== undefined) {
        this.registry.register(this.portalKey, {
          hostEl: host,
          component: spec.component as unknown as ComponentType<Record<string, unknown>>,
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
          if (typeof spec.surround !== 'function') {
            return;
          }

          // Capture the LIVE selection at activation time (matching
          // wrapLegacyInlineTool) — never a range snapshotted at render.
          const selection = window.getSelection();

          if (!selection || selection.rangeCount === 0) {
            return;
          }

          spec.surround(selection.getRangeAt(0));
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
     * Recompute the active state from the live selection and push it to the
     * mounted component ONLY when it actually changed (no redundant
     * external-store notifications).
     */
    private refreshActiveState(): boolean {
      const active = typeof spec.checkState === 'function'
        ? Boolean(spec.checkState(window.getSelection()))
        : false;

      if (active !== this.active) {
        this.active = active;

        if (this.registered) {
          this.registry?.setProps(this.portalKey, { active });
        }
      }

      return active;
    }
  };
}
