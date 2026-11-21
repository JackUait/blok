import { startInlineRename } from '../../components/utils/inline-rename';
import type { I18n } from '../../../types';

export interface ColumnControlsOptions {
  i18n: I18n;
  onRename: (optionId: string, label: string) => void;
  /** Called on every keystroke — for instant local update. Optional. */
  onRenameInput?: (optionId: string, label: string) => void;
  /** Called on blur/Enter — for debounced backend persist. Optional. */
  onRenameCommit?: (optionId: string, label: string) => void;
}

export class DatabaseColumnControls {
  private options: ColumnControlsOptions;
  private readonly i18n: I18n;
  /** The pill whose rename a key started: focus goes back to it when the rename ends. */
  private keyPill: HTMLElement | null = null;

  constructor(options: ColumnControlsOptions) {
    this.options = options;
    this.i18n = options.i18n;
  }

  makePillTitleEditable(headerEl: HTMLElement, optionId: string): void {
    const titleEl = headerEl.querySelector<HTMLElement>('[data-blok-database-column-title]');
    if (titleEl === null) return;

    titleEl.style.cursor = 'text';

    const pill = headerEl.querySelector<HTMLElement>('[data-blok-database-column-pill]');

    // notion-motion.md Round 97 §1 #1: the pill is a Tab stop. A rename re-runs this, so the key listener goes on once.
    if (pill !== null && pill.tabIndex < 0) {
      pill.tabIndex = 0;
      pill.setAttribute('role', 'button');
      pill.addEventListener('keydown', (e) => {
        if (e.target !== pill || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        pill.querySelector<HTMLElement>('[data-blok-database-column-title]')?.click();
        this.keyPill = pill;
      });
    }

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
          this.refocusKeyPill();
          // Fire commit only when the final resolved label actually changed
          if (newLabel !== originalLabel) {
            this.options.onRenameCommit?.(optionId, newLabel);
            this.options.onRename(optionId, newLabel);
          }
        },
        onCancel: () => {
          this.makePillTitleEditable(headerEl, optionId);
          this.refocusKeyPill();
        },
      });
    });
  }

  /** The rename hands focus to the restored title; a blur that Tab caused keeps its new focus. */
  private refocusKeyPill(): void {
    const pill = this.keyPill;
    const active = document.activeElement;

    this.keyPill = null;
    if (pill?.isConnected === true && (active === null || active === document.body || pill.contains(active))) pill.focus();
  }

  destroy(): void { /* no global listeners */ }
}
