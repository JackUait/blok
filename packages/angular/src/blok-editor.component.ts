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
  type DoCheck,
} from '@angular/core';
import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from '@angular/forms';
import { BlokContentDirective } from './blok-content.directive';
import { BLOK_DEFAULT_CONFIG } from './provide-blok';
import { deepEqual } from '@bloklabs/core/adapters';
import { equalsOutputData } from '@bloklabs/core/adapters';
import { normalizeReadOnlyConfig } from '@bloklabs/core/adapters';
import { toRenderableData } from '@bloklabs/core/adapters';
import type {
  API,
  Blok,
  BlockMutationEvent,
  BlockRenderedPayload,
  BlocksRenderedPayload,
  BlokConfig,
  EditorWidth,
  LiveHandlers,
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
 * Reactive inputs (`readOnly`, `hideToolbar`, `toolbarPosition`,
 * `inlineToolbar`, `theme`, `width`, `placeholder`, `autofocus`, `styleTokens`,
 * `i18n`, `data`) are synced in place after mount via effects — `hideToolbar`
 * through `editor.toolbar.setHidden()`, `toolbarPosition` through
 * `editor.toolbar.setPosition()`, `inlineToolbar` through
 * `editor.tools.setInlineToolbar()` (content-compared),
 * `styleTokens` through `editor.tokens.set()` (replace semantics),
 * `i18n` through `editor.i18n.update()` (deep-equal–deduped; seeded at
 * construction so the locale resolves during boot) and `data`
 * through `editor.render()` (content-deduped via `equalsOutputData`); everything
 * else seeds construction.
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
export class BlokEditorComponent implements AfterViewInit, DoCheck, ControlValueAccessor {
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

  /**
   * Error channel (core `onError`). Fires with the raised error whenever an
   * editor operation — currently serialization — fails instead of only logging.
   */
  @Input() onError?: BlokConfig['onError'];

  // ---- Reactive inputs (signal-backed setters; synced in place, never recreate) ----
  // Default undefined (not false) so an unset input falls back to a provideBlok
  // default; the readOnly effect / buildConfig coerce undefined to false.
  // Accepts the object form (`{ hideControls }`) too — it flows through
  // buildConfig unchanged and the effect expands it to
  // `readOnly.set(enabled, { hideControls })`.
  private readonly readOnly$ = signal<BlokConfig['readOnly'] | undefined>(undefined);
  @Input() set readOnly(value: BlokConfig['readOnly'] | undefined) {
    this.readOnly$.set(value);
  }

  private readonly hideToolbar$ = signal<boolean | undefined>(undefined);
  @Input() set hideToolbar(value: boolean | undefined) {
    this.hideToolbar$.set(value);
  }

  private readonly toolbarPosition$ = signal<BlokConfig['toolbarPosition'] | undefined>(undefined);
  @Input() set toolbarPosition(value: BlokConfig['toolbarPosition'] | undefined) {
    this.toolbarPosition$.set(value);
  }

  private readonly inlineToolbar$ = signal<boolean | string[] | undefined>(undefined);
  @Input() set inlineToolbar(value: boolean | string[] | undefined) {
    this.inlineToolbar$.set(value);
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

  /**
   * Locale, host message overrides and text direction. `config.i18n` was
   * consumed once at boot, so a host driving a language switcher had to
   * recreate the editor (losing caret, focus and undo stack) to relabel the
   * UI; this drives the runtime `i18n.update` API instead. `defaultLocale` is
   * not forwarded — it only affects the INITIAL locale resolution.
   */
  private readonly i18n$ = signal<BlokConfig['i18n'] | undefined>(undefined);
  @Input() set i18n(value: BlokConfig['i18n'] | undefined) {
    this.i18n$.set(value);
  }

  private readonly autofocus$ = signal<boolean | undefined>(false);
  @Input() set autofocus(value: boolean | undefined) {
    this.autofocus$.set(value);
  }

  // ---- Reactive content (seeds construction, then re-renders on change) ----
  private readonly data$ = signal<OutputData | LooseOutputData | null | undefined>(undefined);
  @Input() set data(value: OutputData | LooseOutputData | null | undefined) {
    this.data$.set(value);
  }

  // ---- Construction-only seed inputs (read once at construction) ----
  @Input() tools?: BlokConfig['tools'];
  /** Host-supplied per-type block migrations applied at load (merged across layers). */
  @Input() migrations?: BlokConfig['migrations'];

  /**
   * Escape hatch: a full config object for keys without a dedicated input
   * (sanitizer, minHeight, …). Layered between provideBlok
   * defaults and the discrete inputs.
   */
  @Input() config?: Partial<BlokAngularConfig>;

  /** Changing this input's identity destroys and recreates the editor (≙ React `deps`). */
  @Input() recreateKey: unknown;

  /**
   * Content the editor currently reflects. Set when seeded, when the data effect
   * renders, when the editor emits its own output (`coreOnSave`) and when the
   * imperative `render()` facade lands. A controlled `data` echo that
   * content-equals this baseline is a no-op, so it won't clobber the caret.
   * Renders are serialized via `renderChain`. `undefined` means "nothing recorded
   * yet" — never an empty document.
   */
  private lastRenderedData?: OutputData | LooseOutputData | null;

  /** Last token set pushed through `tokens.set`, for deep-equal deduping. */
  private appliedTokens?: Record<string, string>;
  /** Last i18n config pushed through `i18n.update`, for deep-equal deduping. */
  private appliedI18n?: BlokConfig['i18n'];
  /** Editor instance the i18n baseline above belongs to. */
  private i18nAppliedFor: Blok | null = null;
  /** Last value pushed through `tools.setInlineToolbar`, for content-compare deduping. */
  private appliedInlineToolbar?: boolean | string[];
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
   *
   * Falls back to an escape-hatch `[config]` callback when nothing Angular-side
   * consumes the save — the baseline is recorded either way, so the controlled
   * `data` dedupe works on both paths.
   */
  private readonly coreOnSave = (data: OutputData, api: API): void => {
    this.lastRenderedData = data;

    if (this.hasSaveConsumer()) {
      this.ngZone.run(() => {
        this.dataChange.emit(data);
        this.save.emit(data);
        this.cvaOnChange?.(data);
        this.cvaOnTouched?.();
      });

      return;
    }

    this.escapeHatchConfig().onSave?.(data, api);
  };

  /**
   * Stable wrappers for the remaining live callbacks. Each resolves its target
   * at call time (an observed output, else the `[config]` escape hatch), so a
   * pushed handler never goes stale and only PRESENCE has to be synced.
   */
  private readonly coreOnChange = (
    api: API,
    event: BlockMutationEvent | BlockMutationEvent[]
  ): void => {
    if (this.change.observed) {
      this.ngZone.run(() => this.change.emit({ api, event }));

      return;
    }

    this.escapeHatchConfig().onChange?.(api, event);
  };

  private readonly coreOnAfterRender = (api: API): void => {
    if (this.afterRender.observed) {
      this.ngZone.run(() => this.afterRender.emit(api));

      return;
    }

    this.escapeHatchConfig().onAfterRender?.(api);
  };

  /*
   * Transforms run synchronously inside core's render pipeline and must return a
   * value — never wrap them in ngZone.run.
   */
  private readonly coreOnBeforeRender = (blocks: OutputBlockData[]): OutputBlockData[] => {
    const transform = this.onBeforeRender ?? this.escapeHatchConfig().onBeforeRender;

    return transform?.(blocks) ?? blocks;
  };

  private readonly coreOnEnter = (event: KeyboardEvent, api: API): boolean | void =>
    this.escapeHatchConfig().onEnter?.(event, api);

  private readonly coreOnSubmit = (data: OutputData, api: API): void => {
    this.escapeHatchConfig().onSubmit?.(data, api);
  };

  /** provideBlok defaults merged under the `[config]` escape hatch. */
  private escapeHatchConfig(): Partial<BlokAngularConfig> {
    return { ...this.defaults, ...this.config };
  }

  /** True when an output, a two-way binding or Angular forms consumes `onSave`. */
  private hasSaveConsumer(): boolean {
    return this.dataChange.observed || this.save.observed || this.cvaOnChange !== undefined;
  }

  /**
   * The live callbacks this component currently wires into core, keyed by
   * handler name — `undefined` for the ones nothing consumes.
   *
   * PRESENCE is the semantics in core (an `onSubmit` turns Enter into
   * serialize-and-submit, an `onSave` arms the change-observation pipeline), so
   * an unconsumed callback must stay absent. One source of truth for both the
   * construction config and the runtime sync in `ngDoCheck`, so the two cannot
   * drift.
   * @returns the wrappers to install, `undefined` where nothing is wired
   */
  private liveHandlers(): LiveHandlers {
    const cfg = this.escapeHatchConfig();

    return {
      onChange: this.change.observed || cfg.onChange !== undefined ? this.coreOnChange : undefined,
      onSave: this.hasSaveConsumer() || cfg.onSave !== undefined ? this.coreOnSave : undefined,
      onEnter: cfg.onEnter !== undefined ? this.coreOnEnter : undefined,
      onSubmit: cfg.onSubmit !== undefined ? this.coreOnSubmit : undefined,
      onBeforeRender:
        this.onBeforeRender !== undefined || cfg.onBeforeRender !== undefined
          ? this.coreOnBeforeRender
          : undefined,
      onAfterRender:
        this.afterRender.observed || cfg.onAfterRender !== undefined
          ? this.coreOnAfterRender
          : undefined,
    };
  }

  /** Handler presence installed on the live editor (the sync dedupe baseline). */
  private appliedHandlers: LiveHandlers = {};

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

    // The object form ({ hideControls }) is preserved as-is; the readOnly
    // effect expands it into `readOnly.set(enabled, { hideControls })`.
    cfg.readOnly = this.readOnly$() ?? this.config?.readOnly ?? this.defaults.readOnly ?? false;

    const hideToolbar = this.hideToolbar$();

    if (hideToolbar !== undefined) {
      cfg.hideToolbar = hideToolbar;
    }

    const toolbarPosition = this.toolbarPosition$();

    if (toolbarPosition !== undefined) {
      cfg.toolbarPosition = toolbarPosition;
    }

    const inlineToolbar = this.inlineToolbar$();

    if (inlineToolbar !== undefined) {
      cfg.inlineToolbar = inlineToolbar;
    }

    // tools registries are MERGED (not replaced) across all three layers so a
    // shared registry composes with per-instance additions.
    if (
      this.tools !== undefined ||
      this.config?.tools !== undefined ||
      this.defaults.tools !== undefined
    ) {
      cfg.tools = { ...this.defaults.tools, ...this.config?.tools, ...this.tools };
    }

    // migration registries merge like tools: shared defaults compose with
    // per-instance rules.
    if (
      this.migrations !== undefined ||
      this.config?.migrations !== undefined ||
      this.defaults.migrations !== undefined
    ) {
      cfg.migrations = { ...this.defaults.migrations, ...this.config?.migrations, ...this.migrations };
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

    // Seeded at construction (not applied by the i18n effect) so the locale is
    // resolved during boot instead of flashing the default language first.
    const i18n = this.i18n$();

    if (i18n !== undefined) {
      cfg.i18n = i18n;
    }

    // Opt-in: only attach each live callback when the consumer actually consumes
    // it (an observed output, a registered forms hook, a provided transform or an
    // escape-hatch config callback). Their mere presence makes the core serialize
    // / run hooks on every change. The same map drives the runtime sync in
    // `ngDoCheck`, so construction and post-mount can never disagree.
    const handlers = this.liveHandlers();

    cfg.onChange = handlers.onChange;
    cfg.onSave = handlers.onSave;
    cfg.onEnter = handlers.onEnter;
    cfg.onSubmit = handlers.onSubmit;
    cfg.onBeforeRender = handlers.onBeforeRender;
    cfg.onAfterRender = handlers.onAfterRender;

    this.appliedHandlers = handlers;

    if (this.themeChange.observed) {
      cfg.onThemeChange = (resolved: ResolvedTheme): void =>
        this.ngZone.run(() => this.themeChange.emit(resolved));
    }

    // Transforms run synchronously inside core's paste pipeline and must return a
    // value — never wrap them in ngZone.run.
    const beforePaste = this.onBeforePaste;

    if (beforePaste !== undefined) {
      cfg.onBeforePaste = (html: string): string | null => beforePaste(html);
    }

    const onError = this.onError;

    if (onError !== undefined) {
      cfg.onError = onError;
    }

    return cfg;
  }

  ngAfterViewInit(): void {
    this.content.set(this.contentQuery ?? null);
  }

  /**
   * Reactive callback presence.
   *
   * Callback wiring was decided once, at construction, and in core the presence
   * of a handler IS the semantics: an `onSubmit` makes Enter serialize-and-submit
   * instead of splitting the block, an `onSave` arms the whole change-observation
   * pipeline. A `[config]` swap, an `*ngIf`-gated `(save)` output or a
   * `registerOnChange` from Angular forms arriving after mount therefore needed a
   * `recreateKey` bump — destroying the editor and losing caret and undo history.
   *
   * Diff the wired handlers against what is installed and push genuine flips
   * through the runtime `handlers.set` API, writing `undefined` for a handler
   * that lost its consumer so the change stays reversible. `ngDoCheck` (not an
   * `effect`) because `EventEmitter.observed` and the plain `@Input` transforms
   * are not signals; the comparison is six identity checks against stable
   * wrappers, so an unchanged cycle pushes nothing.
   */
  ngDoCheck(): void {
    const editor = this.instance();

    if (editor === null) {
      return;
    }

    const desired = this.liveHandlers();
    const applied = this.appliedHandlers;
    const diff: LiveHandlers = {};
    const changed: { value: boolean } = { value: false };

    const sync = <K extends keyof LiveHandlers>(key: K, write: (value: LiveHandlers[K]) => void): void => {
      if (desired[key] === applied[key]) {
        return;
      }

      applied[key] = desired[key];
      changed.value = true;
      write(desired[key]);
    };

    sync('onChange', (value) => {
      diff.onChange = value;
    });
    sync('onSave', (value) => {
      diff.onSave = value;
    });
    sync('onEnter', (value) => {
      diff.onEnter = value;
    });
    sync('onSubmit', (value) => {
      diff.onSubmit = value;
    });
    sync('onBeforeRender', (value) => {
      diff.onBeforeRender = value;
    });
    sync('onAfterRender', (value) => {
      diff.onAfterRender = value;
    });

    if (changed.value) {
      editor.handlers.set(diff);
    }
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

  /**
   * Replace the editor content. Resolves undefined until the editor is ready.
   *
   * Safe to mix with a controlled `[data]` input: the rendered document becomes
   * the content baseline once the call lands, so a later `[data]` change back to
   * the previous document still re-renders instead of being deduped against a
   * baseline the editor no longer reflects. Recorded only on the resolved path —
   * a failed render leaves the editor on its previous content.
   * @param data - the document to render
   */
  render(data: OutputData | LooseOutputData): Promise<void> | undefined {
    const editor = this.instance();

    if (editor === null) {
      return undefined;
    }

    return editor.render(data).then(() => {
      this.lastRenderedData = data;
    });
  }

  constructor() {
    // Each effect reads `instance()` so it re-applies once the editor appears
    // (the Angular analog of React's `editor` effect-dependency).
    effect(() => {
      const editor = this.instance();
      const readOnly = this.readOnly$() ?? this.config?.readOnly;

      if (editor) {
        const { enabled, hideControls } = normalizeReadOnlyConfig(readOnly);

        // Only the object form carries options; the boolean form keeps the
        // one-argument call so it never clobbers a config-seeded hideControls.
        if (typeof readOnly === 'object' && readOnly !== null) {
          void editor.readOnly.set(enabled, { hideControls });
        } else {
          void editor.readOnly.set(enabled);
        }
      }
    });

    effect(() => {
      const editor = this.instance();
      const hideToolbar = this.hideToolbar$();

      if (editor && hideToolbar !== undefined) {
        editor.toolbar.setHidden(hideToolbar);
      }
    });

    effect(() => {
      const editor = this.instance();
      const toolbarPosition = this.toolbarPosition$();

      if (editor && toolbarPosition !== undefined) {
        editor.toolbar.setPosition(toolbarPosition);
      }
    });

    // Content-compared (not identity): a new array with the same tool names is
    // a no-op, so template-inline array literals don't thrash the assignment.
    effect(() => {
      const editor = this.instance();
      const inlineToolbar = this.inlineToolbar$();

      if (
        !editor ||
        inlineToolbar === undefined ||
        deepEqual(inlineToolbar, this.appliedInlineToolbar)
      ) {
        return;
      }

      this.appliedInlineToolbar = Array.isArray(inlineToolbar) ? [...inlineToolbar] : inlineToolbar;
      editor.tools.setInlineToolbar(inlineToolbar);
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
      const i18n = this.i18n$() ?? this.config?.i18n;

      if (!editor) {
        return;
      }

      /*
       * A freshly constructed editor already resolved this config during its
       * own boot (buildConfig seeds it), so record the baseline and push
       * nothing — re-applying it here would reload the locale after mount and
       * flash the default language.
       */
      if (this.i18nAppliedFor !== editor) {
        this.i18nAppliedFor = editor;
        this.appliedI18n = i18n === undefined ? undefined : { ...i18n };

        return;
      }

      if (i18n === undefined || deepEqual(i18n, this.appliedI18n)) {
        return;
      }

      this.appliedI18n = { ...i18n };

      const { locale, messages, direction } = i18n;

      void editor.i18n.update({
        ...(locale === undefined ? {} : { locale }),
        ...(messages === undefined ? {} : { messages }),
        ...(direction === undefined ? {} : { direction }),
      });
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

      // Structural comparison (`equalsOutputData`, not a raw deep-equal): a host
      // that persists the editor's own document and hands back a stripped copy —
      // fresh `time`, dropped ids, no `lastEditedAt` stamp — is still echoing
      // content the editor already shows, and re-rendering it would reset the
      // caret for zero visual change. `undefined` means "nothing recorded yet",
      // which is NOT an empty document, so it must never match.
      const baseline = this.lastRenderedData;

      if (baseline !== undefined && equalsOutputData(data, baseline)) {
        return;
      }

      this.lastRenderedData = data;
      // `data` may be null (a controlled "clear to empty"); render() throws on
      // null, so normalize null → { blocks: [] } at the boundary.
      this.renderChain = this.renderChain.catch(() => undefined).then(() => editor.render(toRenderableData(data)));
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
