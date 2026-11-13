import { DATA_ATTR } from '../../components/constants/data-attributes';

import { SPEED_MAX, SPEED_MIN, SPEED_SLIDER_STEP, clampRate, snapRate } from './speed-scale';

/** A typed speed, kept between SPEED_MIN and SPEED_MAX, or null when the text is not a speed. */
export const parseRate = (text: string): number | null => {
  const cleaned = text.trim().replace(',', '.').replace(/\s*[x×]$/i, '');

  if (!/^(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;

  return clampRate(Number(cleaned));
};

/**
 * The end a typed speed snaps to as it is typed, or null. Above the top always snaps:
 * more digits only grow it. Below the floor snaps only once no next key could reach it,
 * or "0" would block typing "0.5".
 */
const snapTyped = (text: string): number | null => {
  const cleaned = text.trim().replace(',', '.').replace(/\s*[x×]$/i, '');

  if (!/^(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;

  const rate = Number(cleaned);

  if (rate > SPEED_MAX) return SPEED_MAX;
  if (rate < SPEED_MIN && cleaned.includes('.') && Number(`${cleaned}9999`) < SPEED_MIN) return SPEED_MIN;

  return null;
};

/** Looks up one of the card's sentences in the player's own namespace (tools.audio.* or tools.video.*). */
export type SpeedEntryText = (key: string, fallback: string) => string;

export interface SpeedEntryOptions {
  /** The big number. The field takes its place, in a box of the same class. */
  readout: HTMLElement;
  /** The card. It carries data-speed-entry="open" while the field is open, so the presets can give way. */
  host: HTMLElement;
  classPrefix: string;
  t: SpeedEntryText;
  rate(): number;
  onRate(rate: number): void;
}

export interface SpeedEntry {
  /** The line that stands in for the presets while the field is open. The player places it. */
  helpLine: HTMLElement;
  /** Set the open field's speed and close it. Nothing happens when no field is open. */
  commit(): void;
}

const ARROW_STEP = { plain: SPEED_SLIDER_STEP, shift: 0.25 };

/**
 * Click the big speed number to type a speed. Enter or leaving the field sets it,
 * Escape keeps the old one. Audio and video share this, so both cards behave alike.
 */
export const createSpeedEntry = ({ readout, host, classPrefix, t, rate, onRate }: SpeedEntryOptions): SpeedEntry => {
  const label = t('playbackSpeed', 'Playback speed');
  const fill = (text: string): string =>
    text.replace(/\{min\}/g, `${SPEED_MIN}×`).replace(/\{max\}/g, `${SPEED_MAX}×`).replace(/\{example\}/g, '1.5');
  const words = {
    range: (): string => fill(t('speedEntryRange', '{min} to {max} · Enter to set')),
    tooHigh: (): string => fill(t('speedEntryTooHigh', 'Up to {max}')),
    tooLow: (): string => fill(t('speedEntryTooLow', 'At least {min}')),
    notNumber: (): string => fill(t('speedEntryNotNumber', 'Type a number, like {example}')),
  };

  readout.removeAttribute('aria-hidden');
  readout.setAttribute('role', 'button');
  readout.setAttribute('aria-label', label);
  readout.setAttribute(DATA_ATTR.keyboardOwner, '');
  readout.setAttribute('tabindex', '0');

  // The box carries the readout's class, so the well and the type size stay the same when it opens.
  const box = document.createElement('span');
  // The hidden copy of the text inside sets the field's width and baseline; the input lies over it.
  const sizer = document.createElement('span');
  const input = document.createElement('input');
  const unit = document.createElement('span');
  const helpLine = document.createElement('span');

  box.className = `${classPrefix}__speed-readout ${classPrefix}__speed-entry`;
  sizer.className = `${classPrefix}__speed-entry-sizer`;
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
  sizer.append(input);
  box.append(sizer, unit);
  helpLine.className = `${classPrefix}__speed-help`;
  helpLine.setAttribute('aria-live', 'polite');

  const state = { editing: false, snapped: null as number | null };

  const say = (text: string, strong: boolean): void => {
    helpLine.textContent = text;
    helpLine.setAttribute('data-strong', String(strong));
  };
  const describe = (): void => {
    const text = input.value.trim();

    if (state.snapped === SPEED_MAX) return say(words.tooHigh(), true);
    if (state.snapped === SPEED_MIN) return say(words.tooLow(), true);
    if (text !== '' && parseRate(text) === null) return say(words.notNumber(), true);
    // Below the floor but not snapped yet ("0" may still become "0.5"): say so, change nothing.
    if (text !== '' && Number(text.replace(',', '.').replace(/\s*[x×]$/i, '')) < SPEED_MIN) return say(words.tooLow(), true);

    return say(words.range(), false);
  };
  const showText = (): void => {
    sizer.setAttribute('data-value', input.value);
    describe();
  };
  const onInput = (): void => {
    state.snapped = snapTyped(input.value);
    if (state.snapped !== null) {
      input.value = String(state.snapped);
      input.setSelectionRange(input.value.length, input.value.length);
    }
    showText();
  };

  const open = (): void => {
    if (state.editing) return;
    state.editing = true;
    state.snapped = null;
    input.value = String(rate());
    showText();
    readout.replaceWith(box);
    host.setAttribute('data-speed-entry', 'open');
    input.focus({ preventScroll: true });
    input.select();
  };

  // `editing` goes false first: swapping the field out can blur it, and that blur must not set the speed again.
  const close = (keep: boolean, refocus: boolean): void => {
    if (!state.editing) return;
    state.editing = false;

    const typed = keep ? parseRate(input.value) : null;

    box.replaceWith(readout);
    host.removeAttribute('data-speed-entry');
    if (typed !== null) onRate(typed);
    if (refocus) readout.focus({ preventScroll: true });
  };

  const stepTyped = (direction: number, big: boolean): void => {
    const from = parseRate(input.value) ?? rate();

    input.value = String(snapRate(from + direction * (big ? ARROW_STEP.shift : ARROW_STEP.plain)));
    state.snapped = null;
    showText();
    input.select();
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
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      stepTyped(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey);
      return;
    }
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    close(event.key === 'Enter', true);
  });
  // At a snapped end, more typing would make a new speed out of the limit ("0.0" → 0.1, then "5" → 0.15).
  input.addEventListener('beforeinput', (event) => {
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;

    if (state.snapped !== null && event.inputType === 'insertText' && atEnd) event.preventDefault();
  });
  input.addEventListener('input', onInput);
  input.addEventListener('blur', () => close(true, false));

  return { helpLine, commit: () => close(true, false) };
};
