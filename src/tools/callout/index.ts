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
import { handleCalloutFirstChildBackspace } from './callout-keyboard';
import { COLOR_CONFIGS, colorVarStyle } from './style-config';
import { EmojiPicker } from './emoji-picker';
import { IconCallout } from '../../components/icons';
import {
  TOOL_NAME,
  ADD_EMOJI_KEY,
  DEFAULT_EMOJI,
  DEFAULT_COLOR,
} from './constants';

export class CalloutTool implements BlockTool {
  private readonly api: API;
  private readonly readOnly: boolean;
  private _data: CalloutData;
  private _dom: CalloutDOMRefs | null = null;
  private _picker: EmojiPicker | null = null;
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
    return {
      emoji: typeof data.emoji === 'string' ? data.emoji : DEFAULT_EMOJI,
      color: typeof data.color === 'string' ? data.color : DEFAULT_COLOR,
    };
  }

  public render(): HTMLElement {
    const dom = buildCalloutDOM({
      emoji: this._data.emoji,
      readOnly: this.readOnly,
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

    // Append existing children to the container
    for (const child of children) {
      if (child.holder.parentElement !== this._dom.childContainer) {
        this._dom.childContainer.appendChild(child.holder);
      }
    }

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
      color: this._data.color,
    });
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
      this._dom.wrapper.style.border = '1px solid var(--blok-callout-default-border, #e5e7eb)';
      return;
    }

    this._dom.wrapper.style.backgroundColor = colorVarStyle(cfg.bgVar);
    this._dom.wrapper.style.color = colorVarStyle(cfg.textVar);
    this._dom.wrapper.style.border = '';
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
      import: (): CalloutData => ({
        emoji: DEFAULT_EMOJI,
        color: DEFAULT_COLOR,
      }),
    };
  }

  public static get sanitize(): ToolSanitizerConfig {
    return {
      emoji: false,
      color: false,
    };
  }

  public static get isReadOnlySupported(): boolean {
    return true;
  }
}

export type { CalloutData, CalloutConfig };
