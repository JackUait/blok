import { IconCross } from '../../components/icons';
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
  /** Aborting closes the dialog as a dismiss: the modal it sits in is going away. */
  signal?: AbortSignal;
  /** A blue confirm and a borderless cancel, as Notion's form auto-create prompt (research/19 §3a). */
  primary?: boolean;
  /** Icon SVG constants drawn in a row above the title. */
  art?: string[];
  /** What Escape, a press outside and an abort resolve to. Defaults to false. */
  dismissAs?: boolean;
  /** Draws a × at the top right with this label. It dismisses, and takes focus on open (research/30 B3). */
  closeLabel?: string;
}

export interface DatabaseChoice {
  label: string;
  description: string;
}

const counter = { next: 0 };

/**
 * Asks a yes/no question in a centred modal (research/08 "Modal dialog").
 * Resolves true on confirm; false on cancel, Escape or a press outside.
 */
export const openDatabaseConfirm = (options: DatabaseConfirmOptions): Promise<boolean> => buildConfirm(options, []);

/**
 * The confirm dialog with radio cards above its buttons, the first picked
 * (research/26 §5a). Resolves the picked card's index, or null when not confirmed.
 */
export const openDatabaseChoice = async (options: DatabaseConfirmOptions & { choices: DatabaseChoice[] }): Promise<number | null> => {
  const answer = { index: 0 };
  const confirmed = await buildConfirm(options, options.choices, (index) => {
    answer.index = index;
  });

  return confirmed ? answer.index : null;
};

const buildConfirm = (options: DatabaseConfirmOptions, choices: DatabaseChoice[], onPick?: (index: number) => void): Promise<boolean> => new Promise((resolve) => {
  const backdrop = document.createElement('div');
  const panel = document.createElement('div');
  const title = document.createElement('div');

  backdrop.setAttribute('data-blok-database-confirm', '');
  // Mounted on body: the popover scope brings the editor font and preflight.
  backdrop.setAttribute('data-blok-popover', '');
  panel.setAttribute('data-blok-database-confirm-dialog', '');
  const close = options.closeLabel === undefined ? null : document.createElement('button');

  if (close !== null) {
    close.type = 'button';
    close.setAttribute('data-blok-database-confirm-close', '');
    close.setAttribute('aria-label', options.closeLabel ?? '');
    close.innerHTML = IconCross;
    panel.appendChild(close);
  }
  if (options.art !== undefined) {
    const art = document.createElement('div');

    art.setAttribute('data-blok-database-confirm-art', '');
    art.setAttribute('aria-hidden', 'true');
    art.innerHTML = options.art.join('');
    panel.appendChild(art);
  }
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

  if (choices.length > 0) {
    const picked = { index: 0 };
    const group = document.createElement('div');
    const cards = choices.map((choice, index) => {
      const card = document.createElement('button');
      const text = document.createElement('span');
      const label = document.createElement('span');
      const hint = document.createElement('span');
      const dot = document.createElement('span');

      card.type = 'button';
      card.setAttribute('role', 'radio');
      card.setAttribute('data-blok-database-confirm-choice', '');
      label.setAttribute('data-blok-database-confirm-choice-label', '');
      label.textContent = choice.label;
      hint.setAttribute('data-blok-database-confirm-choice-description', '');
      hint.textContent = choice.description;
      dot.setAttribute('data-blok-database-confirm-choice-dot', '');
      dot.setAttribute('aria-hidden', 'true');
      text.append(label, hint);
      card.append(text, dot);
      card.addEventListener('click', () => {
        picked.index = index;
        onPick?.(index);
        paint();
      });

      return card;
    });
    const paint = (): void => cards.forEach((card, index) => card.setAttribute('aria-checked', String(index === picked.index)));

    panel.setAttribute('data-wide', '');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', title.id);
    group.setAttribute('data-blok-database-confirm-choices', '');
    group.append(...cards);
    paint();
    panel.appendChild(group);
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
  if (options.primary === true) {
    confirmButton.setAttribute('data-primary', '');
    cancelButton.setAttribute('data-quiet', '');
  }
  backdrop.appendChild(panel);

  const handle = openModalDialog({
    content: backdrop,
    surface: panel,
    role: options.role ?? 'alertdialog',
    labelledBy: title.id,
    ...(description === null ? {} : { describedBy: description.id }),
    initialFocus: () => close ?? (options.primary === true ? confirmButton : cancelButton),
    directionSource: options.directionSource ?? null,
    ...(options.container === undefined ? {} : { container: options.container, topLayer: false }),
    onDismiss: () => finish(options.dismissAs ?? false),
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

  options.signal?.addEventListener('abort', () => finish(options.dismissAs ?? false), { once: true });
  confirmButton.addEventListener('click', () => finish(true));
  cancelButton.addEventListener('click', () => finish(false));
  close?.addEventListener('click', () => finish(options.dismissAs ?? false));
});
