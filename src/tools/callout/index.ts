// src/tools/callout/index.ts

import type {
  API,
  BlockTool,
  BlockToolConstructorOptions,
  ToolboxConfig,
  ConversionConfig,
  ToolSanitizerConfig,
} from '../../../types';
import type { MenuConfig } from '../../../types/tools/menu-config';
import type { CalloutData, CalloutConfig } from './types';
import { buildCalloutDOM, type CalloutDOMRefs } from './dom-builder';
import { saveCallout } from './block-operations';
import { handleCalloutEnter, handleCalloutBackspace } from './callout-keyboard';
import { COLOR_CONFIGS, colorVarStyle } from './style-config';
import { EmojiPicker } from './emoji-picker';
import { IconCallout } from '../../components/icons';
import {
  TOOL_NAME,
  PLACEHOLDER_KEY,
  ADD_EMOJI_KEY,
  DEFAULT_EMOJI,
  DEFAULT_COLOR,
} from './constants';

export class CalloutTool implements BlockTool {
  private readonly api: API;
  private readonly readOnly: boolean;
  private readonly _settings: CalloutConfig;
  private _data: CalloutData;
  private _dom: CalloutDOMRefs | null = null;
  private _picker: EmojiPicker | null = null;
  private blockId?: string;

  constructor({ data, config, api, readOnly, block }: BlockToolConstructorOptions<CalloutData, CalloutConfig>) {
    this.api = api;
    this.readOnly = readOnly;
    this._settings = config ?? {};
    this._data = this.normalizeData(data);

    if (block) {
      this.blockId = block.id;
    }
  }

  private normalizeData(data: Partial<CalloutData>): CalloutData {
    return {
      text: typeof data.text === 'string' ? data.text : '',
      emoji: typeof data.emoji === 'string' ? data.emoji : DEFAULT_EMOJI,
      color: typeof data.color === 'string' ? data.color : DEFAULT_COLOR,
    };
  }

  private get placeholder(): string {
    const fromConfig = this._settings.placeholder;
    if (fromConfig) return fromConfig;
    const translated = this.api.i18n.t(PLACEHOLDER_KEY);
    return translated !== PLACEHOLDER_KEY ? translated : 'Callout';
  }

  public render(): HTMLElement {
    const dom = buildCalloutDOM({
      emoji: this._data.emoji,
      text: this._data.text,
      readOnly: this.readOnly,
      placeholder: this.placeholder,
      addEmojiLabel: this.api.i18n.t(ADD_EMOJI_KEY),
    });

    this._dom = dom;
    this.applyColor(this._data.color);

    if (!this.readOnly) {
      dom.emojiButton.addEventListener('click', () => this.openEmojiPicker());
      dom.emojiButton.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.openEmojiPicker();
        }
      });
      dom.textElement.addEventListener('keydown', (e: KeyboardEvent) => this.handleKeyDown(e));
    }

    return dom.wrapper;
  }

  public rendered(): void {
    if (this.blockId === undefined || this._dom === null) {
      return;
    }

    const children = this.api.blocks.getChildren(this.blockId);
    for (const child of children) {
      // Guard against double-append on re-render (same pattern as Toggle lifecycle)
      if (child.holder.parentElement !== this._dom.childContainer) {
        this._dom.childContainer.appendChild(child.holder);
      }
    }
  }

  public save(): CalloutData {
    if (this._dom === null) {
      return this._data;
    }

    this._data = saveCallout({
      textElement: this._dom.textElement,
      emoji: this._data.emoji,
      color: this._data.color,
    });

    return this._data;
  }

  public validate(_data: CalloutData): boolean {
    return true;
  }

  public renderSettings(): MenuConfig {
    return COLOR_CONFIGS.map(cfg => ({
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="${cfg.bgVar !== '' ? `var(${cfg.bgVar})` : '#e5e7eb'}"/></svg>`,
      title: this.api.i18n.t(cfg.i18nKey),
      onActivate: () => this.setColor(cfg.name),
      closeOnActivate: true,
      isActive: this._data.color === cfg.name,
    }));
  }

  public removed(): void {
    // No-op — no subscriptions to clean up
  }

  private setColor(name: CalloutData['color']): void {
    this._data.color = name;
    this.applyColor(name);
  }

  private applyColor(name: CalloutData['color']): void {
    if (this._dom === null) {
      return;
    }

    const cfg = COLOR_CONFIGS.find(c => c.name === name);

    if (cfg === undefined || cfg.bgVar === '') {
      this._dom.wrapper.style.backgroundColor = '';
      this._dom.wrapper.style.color = '';
      return;
    }

    this._dom.wrapper.style.backgroundColor = colorVarStyle(cfg.bgVar);
    this._dom.wrapper.style.color = colorVarStyle(cfg.textVar);
  }

  private openEmojiPicker(): void {
    if (this._dom === null) {
      return;
    }

    if (this._picker === null) {
      this._picker = new EmojiPicker({
        onSelect: (native: string) => this.setEmoji(native),
        onRemove: () => this.setEmoji(''),
        i18n: this.api.i18n,
      });
      document.body.appendChild(this._picker.getElement());
    }

    void this._picker.open(this._dom.emojiButton);
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

  private handleKeyDown(e: KeyboardEvent): void {
    if (this._dom === null) {
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleCalloutEnter({
        api: this.api,
        blockId: this.blockId,
        data: this._data,
        textElement: this._dom.textElement,
      });
      return;
    }

    if (e.key === 'Backspace') {
      void handleCalloutBackspace({
        api: this.api,
        blockId: this.blockId,
        data: this._data,
        textElement: this._dom.textElement,
        event: e,
      });
    }
  }

  public static get toolbox(): ToolboxConfig {
    return {
      icon: IconCallout,
      title: 'Callout',
      titleKey: 'callout',
      name: TOOL_NAME,
      searchTerms: ['callout', 'note', 'info', 'warning', 'tip', 'alert'],
    };
  }

  public static get conversionConfig(): ConversionConfig<CalloutData> {
    return {
      export: (data: CalloutData): string => data.text,
      import: (text: string): CalloutData => ({
        text,
        emoji: DEFAULT_EMOJI,
        color: DEFAULT_COLOR,
      }),
    };
  }

  public static get sanitize(): ToolSanitizerConfig {
    return {
      text: {
        br: true,
        a: { href: true, target: '_blank', rel: 'nofollow' },
        b: true,
        i: true,
        mark: { class: true, style: true },
        code: true,
      },
      emoji: false,
      color: false,
    };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }
}

export type { CalloutData, CalloutConfig };
