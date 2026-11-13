import { DATA_ATTR } from '../../components/constants/data-attributes';

import { clampRate } from './speed-scale';

/** A typed speed, kept between SPEED_MIN and SPEED_MAX, or null when the text is not a speed. */
export const parseRate = (text: string): number | null => {
  const cleaned = text.trim().replace(',', '.').replace(/\s*[x×]$/i, '');

  if (!/^(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;

  return clampRate(Number(cleaned));
};

export interface SpeedEntryOptions {
  /** The big number. It stays in the DOM's place while a field stands in for it. */
  readout: HTMLElement;
  classPrefix: string;
  label: string;
  rate(): number;
  onRate(rate: number): void;
}

export interface SpeedEntry {
  /** Set the open field's speed and close it. Nothing happens when no field is open. */
  commit(): void;
}

/**
 * Click the big speed number to type a speed. Enter or leaving the field sets it,
 * Escape keeps the old one.
 */
export const createSpeedEntry = ({ readout, classPrefix, label, rate, onRate }: SpeedEntryOptions): SpeedEntry => {
  readout.removeAttribute('aria-hidden');
  readout.setAttribute('role', 'button');
  readout.setAttribute('aria-label', label);
  readout.setAttribute(DATA_ATTR.keyboardOwner, '');
  readout.setAttribute('tabindex', '0');

  // Carries the readout's class so it keeps the same type size; the × stays beside the field.
  const box = document.createElement('span');
  const input = document.createElement('input');
  const unit = document.createElement('span');

  box.className = `${classPrefix}__speed-readout ${classPrefix}__speed-entry`;
  input.type = 'text';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.maxLength = 5;
  input.className = `${classPrefix}__speed-entry-input`;
  input.setAttribute('aria-label', label);
  // Arrows and Escape would otherwise move between blocks or clear the selection.
  input.setAttribute(DATA_ATTR.keyboardOwner, '');
  unit.className = `${classPrefix}__speed-readout-unit`;
  unit.textContent = '×';
  box.append(input, unit);

  const editing = { on: false };

  const open = (): void => {
    if (editing.on) return;
    editing.on = true;
    input.value = String(rate());
    readout.replaceWith(box);
    input.focus({ preventScroll: true });
    input.select();
  };

  // `editing` goes false first: swapping the field out can blur it, and that blur must not set the speed again.
  const close = (keep: boolean, refocus: boolean): void => {
    if (!editing.on) return;
    editing.on = false;

    const typed = keep ? parseRate(input.value) : null;

    box.replaceWith(readout);
    if (typed !== null) onRate(typed);
    if (refocus) readout.focus({ preventScroll: true });
  };

  readout.addEventListener('click', open);
  readout.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    open();
  });
  input.addEventListener('keydown', (event) => {
    // Every key is the field's: the players take digits, k, m and arrows as shortcuts,
    // and the card closes on Escape.
    event.stopPropagation();
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    close(event.key === 'Enter', true);
  });
  input.addEventListener('blur', () => close(true, false));

  return { commit: () => close(true, false) };
};
