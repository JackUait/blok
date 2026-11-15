export interface EmojiPickerOptions {
  onSelect(icon: string): void;
  onRemove(): void;
  i18n: {t(key: string): string};
  locale: string;
  curated?: boolean;
  fitToAnchor?: boolean;
  startInset?: number;
}
export class EmojiPicker {
  constructor(options: EmojiPickerOptions);
  getElement(): HTMLElement;
  open(anchor: HTMLElement, rect?: DOMRect, handlers?: {current?: string; onSelect(icon:string):void; onRemove():void}): Promise<void>;
  close(): void;
}
