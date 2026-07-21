import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  NgZone,
  Output,
  ViewChild,
  computed,
  effect,
  forwardRef,
  inject,
  signal,
  type AfterViewInit,
} from '@angular/core';
import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from '@angular/forms';
import { BlokContentDirective } from './blok-content.directive';
import { BLOK_DEFAULT_CONFIG } from './provide-blok';
import { deepEqual } from '@bloklabs/core/adapters';
import { normalizeReadOnlyConfig } from '@bloklabs/core/adapters';
import type {
  API,
  Blok,
  BlockMutationEvent,
  BlockRenderedPayload,
  BlocksRenderedPayload,
  BlokConfig,
  EditorWidth,
  LooseOutputData,
  OutputBlockData,
  OutputData,
  ResolvedTheme,
  ThemeMode,
} from '@bloklabs/core';
import type { BlokAngularConfig } from './types';

/**
 * The blessed all-in-one Angular component for embedding Blok (mirrors React's
 * `BlokEditor`). Delegates instance lifecycle to an internal `BlokContentDirective`
 * and layers the typed reactive input/output API on top.
 *
 * Reactive inputs (`readOnly`, `theme`, `width`, `placeholder`, `autofocus`,
 * `styleTokens`, `data`) are synced in place after mount via effects —
 * `styleTokens` through `editor.tokens.set()` (replace semantics) and `data`
 * through `editor.render()` (deep-equal–deduped); everything else seeds
 * construction.
 *
 * Implementation note: classic `@Input()`/`@ViewChild()` decorators are used
 * (not signal `input()`/`viewChild()`) for JIT compatibility — see
 * `BlokContentDirective`. Each reactive input is backed by an internal `signal`
 * so effect-based syncing still works; the public template API is unchanged.
 */
@Component({
  selector: 'blok-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  exportAs: 'blok',
  imports: [BlokContentDirective],
  template: `<div blokContent [config]="buildConfig()" [recreateKey]="recreateKey"></div>`,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => BlokEditorComponent),
      multi: true,
    },
  ],
})
export class BlokEditorComponent implements AfterViewInit, ControlValueAccessor {
  private readonly ngZone = inject(NgZone);
  /** App-wide defaults from `provideBlok()`; merged UNDER per-instance inputs. */
  private readonly defaults = inject(BLOK_DEFAULT_CONFIG, { optional: true }) ?? {};

  @ViewChild(BlokContentDirective) private contentQuery?: BlokContentDirective;
  /** Signal bridge for the @ViewChild directive so effects react to its arrival. */
  private readonly content = signal<BlokContentDirective | null>(null);

  /**
   * Output half of two-way `[(data)]`. Emits the editor's serialized content on
   * every change. Wiring the core `onSave` callback is gated on this being
   * observed, since its mere presence makes the core serialize on every batch.
   */
  /** Emits the live Blok instance once ready, after `instance()` is populated. */
  @Output() readonly ready = new EventEmitter<Blok>();

  @Output() readonly dataChange = new EventEmitter<OutputData>();

  /** Fires with the full serialized content on every change (notification half). */
  @Output() readonly save = new EventEmitter<OutputData>();

  /** Raw block mutation channel (core `onChange`). */
  @Output() readonly change = new EventEmitter<{
    api: API;
    event: BlockMutationEvent | BlockMutationEvent[];
  }>();

  /** Fires after the editor finishes (re-)rendering (core `onAfterRender`). */
  @Output() readonly afterRender = new EventEmitter<API>();

  /** Fires with the resolved theme whenever it changes (core `onThemeChange`). */
  @Output() readonly themeChange = new EventEmitter<ResolvedTheme>();

  /** Fires after a batch render completes (core `blocks:rendered` event). */
  @Output() readonly blocksRendered = new EventEmitter<BlocksRenderedPayload>();

  /** Fires for each block rendered into the DOM (core `block:rendered` event). */
  @Output() readonly blockRendered = new EventEmitter<BlockRenderedPayload>();

  /**
   * Transform hook applied to blocks before render (core `onBeforeRender`). Must
   * return the (possibly modified) block list. An input, not an output, because
   * it returns a value.
   */
  @Input() onBeforeRender?: (blocks: OutputBlockData[]) => OutputBlockData[];

  /**
   * Transform hook applied to pasted HTML (core `onBeforePaste`). Returns the
   * (possibly modified) html, or null to drop the paste.
   */
  @Input() onBeforePaste?: (html: string) => string | null;

  // ---- Reactive inputs (signal-backed setters; synced in place, never recreate) ----
  // Default undefined (not false) so an unset input falls back to a provideBlok
  // default; the readOnly effect / buildConfig coerce undefined to false.
  private readonly readOnly$ = signal<boolean | undefined>(undefined);
  @Input() set readOnly(value: boolean | undefined) {
    this.readOnly$.set(value);
  }

  private readonly theme$ = signal<ThemeMode | undefined>(undefined);
  @Input() set theme(value: ThemeMode | undefined) {
    this.theme$.set(value);
  }

  private readonly width$ = signal<EditorWidth | undefined>(undefined);
  @Input() set width(value: EditorWidth | undefined) {
    this.width$.set(value);
  }

  private readonly placeholder$ = signal<string | false | undefined>(undefined);
  @Input() set placeholder(value: string | false | undefined) {
    this.placeholder$.set(value);
  }

  /**
   * Theme tokens. Construction-only config forced hosts with a live light/dark
   * toggle to recreate the editor or hand-write the global stylesheet Blok
   * already injects; this drives the runtime `tokens` API instead.
   */
  private readonly styleTokens$ = signal<Record<string, string> | undefined>(undefined);
  @Input() set styleTokens(value: Record<string, string> | undefined) {
    this.styleTokens$.set(value);
  }

  private readonly autofocus$ = signal<boolean | undefined>(false);
  @Input() set autofocus(value: boolean | undefined) {
    this.autofocus$.set(value);
  }

  // ---- Reactive content (seeds construction, then re-renders on change) ----
  private readonly data$ = signal<OutputData | LooseOutputData | undefined>(undefined);
  @Input() set data(value: OutputData | LooseOutputData | undefined) {
    this.data$.set(value);
  }

  // ---- Construction-only seed inputs (read once at construction) ----
  @Input() tools?: BlokConfig['tools'];

  /**
   * Escape hatch: a full config object for keys without a dedicated input
   * (i18n, sanitizer, minHeight, inlineToolbar, …). Layered between provideBlok
   * defaults and the discrete inputs.
   */
  @Input() config?: Partial<BlokAngularConfig>;

  /** Changing this input's identity destroys and recreates the editor (≙ React `deps`). */
  @Input() recreateKey: unknown;

  /**
   * Content the editor currently reflects. Set when seeded or rendered (the data
   * effect below). A controlled `data` echo that deep-equals this baseline is a
   * no-op, so it won't clobber the caret. Renders are serialized via `renderChain`.
   */
  private lastRenderedData?: OutputData | LooseOutputData;

  /** Last token set pushed through `tokens.set`, for deep-equal deduping. */
  private appliedTokens?: Record<string, string>;
  private seededEditor: Blok | null = null;
  private renderChain: Promise<void> = Promise.resolve();

  /** Registered by `ControlValueAccessor.registerOnChange` (Angular forms). */
  private cvaOnChange?: (data: OutputData) => void;
  private cvaOnTouched?: () => void;

  /**
   * Core `onSave` wrapper. Records the editor's own serialized output as the
   * rendered baseline BEFORE notifying Angular, so a controlled consumer echoing
   * it straight back into `data` deep-equals the baseline and is deduped to a
   * no-op (no redundant render, no caret reset). Re-enters the Angular zone since
   * the editor runs outside it.
   */
  private readonly coreOnSave = (data: OutputData): void => {
    this.lastRenderedData = data;
    this.ngZone.run(() => {
      this.dataChange.emit(data);
      this.save.emit(data);
      this.cvaOnChange?.(data);
      this.cvaOnTouched?.();
    });
  };

  /** Live Blok instance, or null until `isReady` resolves / after destroy. */
  readonly instance = computed<Blok | null>(() => this.content()?.instance() ?? null);

  /** Guards `ready` to one emission per editor instance. */
  private lastReadyInstance: Blok | null = null;

  /**
   * Construction config handed to the directive. Seeds the editor's initial
   * values; the directive only reads it once (at construction), so post-mount
   * changes to construction-only inputs are no-ops by design.
   */
  buildConfig(): Partial<BlokAngularConfig> {
    // Precedence: provideBlok defaults < [config] escape hatch < discrete inputs.
    const cfg: Partial<BlokAngularConfig> = { ...this.defaults, ...this.config };

    cfg.readOnly = this.readOnly$() ?? this.config?.readOnly ?? this.defaults.readOnly ?? false;

    // tools registries are MERGED (not replaced) across all three layers so a
    // shared registry composes with per-instance additions.
    if (
      this.tools !== undefined ||
      this.config?.tools !== undefined ||
      this.defaults.tools !== undefined
    ) {
      cfg.tools = { ...this.defaults.tools, ...this.config?.tools, ...this.tools };
    }

    const data = this.data$();

    if (data !== undefined) {
      cfg.data = data;
    }

    const theme = this.theme$();

    if (theme !== undefined) {
      cfg.theme = theme;
    }

    const width = this.width$();

    if (width !== undefined) {
      cfg.width = width;
    }

    const placeholder = this.placeholder$();

    if (placeholder !== undefined) {
      cfg.placeholder = placeholder;
    }

    // Opt-in: only attach each core callback when the consumer actually consumes
    // it (an observed output, a registered forms hook, or a provided transform).
    // Their mere presence makes the core serialize / run hooks on every change.
    if (this.dataChange.observed || this.save.observed || this.cvaOnChange !== undefined) {
      cfg.onSave = this.coreOnSave;
    }

    if (this.change.observed) {
      cfg.onChange = (api: API, event: BlockMutationEvent | BlockMutationEvent[]): void =>
        this.ngZone.run(() => this.change.emit({ api, event }));
    }

    if (this.afterRender.observed) {
      cfg.onAfterRender = (api: API): void => this.ngZone.run(() => this.afterRender.emit(api));
    }

    if (this.themeChange.observed) {
      cfg.onThemeChange = (resolved: ResolvedTheme): void =>
        this.ngZone.run(() => this.themeChange.emit(resolved));
    }

    // Transforms run synchronously inside core's render/paste pipeline and must
    // return a value — never wrap them in ngZone.run.
    const beforeRender = this.onBeforeRender;

    if (beforeRender !== undefined) {
      cfg.onBeforeRender = (blocks: OutputBlockData[]): OutputBlockData[] => beforeRender(blocks);
    }

    const beforePaste = this.onBeforePaste;

    if (beforePaste !== undefined) {
      cfg.onBeforePaste = (html: string): string | null => beforePaste(html);
    }

    return cfg;
  }

  ngAfterViewInit(): void {
    this.content.set(this.contentQuery ?? null);
  }

  // ---- Curated imperative facade (delegates to the live instance; no-ops until ready) ----

  /** Serialize the current content. Resolves undefined until the editor is ready. */
  save$(): Promise<OutputData> | undefined {
    return this.instance()?.save();
  }

  /** Move the caret into the editor. */
  focus(atEnd?: boolean): void {
    this.instance()?.focus(atEnd);
  }

  /** Replace the editor content. Resolves undefined until the editor is ready. */
  render(data: OutputData | LooseOutputData): Promise<void> | undefined {
    return this.instance()?.render(data);
  }

  constructor() {
    // Each effect reads `instance()` so it re-applies once the editor appears
    // (the Angular analog of React's `editor` effect-dependency).
    effect(() => {
      const editor = this.instance();
      const readOnly = this.readOnly$();

      if (editor) {
        void editor.readOnly.set(readOnly ?? normalizeReadOnlyConfig(this.config?.readOnly).enabled);
      }
    });

    effect(() => {
      const editor = this.instance();
      const theme = this.theme$();

      if (editor && theme !== undefined) {
        editor.theme.set(theme);
      }
    });

    effect(() => {
      const editor = this.instance();
      const width = this.width$();

      if (editor && width !== undefined) {
        editor.width.set(width);
      }
    });

    effect(() => {
      const editor = this.instance();
      const placeholder = this.placeholder$();

      if (editor && placeholder !== undefined) {
        editor.placeholder.set(placeholder);
      }
    });

    effect(() => {
      const editor = this.instance();
      const tokens = this.styleTokens$() ?? this.config?.style?.tokens;

      if (!editor || tokens === undefined || deepEqual(tokens, this.appliedTokens)) {
        return;
      }

      this.appliedTokens = { ...tokens };
      editor.tokens.set(tokens);
    });

    effect(() => {
      const editor = this.instance();

      if (editor && this.autofocus$()) {
        editor.focus();
      }
    });

    // Reactive content. `data` seeds the editor at construction; afterwards a new
    // *content* value re-renders via the public render() API (deep-equal-deduped
    // and serialized, so an unchanged reference — including the editor's own
    // echoed output — is a no-op and never clobbers the caret).
    effect(() => {
      const editor = this.instance();
      const data = this.data$();

      if (!editor || data === undefined) {
        return;
      }

      // A freshly created editor was already seeded with `data` at construction;
      // record it without re-rendering.
      if (this.seededEditor !== editor) {
        this.seededEditor = editor;
        this.lastRenderedData = data;

        return;
      }

      if (deepEqual(data, this.lastRenderedData)) {
        return;
      }

      this.lastRenderedData = data;
      this.renderChain = this.renderChain.catch(() => undefined).then(() => editor.render(data));
    });

    // Emit `ready` once per editor, after `instance()` is populated so a consumer
    // reading the component/ref instance inside the handler sees it.
    effect(() => {
      const editor = this.instance();

      if (editor && editor !== this.lastReadyInstance) {
        this.lastReadyInstance = editor;
        this.ready.emit(editor);
      }
    });

    // Subscribe to the editor's rendered-lifecycle events once it exists (gated on
    // the outputs being observed). `onCleanup` unsubscribes when the instance is
    // replaced or the component is destroyed.
    effect((onCleanup) => {
      const editor = this.instance();

      if (!editor) {
        return;
      }

      const handlers: Array<[string, (payload?: unknown) => void]> = [];

      if (this.blocksRendered.observed) {
        const handler = (payload?: unknown): void =>
          this.ngZone.run(() => this.blocksRendered.emit(payload as BlocksRenderedPayload));

        editor.on('blocks:rendered', handler);
        handlers.push(['blocks:rendered', handler]);
      }

      if (this.blockRendered.observed) {
        const handler = (payload?: unknown): void =>
          this.ngZone.run(() => this.blockRendered.emit(payload as BlockRenderedPayload));

        editor.on('block:rendered', handler);
        handlers.push(['block:rendered', handler]);
      }

      onCleanup(() => {
        for (const [name, handler] of handlers) {
          editor.off(name, handler);
        }
      });
    });
  }

  // ---- ControlValueAccessor (optional forms integration) ----

  /** Seeds/renders an externally-set form value through the same dedup machinery. */
  writeValue(value: OutputData | LooseOutputData | null): void {
    this.data$.set(value ?? undefined);
  }

  registerOnChange(fn: (data: OutputData) => void): void {
    this.cvaOnChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.cvaOnTouched = fn;
  }

  /** Form disabled state maps to the editor's read-only mode (via the readOnly effect). */
  setDisabledState(isDisabled: boolean): void {
    this.readOnly$.set(isDisabled);
  }
}
