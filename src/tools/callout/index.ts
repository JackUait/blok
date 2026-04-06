// src/tools/callout/index.ts

import type {
  API,
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
import { buildCalloutDOM, type CalloutDOMRefs } from './dom-builder';
import { saveCallout } from './block-operations';
import { handleCalloutFirstChildBackspace } from './callout-keyboard';
import { mountChildBlocks } from '../nested-blocks';
import { createColorPicker, type ColorPickerHandle } from '../../components/shared/color-picker';
import { colorVarName } from '../../components/shared/color-presets';
import { mapToNearestPresetName } from '../../components/utils/color-mapping';
import { EmojiPicker } from './emoji-picker';
import { IconCallout, IconEmojiSmile, IconPaintRoller } from '../../components/icons';
import {
  TOOL_NAME,
  COLOR_KEY,
  EDIT_ICON_KEY,
  ADD_EMOJI_KEY,
  DEFAULT_EMOJI,
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

export class CalloutTool implements BlockTool {
  private readonly api: API;
  private readOnly: boolean;
  private _data: CalloutData;
  private _dom: CalloutDOMRefs | null = null;
  private _emojiPicker: EmojiPicker | null = null;
  private _colorPicker: ColorPickerHandle | null = null;
  private blockId?: string;

  constructor({ data, api, readOnly, block }: BlockToolConstructorOptions<CalloutData, CalloutConfig>) {
    this.api = api;
    this.readOnly = readOnly;
    this._data = this.normalizeData(data);

    if (block) {
      this.blockId = block.id;
    }
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
    });

    this._dom = dom;
    this.applyColors();

    if (!this.readOnly) {
      dom.emojiButton.addEventListener('click', () => this.openEmojiPicker());
      dom.emojiButton.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.openEmojiPicker();
        }
      });

      // Backspace delegation: intercept on first child block when it's empty
      dom.childContainer.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Backspace') {
          this.handleChildBackspace(e);
        }
      });
    }

    return dom.wrapper;
  }

  public rendered(): void {
    if (this.blockId === undefined || this._dom === null) {
      return;
    }

    const children = this.api.blocks.getChildren(this.blockId);

    mountChildBlocks(this._dom.childContainer, children);

    // Auto-create initial paragraph child when callout has no children
    if (children.length === 0) {
      const blockIndex = this.api.blocks.getBlockIndex(this.blockId);

      if (blockIndex !== undefined) {
        const newBlock = this.api.blocks.insertInsideParent(this.blockId, blockIndex + 1);

        // Manually append the new child's holder — insertInsideParent places it in the
        // flat block list but doesn't know about our childContainer DOM.
        this._dom.childContainer.appendChild(newBlock.holder);

        this.api.caret.setToBlock(newBlock.id, 'start');
      }
    }
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

  public setReadOnly(state: boolean): void {
    this.readOnly = state;

    if (this._dom) {
      this._dom.emojiButton.disabled = state;
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

  private handleChildBackspace(e: KeyboardEvent): void {
    if (this.blockId === undefined || this._dom === null) {
      return;
    }

    const children = this.api.blocks.getChildren(this.blockId);

    if (children.length === 0) {
      return;
    }

    const firstChild = children[0];

    // Only handle when the event target is inside the first child block
    const target = e.target as HTMLElement;

    if (!firstChild.holder.contains(target)) {
      return;
    }

    // Only handle when the first child is empty and caret is at start
    const selection = window.getSelection();
    const isAtStart = selection !== null &&
      selection.rangeCount > 0 &&
      selection.getRangeAt(0).startOffset === 0 &&
      selection.getRangeAt(0).collapsed;
    const isEmpty = firstChild.holder.textContent === '';

    if (!isEmpty || !isAtStart) {
      return;
    }

    void handleCalloutFirstChildBackspace({
      api: this.api,
      calloutBlockId: this.blockId,
      firstChildBlockId: firstChild.id,
      event: e,
    });
  }

  private openEmojiPicker(): void {
    if (this._dom === null) {
      return;
    }

    if (this._emojiPicker === null) {
      this._emojiPicker = new EmojiPicker({
        onSelect: (native: string) => this.setEmoji(native),
        onRemove: () => this.setEmoji(''),
        i18n: this.api.i18n,
        locale: this.api.i18n.getLocale(),
      });
      document.body.appendChild(this._emojiPicker.getElement());
    }

    void this._emojiPicker.open(this._dom.emojiButton);
  }

  private setEmoji(native: string): void {
    this._data.emoji = native;

    if (this._dom === null) {
      return;
    }

    this._dom.emojiButton.textContent = native;
    this._dom.emojiButton.setAttribute(
      'aria-label',
      native !== '' ? native : this.api.i18n.t(ADD_EMOJI_KEY)
    );
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconCallout,
      title: 'Callout',
      titleKey: 'callout',
      name: TOOL_NAME,
      searchTerms: ['callout', 'note', 'info', 'warning', 'tip', 'alert'],
      searchTermKeys: ['callout', 'note', 'info', 'warning', 'tip', 'alert'],
    };
  }

  public static get conversionConfig(): ConversionConfig<CalloutData> {
    return {
      import: (): CalloutData => ({
        emoji: DEFAULT_EMOJI,
        textColor: null,
        backgroundColor: null,
      }),
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
