import { startInlineRename } from '../../components/utils/inline-rename';
import type { I18n } from '../../../types';

export interface ColumnControlsOptions {
  i18n: I18n;
  onRename: (optionId: string, label: string) => void;
  onDelete: (optionId: string) => void;
  /** Called on every keystroke — for instant local update. Optional. */
  onRenameInput?: (optionId: string, label: string) => void;
  /** Called on blur/Enter — for debounced backend persist. Optional. */
  onRenameCommit?: (optionId: string, label: string) => void;
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

      // Fallback for browsers without field-sizing: content (e.g. Firefox).
      // Sets the size attribute to the character count so the input doesn't
      // default to 20-char width. Modern browsers use the CSS property instead.
      const syncSize = (): void => {
        input.size = Math.max(input.value.length, 1);
      };

      syncSize();
      input.addEventListener('input', syncSize);
      input.addEventListener('change', () => {
        this.options.onRename(optionId, input.value);
      });
      titleEl.replaceWith(input);
    }

    this.appendDeleteButton(headerEl, optionId);
  }

  appendDeleteButton(headerEl: HTMLElement, optionId: string): void {
    const deleteBtn = document.createElement('button');

    deleteBtn.setAttribute('data-blok-database-delete-column', '');
    deleteBtn.setAttribute('aria-label', this.i18n.t('tools.database.deleteColumn'));
    deleteBtn.setAttribute('data-option-id', optionId);
    deleteBtn.addEventListener('click', () => {
      this.options.onDelete(optionId);
    });
    headerEl.appendChild(deleteBtn);
  }

  makePillTitleEditable(headerEl: HTMLElement, optionId: string): void {
    const titleEl = headerEl.querySelector<HTMLElement>('[data-blok-database-column-title]');
    if (titleEl === null) return;

    titleEl.style.cursor = 'text';

    titleEl.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation(); // prevent column drag from starting

      const originalLabel = titleEl.textContent ?? '';

      const restoreDiv = (label: string): HTMLElement => {
        const div = document.createElement('div');
        div.setAttribute('data-blok-database-column-title', '');
        div.style.cursor = 'text';
        div.textContent = label;
        return div;
      };

      startInlineRename({
        target: titleEl,
        currentValue: originalLabel,
        label: this.i18n.t('tools.database.renameColumn'),
        configureInput: (input) => {
          input.setAttribute('data-blok-database-column-title-input', '');
          // Size sync for Firefox (no field-sizing: content)
          const syncSize = (): void => { input.setAttribute('size', String(Math.max(input.value.length, 1))); };
          syncSize();
          input.addEventListener('input', syncSize);
        },
        onInput: (value) => {
          this.options.onRenameInput?.(optionId, value);
        },
        buildRestored: restoreDiv,
        onCommit: (newLabel) => {
          // re-attach click listener on restored div
          this.makePillTitleEditable(headerEl, optionId);
          // Fire commit only when the final resolved label actually changed
          if (newLabel !== originalLabel) {
            this.options.onRenameCommit?.(optionId, newLabel);
            this.options.onRename(optionId, newLabel);
          }
        },
        onCancel: () => {
          this.makePillTitleEditable(headerEl, optionId);
        },
      });
    });
  }

  destroy(): void { /* no global listeners */ }
}
