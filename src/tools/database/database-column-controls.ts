import type { I18n } from '../../../types';

export interface ColumnControlsOptions {
  i18n: I18n;
  onRename: (optionId: string, label: string) => void;
  onDelete: (optionId: string) => void;
}

export class DatabaseColumnControls {
  private options: ColumnControlsOptions;
  private readonly i18n: I18n;

  constructor(options: ColumnControlsOptions) {
    this.options = options;
    this.i18n = options.i18n;
  }

  makeEditable(headerEl: HTMLElement, optionId: string): void {
    const titleEl = headerEl.querySelector('[data-blok-database-column-title]');

    if (titleEl) {
      const input = document.createElement('input');

      input.type = 'text';
      input.value = titleEl.textContent ?? '';
      input.setAttribute('data-blok-database-column-title-input', '');
      input.setAttribute('aria-label', this.i18n.t('tools.database.renameColumn'));
      input.addEventListener('change', () => {
        this.options.onRename(optionId, input.value);
      });
      titleEl.replaceWith(input);
    }

    const deleteBtn = document.createElement('button');

    deleteBtn.setAttribute('data-blok-database-delete-column', '');
    deleteBtn.setAttribute('aria-label', this.i18n.t('tools.database.deleteColumn'));
    deleteBtn.setAttribute('data-option-id', optionId);
    deleteBtn.addEventListener('click', () => {
      this.options.onDelete(optionId);
    });
    headerEl.appendChild(deleteBtn);
  }

  destroy(): void { /* no global listeners */ }
}
