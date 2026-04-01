export interface DatabaseKeyboardOptions {
  wrapper: HTMLElement;
  onEscape: () => void;
}

export class DatabaseKeyboard {
  private wrapper: HTMLElement;
  private onEscape: () => void;
  private boundKeydown: ((e: KeyboardEvent) => void) | null = null;

  constructor(options: DatabaseKeyboardOptions) {
    this.wrapper = options.wrapper;
    this.onEscape = options.onEscape;
  }

  attach(): void {
    this.boundKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        this.onEscape();
      }
    };
    this.wrapper.addEventListener('keydown', this.boundKeydown);
  }

  destroy(): void {
    if (this.boundKeydown) {
      this.wrapper.removeEventListener('keydown', this.boundKeydown);
      this.boundKeydown = null;
    }
  }
}
