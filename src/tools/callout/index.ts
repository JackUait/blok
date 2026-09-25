// src/tools/callout/index.ts

import type {
  API,
  BlockOrigin,
  BlockTool,
  BlockToolConstructorOptions,
  ToolboxConfig,
  ConversionConfig,
  ToolSanitizerConfig,
  PasteConfig,
  HTMLPasteEvent,
} from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';
import { PopoverItemType } from '../../components/utils/popover';
import type { CalloutData, CalloutConfig } from './types';
import { buildCalloutDOM, calloutEmojiButtonLabel, type CalloutDOMRefs } from './dom-builder';
import { saveCallout } from './block-operations';
import { mountChildBlocks, withSlotlessDescendants } from '../nested-blocks';
import { createColorPicker, type ColorPickerHandle } from '../../components/shared/color-picker';
import { colorVarName } from '../../components/shared/color-presets';
import { mapToNearestPresetName } from '../../components/utils/color-mapping';
import { EmojiPicker, prefetchEmojiPickerData } from './emoji-picker';
import { IconCallout, IconEmojiSmile, IconPaintRoller } from '../../components/icons';
import {
  TOOL_NAME,
  COLOR_KEY,
  EDIT_ICON_KEY,
  ADD_EMOJI_KEY,
  DEFAULT_EMOJI,
  EMOJI_JUMP_IN_ANIMATION,
  EMOJI_GHOST_STYLES,
} from './constants';

/**
 * Resolve emoji from legacy callout data fields
 */
function resolveLegacyEmoji(data: Record<string, unknown>): string {
  if (data.isEmojiVisible === false) {
    return '';
  }

  if (typeof data.emoji === 'string' && data.emoji.length > 0) {
    return data.emoji;
  }

  return DEFAULT_EMOJI;
}

/**
 * Map legacy callout variant to backgroundColor preset name.
 * Used when receiving data from older format that has variant instead of backgroundColor.
 */
const VARIANT_TO_BG_PRESET: Record<string, string | null> = {
  general: null,
  note: 'blue',
  important: 'purple',
  warning: 'orange',
  additional: 'yellow',
  recommendation: 'green',
  caution: 'red',
};

/**
 * Origins that mean "the author just made this block" — the only ones allowed to
 * seed the first child paragraph unconditionally. Allow-list so a future origin
 * fails CLOSED. `undefined` means a host hand-built the constructor options
 * (core always supplies one), which is an explicit creation.
 */
const CREATION_ORIGINS: ReadonlySet<BlockOrigin | undefined> = new Set<BlockOrigin | undefined>([
  undefined,
  'user',
  'api',
  'convert',
]);

interface SharedEmojiPicker {
  picker: EmojiPicker;
  locale: string;
  users: Set<CalloutTool>;
  owner: CalloutTool | null;
}

/**
 * One built-in picker per editor, so a second callout reuses the built grid.
 * Keyed on `api.i18n`: ToolsFactory makes one per tool per editor and every
 * callout of that editor gets the same object, while other editors (with
 * their own locale and messages) get their own.
 */
const sharedEmojiPickers = new WeakMap<API['i18n'], SharedEmojiPicker>();

function disposeSharedEmojiPicker(shared: SharedEmojiPicker): void {
  if (shared.picker.isOpen()) {
    shared.picker.close();
  }

  shared.picker.getElement().remove();
}

export class CalloutTool implements BlockTool {
  private readonly api: API;
  private readOnly: boolean;
  private _data: CalloutData;
  private _dom: CalloutDOMRefs | null = null;
  private _colorPicker: ColorPickerHandle | null = null;
  private readonly _customEmojiPicker: ((onSelect: (emoji: string) => void) => void) | undefined;
  private blockId?: string;
  /**
   * Text captured from a source block during conversion (paragraph -> callout).
   * Callout stores its rich content inside child blocks rather than in `data`,
   * so the first-time `rendered()` hook seeds a child paragraph with this
   * text — preserving the original content across the conversion.
   */
  private _pendingChildText: string | null = null;
  /** Removers for the listeners only an editable callout carries. */
  private _editableTeardown: Array<() => void> = [];
  /**
   * True when this instance is a genuine CREATION rather than a
   * re-materialisation of a callout the document already describes. Only a
   * creation may seed its child paragraph.
   */
  private readonly isCreation: boolean;
  /**
   * True when the document itself named this callout's children. Only `load`
   * carries that declaration (the renderer composes the block with the stored
   * `contentIds`), which is what lets a load tell a genuinely bodyless callout
   * apart from one whose children have simply not mounted yet.
   */
  private readonly isDeclaredLoad: boolean;

  constructor({ data, api, readOnly, block, config, origin }: BlockToolConstructorOptions<CalloutData, CalloutConfig>) {
    this.api = api;
    this.readOnly = readOnly;
    this.isCreation = CREATION_ORIGINS.has(origin);
    this.isDeclaredLoad = origin === 'load' && (block?.contentIds?.length ?? 0) === 0;

    const importedText = typeof (data as Record<string, unknown>).__importedText === 'string'
      ? (data as Record<string, unknown>).__importedText as string
      : null;

    if (importedText !== null && importedText.length > 0) {
      this._pendingChildText = importedText;
    }

    this._data = this.normalizeData(data);

    if (block) {
      this.blockId = block.id;
    }
    this._customEmojiPicker = config?.emojiPicker;
  }

  private normalizeData(data: Partial<CalloutData>): CalloutData {
    const legacyData = data as Record<string, unknown>;
    const hasLegacyFields = 'variant' in legacyData || 'isEmojiVisible' in legacyData;

    if (hasLegacyFields) {
      return this.normalizeLegacyData(legacyData);
    }

    return {
      emoji: typeof data.emoji === 'string' ? data.emoji : DEFAULT_EMOJI,
      textColor: typeof data.textColor === 'string' ? data.textColor : null,
      backgroundColor: typeof data.backgroundColor === 'string' ? data.backgroundColor : null,
    };
  }

  private normalizeLegacyData(data: Record<string, unknown>): CalloutData {
    // Map variant to backgroundColor
    const variant = typeof data.variant === 'string' ? data.variant : 'general';
    const backgroundColor = variant in VARIANT_TO_BG_PRESET ? VARIANT_TO_BG_PRESET[variant] : null;

    // Map isEmojiVisible + emoji to emoji string
    const emoji = resolveLegacyEmoji(data);

    return {
      emoji,
      textColor: null,
      backgroundColor: backgroundColor ?? null,
    };
  }

  public render(): HTMLElement {
    if (this._dom) {
      return this._dom.wrapper;
    }

    const dom = buildCalloutDOM({
      emoji: this._data.emoji,
      readOnly: this.readOnly,
      addEmojiLabel: this.api.i18n.t(ADD_EMOJI_KEY),
      editEmojiLabel: this.api.i18n.t(EDIT_ICON_KEY),
    });

    this._dom = dom;
    this.applyColors();

    if (!this.readOnly) {
      this.wireEditableListeners();
    }

    return dom.wrapper;
  }

  /**
   * Attach every listener that only an editable callout needs.
   *
   * Kept out of `render()` because a callout can reach the editable state long
   * after it was drawn: a collaboration session boots read-only whatever the
   * host asked for, so on a reload every callout renders read-only and is
   * switched in place once the document syncs. Wiring these once at render time
   * left the emoji trigger dead for the rest of the session.
   */
  private wireEditableListeners(): void {
    // Already wired — a repeated "you are editable" must not stack handlers.
    if (this._dom === null || this._editableTeardown.length > 0) {
      return;
    }

    const dom = this._dom;

    /**
     * Warm the emoji dataset ahead of the click: fetching that chunk at click
     * time is nearly the whole of a slow first open. It starts once the callout
     * is editable, and landing on the trigger starts it at once.
     *
     * Skipped when a host supplies its own picker — that chunk is never used.
     */
    if (this._customEmojiPicker === undefined) {
      const prefetch = (): void => prefetchEmojiPickerData(this.api.i18n.getLocale());

      this.addEditableListener(dom.emojiButton, 'pointerenter', prefetch);
      this.addEditableListener(dom.emojiButton, 'pointerdown', prefetch);
      this.addEditableListener(dom.emojiButton, 'focus', prefetch);
      this.scheduleIdlePrefetch(prefetch);
    }

    this.addEditableListener(dom.emojiButton, 'click', () => this.openEmojiPicker());
    this.addEditableListener(dom.emojiButton, 'keydown', (e: Event) => {
      const key = (e as KeyboardEvent).key;

      if (key === 'Enter' || key === ' ') {
        e.preventDefault();
        this.openEmojiPicker();
      }
    });
  }

  /** Runs `prefetch` when the page is idle; cancelled with the editable listeners. */
  private scheduleIdlePrefetch(prefetch: () => void): void {
    if (typeof window.requestIdleCallback === 'function') {
      // Idle may never come on a busy main thread; the timeout caps the wait.
      const handle = window.requestIdleCallback(prefetch, { timeout: 2000 });

      this._editableTeardown.push(() => window.cancelIdleCallback(handle));

      return;
    }

    // Safari has no requestIdleCallback.
    const handle = setTimeout(prefetch, 0);

    this._editableTeardown.push(() => clearTimeout(handle));
  }

  /** Registers a listener and remembers how to take it back off. */
  private addEditableListener(
    target: HTMLElement,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions
  ): void {
    target.addEventListener(type, handler, options);
    this._editableTeardown.push(() => target.removeEventListener(type, handler, options));
  }

  private unwireEditableListeners(): void {
    for (const off of this._editableTeardown) {
      off();
    }

    this._editableTeardown = [];
  }

  public rendered(): void {
    if (this.blockId === undefined || this._dom === null) {
      return;
    }

    const children = this.api.blocks.getChildren(this.blockId);

    mountChildBlocks(
      this._dom.childContainer,
      withSlotlessDescendants(children, id => this.api.blocks.getChildren(id))
    );

    // Auto-create initial paragraph child when callout has no children.
    // Only for a genuine creation, or for a stored document that declares none:
    // a re-materialised callout renders as a FRESH instance and its restored
    // children's add events land AFTER this call, so getChildren() is only
    // TRANSIENTLY empty. Seeding then writes a phantom paragraph back into the
    // shared document. Mirrors Column.rendered(). `load` is exempt from that
    // trap only because it brings the document's own contentIds with it — an
    // empty declaration there is authoritative, and a callout keeps its body in
    // children, so skipping the seed would render a panel nothing can type in.
    if (children.length === 0 && (this.isCreation || this.isDeclaredLoad)) {
      this.seedBodyParagraph();
    }
  }

  /** Give a bodyless callout the child paragraph its content lives in. */
  private seedBodyParagraph(): void {
    if (this.blockId === undefined || this._dom === null) {
      return;
    }

    const blockIndex = this.api.blocks.getBlockIndex(this.blockId);

    if (blockIndex === undefined) {
      return;
    }

    // If conversion handed us source text to preserve, seed the first
    // child paragraph with it (single-shot — cleared immediately).
    const seedText = this._pendingChildText;

    this._pendingChildText = null;

    const childData = seedText !== null && seedText.length > 0
      ? { text: seedText }
      : undefined;

    const newBlock = this.api.blocks.insertInsideParent(this.blockId, blockIndex + 1, childData);

    // Manually append the new child's holder — insertInsideParent places it in the
    // flat block list but doesn't know about our childContainer DOM.
    this._dom.childContainer.appendChild(newBlock.holder);

    // A load is the document being read, not authored: moving the caret there
    // would pull focus into whichever callout the page happens to hold.
    if (this.isDeclaredLoad) {
      return;
    }

    this.api.caret.setToBlock(newBlock.id, seedText !== null ? 'end' : 'start');
  }

  public save(): CalloutData {
    return saveCallout({
      emoji: this._data.emoji,
      textColor: this._data.textColor,
      backgroundColor: this._data.backgroundColor,
    });
  }

  public validate(_data: CalloutData): boolean {
    return true;
  }

  public onPaste(event: HTMLPasteEvent): void {
    const content = event.detail.data;
    const style = content.getAttribute('style') ?? '';
    const bgMatch = /background(?:-color)?\s*:\s*([^;]+)/i.exec(style);

    if (bgMatch?.[1]) {
      const presetName = mapToNearestPresetName(bgMatch[1].trim(), 'bg');

      if (presetName) {
        this._data.backgroundColor = presetName;
      }
    }

    this.applyColors();
  }

  public renderSettings(): MenuConfig {
    if (this._colorPicker === null) {
      const picker = createColorPicker({
        i18n: this.api.i18n,
        testIdPrefix: 'callout-color',
        modes: [
          { key: 'color', labelKey: 'tools.marker.textColor', presetField: 'text' },
          { key: 'background-color', labelKey: 'tools.marker.background', presetField: 'bg' },
        ],
        onColorSelect: (color, modeKey) => {
          const presetName = color !== null ? mapToNearestPresetName(color, modeKey === 'color' ? 'text' : 'bg') : null;

          if (modeKey === 'color') {
            this._data.textColor = presetName;
          } else {
            this._data.backgroundColor = presetName;
          }

          picker.setActiveColor(color, modeKey);
          this.applyColors();
        },
      });

      this._colorPicker = picker;
    }

    // Sync active state with current data
    this.syncPickerActiveColors();

    return [
      {
        icon: IconEmojiSmile,
        title: this.api.i18n.t(EDIT_ICON_KEY),
        name: 'callout-edit-icon',
        closeOnActivate: true,
        onActivate: (): void => this.openEmojiPicker(),
      },
      {
        icon: IconPaintRoller,
        title: this.api.i18n.t(COLOR_KEY),
        name: 'callout-color',
        children: {
          items: [
            {
              type: PopoverItemType.Html,
              element: this._colorPicker.element,
            },
          ],
        },
      },
    ];
  }

  public removed(): void {
    // No-op — no subscriptions to clean up
  }

  /**
   * Editor teardown and a repaint (locale or messages change) destroy every
   * block, so the last callout out takes the shared picker with it.
   */
  public destroy(): void {
    const shared = sharedEmojiPickers.get(this.api.i18n);

    if (shared === undefined || !shared.users.delete(this)) {
      return;
    }

    if (shared.users.size === 0) {
      disposeSharedEmojiPicker(shared);
      sharedEmojiPickers.delete(this.api.i18n);

      return;
    }

    if (shared.owner === this) {
      shared.owner = null;

      if (shared.picker.isOpen()) {
        shared.picker.close();
      }
    }
  }

  public setReadOnly(state: boolean): void {
    this.readOnly = state;

    if (this._dom === null) {
      // Not drawn yet — render() reads the state we just stored.
      return;
    }

    this._dom.emojiButton.disabled = state;

    if (state) {
      this.unwireEditableListeners();
    } else {
      this.wireEditableListeners();
    }
  }

  private syncPickerActiveColors(): void {
    if (this._colorPicker === null) {
      return;
    }

    const textName = this._data.textColor;
    const bgName = this._data.backgroundColor;

    // The picker expects hex values; convert from preset name by looking up the light preset
    // The picker's internal `colorsEqual` handles the comparison regardless of theme
    this._colorPicker.setActiveColor(
      textName !== null ? colorVarName(textName, 'text') : null,
      'color'
    );
    this._colorPicker.setActiveColor(
      bgName !== null ? colorVarName(bgName, 'bg') : null,
      'background-color'
    );
  }

  private applyColors(): void {
    if (this._dom === null) {
      return;
    }

    const { textColor, backgroundColor } = this._data;

    if (textColor !== null) {
      this._dom.wrapper.style.color = colorVarName(textColor, 'text');
    } else {
      this._dom.wrapper.style.color = '';
    }

    if (backgroundColor !== null) {
      const bgVar = colorVarName(backgroundColor, 'bg');

      this._dom.wrapper.style.backgroundColor = bgVar;
      this._dom.wrapper.style.border = '';
      this._dom.wrapper.style.setProperty('--blok-search-input-bg', `light-dark(color-mix(in srgb, ${bgVar} 70%, white), color-mix(in srgb, ${bgVar} 85%, white))`);
    } else {
      this._dom.wrapper.style.backgroundColor = '';
      this._dom.wrapper.style.border = '1px solid var(--blok-callout-default-border, #e5e7eb)';
      this._dom.wrapper.style.removeProperty('--blok-search-input-bg');
      this._dom.wrapper.style.removeProperty('--blok-search-input-border');
    }
  }

  private openEmojiPicker(): void {
    if (this._dom === null) {
      return;
    }

    if (this._customEmojiPicker !== undefined) {
      this._customEmojiPicker((emoji: string) => this.setEmoji(emoji));
      return;
    }

    const handlers = {
      onSelect: (native: string): void => this.setEmoji(native),
      onRemove: (): void => this.setEmoji(''),
    };
    const shared = this.acquireEmojiPicker(handlers);
    const element = shared.picker.getElement();

    if (!element.isConnected) {
      document.body.appendChild(element);
    }

    shared.owner = this;
    void shared.picker.open(this._dom.emojiButton, undefined, handlers);
  }

  private acquireEmojiPicker(handlers: { onSelect: (native: string) => void; onRemove: () => void }): SharedEmojiPicker {
    const locale = this.api.i18n.getLocale();
    const existing = sharedEmojiPickers.get(this.api.i18n);

    if (existing !== undefined && existing.locale === locale) {
      existing.users.add(this);

      return existing;
    }

    if (existing !== undefined) {
      disposeSharedEmojiPicker(existing);
    }

    const created: SharedEmojiPicker = {
      picker: new EmojiPicker({ ...handlers, i18n: this.api.i18n, locale }),
      locale,
      users: new Set([this]),
      owner: null,
    };

    sharedEmojiPickers.set(this.api.i18n, created);

    return created;
  }

  private setEmoji(native: string): void {
    const previous = this._data.emoji;

    this._data.emoji = native;

    if (this._dom === null) {
      return;
    }

    if (native !== previous) {
      this.animateEmojiSwap(previous, native);
    }

    this._dom.emojiFace.textContent = native;
    this._dom.emojiButton.setAttribute(
      'aria-label',
      calloutEmojiButtonLabel(
        native,
        this.api.i18n.t(ADD_EMOJI_KEY),
        this.api.i18n.t(EDIT_ICON_KEY)
      )
    );
  }

  /**
   * The newly picked emoji jumps into the seat while the previous one gets
   * knocked off it: a transient ghost of the old emoji tips over and falls,
   * and the face (already holding the newcomer) plays a leap-and-land spring.
   */
  private animateEmojiSwap(previous: string, next: string): void {
    if (this._dom === null || (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false)) {
      return;
    }

    const { emojiButton, emojiFace } = this._dom;

    // A rapid re-pick interrupts the running choreography — clear it first
    emojiButton.querySelector('[data-blok-testid="callout-emoji-ghost"]')?.remove();
    emojiFace.classList.remove(EMOJI_JUMP_IN_ANIMATION);
    void emojiButton.offsetWidth; // reflow so re-adding the class restarts the animation

    if (previous !== '') {
      const ghost = document.createElement('span');

      ghost.className = EMOJI_GHOST_STYLES;
      ghost.textContent = previous;
      ghost.setAttribute('aria-hidden', 'true');
      ghost.setAttribute('data-blok-testid', 'callout-emoji-ghost');
      ghost.addEventListener('animationend', () => ghost.remove(), { once: true });
      ghost.addEventListener('animationcancel', () => ghost.remove(), { once: true });
      emojiButton.appendChild(ghost);
    }

    if (next !== '') {
      emojiFace.classList.add(EMOJI_JUMP_IN_ANIMATION);
      emojiFace.addEventListener(
        'animationend',
        () => emojiFace.classList.remove(EMOJI_JUMP_IN_ANIMATION),
        { once: true }
      );
    }
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconCallout,
      titleKey: 'callout',
      name: TOOL_NAME,
      searchTerms: ['callout', 'note', 'info', 'warning', 'tip', 'alert'],
      searchTermKeys: ['callout', 'note', 'info', 'warning', 'tip', 'alert'],
      section: 'basic',
    };
  }

  public static get conversionConfig(): ConversionConfig<CalloutData> {
    return {
      /**
       * Callout stores its text inside child blocks, not in its own `data`.
       * On import we capture the source block's text through a transient
       * `__importedText` field that the callout constructor reads and the
       * `rendered()` hook uses to seed the first child paragraph with the
       * original content — preserving the text across paragraph -> callout
       * conversion.
       */
      import: (stringToImport: string): CalloutData => ({
        emoji: DEFAULT_EMOJI,
        textColor: null,
        backgroundColor: null,
        __importedText: stringToImport,
      }),
      // The callout's own data has no text; its lines are child blocks,
      // which a turn-into carries over (see `releasesChildrenOnTurnInto`).
      export: (): string => '',
    };
  }

  public static get pasteConfig(): PasteConfig {
    return {
      tags: [{ ASIDE: { style: true } }],
    };
  }

  public static get sanitize(): ToolSanitizerConfig {
    return {
      emoji: false,
      textColor: false,
      backgroundColor: false,
    };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }
}

export type { CalloutData, CalloutConfig };
