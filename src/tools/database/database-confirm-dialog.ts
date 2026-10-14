import { openModalDialog } from '../../components/utils/modal-dialog';
import type { DialogRole } from '../../components/utils/modal-dialog';

export interface DatabaseConfirmOptions {
  title: string;
  /** A line under the title, read as the dialog's description. */
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Paints the confirm button red, as Notion does for Remove, Delete and Move to Trash. */
  destructive?: boolean;
  /** An element in the editor whose direction the dialog takes. */
  directionSource?: Element | null;
  /** Defaults to `alertdialog`. */
  role?: DialogRole;
  /** Over another modal: mount inside its surface, or the two focus traps pull focus back and forth forever. */
  container?: HTMLElement;
  /** Aborting closes the dialog as a cancel: the modal it sits in is going away. */
  signal?: AbortSignal;
}

const counter = { next: 0 };

/**
 * Asks a yes/no question in a centred modal (research/08 "Modal dialog").
 * Resolves true on confirm; false on cancel, Escape or a press outside.
 */
export const openDatabaseConfirm = (options: DatabaseConfirmOptions): Promise<boolean> => new Promise((resolve) => {
  const backdrop = document.createElement('div');
  const panel = document.createElement('div');
  const title = document.createElement('div');

  backdrop.setAttribute('data-blok-database-confirm', '');
  // Mounted on body: the popover scope brings the editor font and preflight.
  backdrop.setAttribute('data-blok-popover', '');
  panel.setAttribute('data-blok-database-confirm-dialog', '');
  title.setAttribute('data-blok-database-confirm-title', '');
  counter.next += 1;
  title.id = `blok-database-confirm-title-${counter.next}`;
  title.textContent = options.title;
  panel.appendChild(title);
  const description = options.description === undefined ? null : document.createElement('div');

  if (description !== null) {
    description.setAttribute('data-blok-database-confirm-description', '');
    description.id = `blok-database-confirm-description-${counter.next}`;
    description.textContent = options.description ?? '';
    panel.appendChild(description);
  }

  const button = (name: 'confirm' | 'cancel', label: string): HTMLButtonElement => {
    const el = document.createElement('button');

    el.type = 'button';
    el.setAttribute('data-blok-database-confirm-action', name);
    el.textContent = label;
    panel.appendChild(el);

    return el;
  };

  const confirmButton = button('confirm', options.confirmLabel);
  const cancelButton = button('cancel', options.cancelLabel);

  if (options.destructive === true) {
    confirmButton.setAttribute('data-destructive', '');
  }
  backdrop.appendChild(panel);

  const handle = openModalDialog({
    content: backdrop,
    surface: panel,
    role: options.role ?? 'alertdialog',
    labelledBy: title.id,
    ...(description === null ? {} : { describedBy: description.id }),
    initialFocus: () => cancelButton,
    directionSource: options.directionSource ?? null,
    ...(options.container === undefined ? {} : { container: options.container, topLayer: false }),
    onDismiss: () => finish(false),
  });

  const settled = { done: false };

  function finish(answer: boolean): void {
    if (settled.done) {
      return;
    }
    settled.done = true;
    handle.close();
    resolve(answer);
  }

  options.signal?.addEventListener('abort', () => finish(false), { once: true });
  confirmButton.addEventListener('click', () => finish(true));
  cancelButton.addEventListener('click', () => finish(false));
});
