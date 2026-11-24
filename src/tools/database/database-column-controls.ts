
export interface ColumnControlsOptions {
  onRename: (optionId: string, label: string) => void;
  /** Called once a rename lands — for the backend persist. Optional. */
  onRenameCommit?: (optionId: string, label: string) => void;
  /** Opens the rename popup under the pill. `done` gets the new name, or null when it closes without one. */
  openRename: (pill: HTMLElement, label: string, done: (label: string | null) => void) => void;
}

export class DatabaseColumnControls {
  private options: ColumnControlsOptions;

  constructor(options: ColumnControlsOptions) {
    this.options = options;
  }

  makePillTitleEditable(headerEl: HTMLElement, optionId: string): void {
    const titleEl = headerEl.querySelector<HTMLElement>('[data-blok-database-column-title]');
    const pill = headerEl.querySelector<HTMLElement>('[data-blok-database-column-pill]');

    // notion-motion.md Round 97 §1 #1: the pill is a Tab stop. The listeners go on once, so a second call adds none.
    if (titleEl === null || pill === null || pill.tabIndex >= 0) return;

    titleEl.style.cursor = 'text';
    pill.tabIndex = 0;
    pill.setAttribute('role', 'button');
    // notion-motion.md Round 98 §1 #1: Enter or Space opens the rename popup under the pill.
    pill.addEventListener('keydown', (e) => {
      if (e.target !== pill || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      this.openRenamePopup(pill, optionId);
    });
    // notion-motion.md Round 99 §1 #1: a click opens the same popup.
    pill.addEventListener('click', (e) => {
      e.stopPropagation(); // keeps the click from the header's column drag
      this.openRenamePopup(pill, optionId);
    });
  }

  private openRenamePopup(pill: HTMLElement, optionId: string): void {
    const titleEl = pill.querySelector<HTMLElement>('[data-blok-database-column-title]');
    const originalLabel = titleEl?.textContent ?? '';

    this.options.openRename(pill, originalLabel, (label) => {
      if (label !== null && label !== originalLabel && titleEl !== null) {
        titleEl.textContent = label;
        this.options.onRenameCommit?.(optionId, label);
        this.options.onRename(optionId, label);
      }
      if (pill.isConnected) pill.focus();
    });
  }

  destroy(): void { /* no global listeners */ }
}
