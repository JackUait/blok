import {
  Directive,
  ElementRef,
  EventEmitter,
  NgZone,
  Output,
  PLATFORM_ID,
  Input,
  ApplicationRef,
  EnvironmentInjector,
  ErrorHandler,
  afterNextRender,
  inject,
  signal,
  type OnDestroy,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
// Imported via the package's public specifier so ng-packagr externalizes the
// core as a peer dependency (consumers share a single Blok instance + CSS).
import { Blok as BlokRuntime, type Blok } from '@jackuait/blok';
import { BLOK_DEFAULT_CONFIG } from './provide-blok';
import type { BlokAngularConfig } from './types';
import {
  BLOK_PORTAL_REGISTRY_CONFIG_KEY,
  createBlockPortalRegistry,
  type BlockPortalRegistry,
} from './block-portal-registry';
import { removeRegistry, setRegistry } from './registry-map';

/**
 * Escape-hatch directive and lifecycle engine for Blok (mirrors React's
 * `useBlok` + `BlokContent`). Constructs a Blok instance into its own host
 * element and tears it down on destroy.
 *
 * The editor renders directly into the directive's host element — so the host
 * IS the holder. This sidesteps the fact that Blok core exposes no public
 * `holder` accessor: the adapter never has to read it back, it owns it.
 *
 * `BlokEditorComponent` applies this directive to its internal `<div>` and reads
 * the instance back; consumers can also use it directly for full control:
 * `<div blokContent [config]="cfg" (ready)="onReady($event)"></div>`.
 *
 * Implementation note: classic `@Input()`/`@Output()` are used (not signal
 * `input()`/`output()`) because the repo's Vitest+Analog harness compiles the
 * adapter via JIT, which does not register signal-based members. `instance`
 * remains a plain `signal` (runtime API, JIT-safe) for reactive consumption.
 */
@Directive({
  selector: '[blokContent]',
  standalone: true,
})
export class BlokContentDirective implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly ngZone = inject(NgZone);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  /**
   * App-wide defaults from `provideBlok()`, merged UNDER the bound `[config]` so
   * the escape-hatch path honors them just like `<blok-editor>` (which also
   * merges, idempotently). Mirrors React's `useBlok` merging context defaults.
   */
  private readonly defaults = inject(BLOK_DEFAULT_CONFIG, { optional: true }) ?? {};
  // Captured in the injection context (field initializers) so the registry can
  // mount author components via createComponent — core constructs tools outside
  // Angular DI and cannot inject these itself.
  private readonly envInjector = inject(EnvironmentInjector);
  private readonly appRef = inject(ApplicationRef);
  private readonly errorHandler = inject(ErrorHandler);

  /** Construction-time Blok config (everything except `holder`, which the directive owns). */
  @Input() config: Partial<BlokAngularConfig> = {};

  /** Changing this input's identity (after the first build) destroys + recreates the editor. */
  @Input() set recreateKey(value: unknown) {
    const changed = this.built && value !== this.currentKey;
    this.currentKey = value;

    if (changed) {
      this.current?.destroy();
      this.build();
    }
  }

  /** Emits the live Blok instance once it is ready, after `instance` is populated. */
  @Output() readonly ready = new EventEmitter<Blok>();

  /** The live Blok instance, or null before `isReady` resolves / after destroy. */
  readonly instance = signal<Blok | null>(null);

  /** The editor created by the most recent construction; used as the staleness key. */
  private current: Blok | null = null;
  private destroyed = false;
  private built = false;
  private currentKey: unknown;
  /** The portal registry for the current editor (Angular-block mounting). */
  private registry: BlockPortalRegistry | undefined;

  constructor() {
    // afterNextRender is browser-only (skipped during SSR) and runs after the
    // host element exists and inputs are bound.
    afterNextRender(() => {
      // afterNextRender is browser-only by contract, but guard explicitly so the
      // editor is never constructed during SSR / on a non-browser platform.
      if (this.destroyed || !this.isBrowser) {
        return;
      }

      this.build();
      this.built = true;
    });
  }

  /** Construct a Blok into the host element and publish it once ready. */
  private build(): void {
    this.destroyed = false;
    this.instance.set(null);

    // Tear down any registry from a superseded editor (recreate path) before
    // building a new one.
    this.registry?.destroyAll();

    // Merge provideBlok defaults under the bound config (instance wins; tools
    // registries compose across both layers rather than replacing).
    const merged: Partial<BlokAngularConfig> = { ...this.defaults, ...this.config };

    if (this.defaults.tools !== undefined || this.config.tools !== undefined) {
      merged.tools = { ...this.defaults.tools, ...this.config.tools };
    }

    // Create the editor-scoped portal registry and thread it into every
    // Angular-block tool's config (vanilla tools pass through untouched).
    const registry = createBlockPortalRegistry(this.envInjector, this.appRef, this.errorHandler);

    this.registry = registry;
    merged.tools = injectPortalRegistry(merged.tools, registry);

    // Construct outside Angular's zone so the editor's internal DOM churn never
    // schedules change detection.
    const blok = this.ngZone.runOutsideAngular(
      () =>
        new BlokRuntime({
          ...merged,
          holder: this.host.nativeElement,
        }) as unknown as Blok
    );

    this.current = blok;
    setRegistry(blok, registry);

    void blok.isReady.then(() =>
      this.ngZone.run(() => {
        // Guard on the constructor-returned reference (not isReady's resolved
        // value): a superseded or torn-down editor must not publish itself.
        if (this.current !== blok || this.destroyed) {
          return;
        }

        this.instance.set(blok); // assign FIRST…
        this.ready.emit(blok); // …THEN emit, so consumers see a populated instance.
      })
    );
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.registry?.destroyAll();

    if (this.current !== null) {
      removeRegistry(this.current);
    }

    this.current?.destroy();
    this.current = null;
    this.registry = undefined;
    this.instance.set(null);
  }
}

/**
 * Return a NEW tools map (never mutate the consumer's config) where each
 * Angular-block tool carries the portal registry under
 * BLOK_PORTAL_REGISTRY_CONFIG_KEY in its `config`. Vanilla tools are returned
 * unchanged. Handles both entry shapes: a bare constructor and `{ class, config }`.
 */
function injectPortalRegistry(
  tools: BlokAngularConfig['tools'],
  registry: BlockPortalRegistry
): BlokAngularConfig['tools'] {
  if (tools === undefined) {
    return tools;
  }

  const result: Record<string, unknown> = {};

  for (const [name, entry] of Object.entries(tools)) {
    const asObject = entry as { class?: unknown; config?: Record<string, unknown> } | undefined;
    const toolClass = (typeof entry === 'function' ? entry : asObject?.class) as
      | { __isBlokAngularBlock?: boolean }
      | undefined;

    if (toolClass?.__isBlokAngularBlock === true) {
      const base = typeof entry === 'function' ? { class: entry } : { ...asObject };

      result[name] = {
        ...base,
        config: { ...(base.config ?? {}), [BLOK_PORTAL_REGISTRY_CONFIG_KEY]: registry },
      };
    } else {
      result[name] = entry;
    }
  }

  return result as BlokAngularConfig['tools'];
}
