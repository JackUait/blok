export interface DatabaseKeyboardOptions {
  wrapper: HTMLElement;
  onEscape: () => boolean;
}

export class DatabaseKeyboard {
  private wrapper: HTMLElement;
  private onEscape: () => boolean;
  private boundKeydown: ((e: KeyboardEvent) => void) | null = null;

  constructor(options: DatabaseKeyboardOptions) {
    this.wrapper = options.wrapper;
    this.onEscape = options.onEscape;
  }

  attach(): void {
    this.boundKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        const handled = this.onEscape();

        if (handled) {
          e.stopPropagation();
        }
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
