import { IconCross } from '../../../components/icons';
import { registerLayer } from '../../../components/utils/dismissable-layer';

export interface DialOptions {
  min: number;
  max: number;
  value: number;
  /** Arrow key step. Default 1. */
  step?: number;
  /** Shift+arrow and PageUp/PageDown step. Default 5. */
  bigStep?: number;
  /** aria-label. */
  label: string;
  /** aria-valuetext. */
  valueText(v: number): string;
  /** Every change while dragging, and per key. */
  onInput(v: number): void;
  /** On pointerup, or 250 ms after the last key. */
  onCommit(v: number): void;
  /** Adds a reset-to-0 button with this accessible name, shown while the value is off 0. */
  resetLabel?: string;
  /** Where a double-click goes. Default 0. */
  resetTo?: number;
}

export type DialSetup = Pick<DialOptions, 'min' | 'max' | 'label' | 'valueText' | 'resetLabel'> & { value: number };

export interface Dial {
  /** The slider itself. */
  el: HTMLElement;
  /** The slider plus its reset button; mount this one. A button may not sit inside a slider. */
  box: HTMLElement;
  reset: HTMLButtonElement | null;
  /** Moves the dial without callbacks and drops a pending key commit. */
  set(v: number): void;
  /** Commits a pending key burst first, then swaps range, name and value. */
  configure(o: DialSetup): void;
  /** Commits a pending key burst now. Call before undo, Reset or Done. */
  flush(): void;
  destroy(): void;
}

export const PX_PER_UNIT = 6;
export const KEY_COMMIT_MS = 250;
const TICK_EVERY = 5;
const MAJOR_EVERY = 15;
const DETENT = 1;

const el = (cls: string, role: string): HTMLElement => {
  const node = document.createElement('div');

  node.className = cls;
  node.setAttribute('data-role', role);

  return node;
};

const decimals = (n: number): number => (String(n).split('.')[1] ?? '').length;

/** A plus sign only where the range also goes below zero. */
const format = (v: number, signed: boolean): string => {
  const text = String(Math.abs(Math.round(v * 10) / 10));

  if (v > 0) return signed ? `+${text}` : text;

  // U+2212 minus: the hyphen reads too short next to digits.
  return v < 0 ? `−${text}` : '0';
};

export function createDial(o: DialOptions): Dial {
  const step = o.step ?? 1;
  const bigStep = o.bigStep ?? 5;
  const setup: DialSetup = { min: o.min, max: o.max, value: o.value, label: o.label, valueText: o.valueText, resetLabel: o.resetLabel };
  const st = { value: o.value, keyTimer: 0, pointerId: -1, startX: 0, startValue: 0 };
  const edit: { input: HTMLInputElement | null; unlayer: (() => void) | null } = { input: null, unlayer: null };

  const root = el('blok-darkroom__dial', 'dial');
  const label = el('blok-darkroom__dial-value', 'dial-value');
  const track = el('blok-darkroom__dial-track', 'dial-track');
  const ruler = el('blok-darkroom__dial-ruler', 'dial-ruler');
  const needle = el('blok-darkroom__dial-needle', 'dial-needle');

  root.setAttribute('role', 'slider');
  root.setAttribute('tabindex', '0');
  root.setAttribute('aria-orientation', 'horizontal');
  label.setAttribute('aria-hidden', 'true');
  track.setAttribute('aria-hidden', 'true');
  track.append(ruler, needle);
  root.append(label, track);
  const box = el('blok-darkroom__dial-box', 'dial-box');
  const reset = o.resetLabel === undefined ? null : document.createElement('button');

  box.appendChild(root);
  if (reset) {
    reset.type = 'button';
    reset.className = 'blok-darkroom__dial-reset';
    reset.setAttribute('data-role', 'dial-reset');
    reset.innerHTML = IconCross;
    box.appendChild(reset);
  }

  const clamp = (v: number): number => Math.min(setup.max, Math.max(setup.min, v));
  // Rounds away float dust (0.1 + 0.2) so aria-valuenow and the saved value stay clean.
  const snap = (v: number): number => Number((Math.round(v / step) * step).toFixed(decimals(step)));

  const drawTicks = (): void => {
    const first = Math.ceil(setup.min / TICK_EVERY) * TICK_EVERY;
    const count = Math.max(0, Math.floor((setup.max - first) / TICK_EVERY) + 1);
    const ticks = Array.from({ length: count }, (_, i) => {
      const t = first + i * TICK_EVERY;
      const tick = el('blok-darkroom__dial-tick', 'dial-tick');

      tick.setAttribute('data-value', String(t));
      tick.style.left = `${t * PX_PER_UNIT}px`;
      if (t % MAJOR_EVERY === 0) tick.setAttribute('data-major', '');

      return tick;
    });

    ruler.replaceChildren(...ticks);
  };

  const render = (): void => {
    root.setAttribute('aria-label', setup.label);
    root.setAttribute('aria-valuemin', String(setup.min));
    root.setAttribute('aria-valuemax', String(setup.max));
    root.setAttribute('aria-valuenow', String(st.value));
    root.setAttribute('aria-valuetext', setup.valueText(st.value));
    label.textContent = format(st.value, setup.min < 0);
    ruler.style.transform = `translateX(${-st.value * PX_PER_UNIT + 0}px)`;
    if (!reset) return;
    const shown = st.value !== 0;

    reset.setAttribute('aria-label', setup.resetLabel ?? '');
    // An attribute, not [hidden]: darkroom.css keeps its box so the row never jumps.
    reset.setAttribute('data-shown', String(shown));
    if (!shown && document.activeElement === reset) root.focus({ preventScroll: true });
  };

  const change = (v: number): boolean => {
    if (v === st.value) return false;
    st.value = v;
    render();
    o.onInput(v);

    return true;
  };

  const cancelKeyCommit = (): void => {
    window.clearTimeout(st.keyTimer);
    st.keyTimer = 0;
  };

  const flush = (): void => {
    if (st.keyTimer === 0) return;
    cancelKeyCommit();
    o.onCommit(st.value);
  };

  const keyTarget = (e: KeyboardEvent): number | null => {
    const small = e.shiftKey ? bigStep : step;

    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowDown': return st.value - small;
      case 'ArrowRight':
      case 'ArrowUp': return st.value + small;
      case 'PageUp': return st.value + bigStep;
      case 'PageDown': return st.value - bigStep;
      case 'Home': return 0;
      default: return null;
    }
  };

  // One step: drops a pending key burst, then commits the rest value at once.
  const resetToRest = (): void => {
    const rest = o.resetTo ?? 0;

    if (st.value === rest) return;
    flush();
    change(rest);
    o.onCommit(rest);
  };

  // Reads what a person types: a typographic minus, a plus sign, a decimal comma.
  const parse = (text: string): number | null => {
    const n = Number.parseFloat(text.trim().replace('−', '-').replace('+', '').replace(',', '.'));

    return Number.isFinite(n) ? n : null;
  };

  const closeEditor = (apply: boolean): void => {
    const input = edit.input;

    if (input === null) return;
    edit.input = null;
    edit.unlayer?.();
    edit.unlayer = null;
    const typed = apply ? parse(input.value) : null;

    input.remove();
    label.removeAttribute('data-editing');
    root.focus({ preventScroll: true });
    if (typed === null) return;
    flush();
    if (change(clamp(snap(typed)))) o.onCommit(st.value);
  };

  /** A field beside the slider, laid over the number: a text field may not sit inside a slider. */
  const openEditor = (seed: string): void => {
    if (edit.input !== null) return;
    flush();
    const input = document.createElement('input');

    input.type = 'text';
    input.inputMode = 'decimal';
    input.className = 'blok-darkroom__dial-input';
    input.setAttribute('data-role', 'dial-input');
    input.setAttribute('aria-label', setup.label);
    input.value = seed;
    input.addEventListener('keydown', (e) => {
      // The darkroom reads Enter as Done and Cmd+Z as its own undo; both belong to the field now.
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        closeEditor(true);
      }
    });
    input.addEventListener('blur', () => closeEditor(true));
    edit.input = input;
    // Escape is caught at the document in the capture phase; this layer makes it cancel the edit, not the dialog.
    edit.unlayer = registerLayer({
      element: input,
      onDismiss: (reason) => closeEditor(reason !== 'escape'),
    });
    label.setAttribute('data-editing', '');
    box.appendChild(input);
    input.focus({ preventScroll: true });
    input.select();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (/^[\d.,+−-]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      openEditor(e.key);

      return;
    }
    const target = keyTarget(e);

    if (target === null) return;
    e.preventDefault();
    if (!change(clamp(snap(target)))) return;
    cancelKeyCommit();
    st.keyTimer = window.setTimeout(() => {
      st.keyTimer = 0;
      o.onCommit(st.value);
    }, KEY_COMMIT_MS);
  };

  const onDown = (e: PointerEvent): void => {
    if (st.pointerId !== -1) return;
    // The number opens the field on click; it is not a grip.
    if (e.target instanceof Node && label.contains(e.target)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    flush();
    st.pointerId = e.pointerId;
    st.startX = e.clientX;
    st.startValue = st.value;
    root.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    root.focus({ preventScroll: true });
  };

  const onMove = (e: PointerEvent): void => {
    if (e.pointerId !== st.pointerId) return;
    // The ruler moves under a fixed needle: dragging it left brings higher values to the centre.
    const raw = clamp(snap(st.startValue - (e.clientX - st.startX) / PX_PER_UNIT));

    change(clamp(Math.abs(raw) < DETENT ? 0 : raw));
  };

  // pointercancel ends the drag too, or a taken-over touch would never commit.
  const onEnd = (e: PointerEvent): void => {
    if (e.pointerId !== st.pointerId) return;
    st.pointerId = -1;
    if (st.value !== st.startValue) o.onCommit(st.value);
  };

  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onEnd);
  root.addEventListener('pointercancel', onEnd);
  root.addEventListener('dblclick', resetToRest);
  reset?.addEventListener('click', resetToRest);
  const onLabelClick = (): void => openEditor(String(st.value));

  label.addEventListener('click', onLabelClick);
  drawTicks();
  render();

  return {
    el: root,
    box,
    reset,
    set(v: number): void {
      cancelKeyCommit();
      st.value = v;
      render();
    },
    configure(next: DialSetup): void {
      flush();
      Object.assign(setup, next);
      st.value = next.value;
      drawTicks();
      render();
    },
    flush,
    destroy(): void {
      closeEditor(false);
      label.removeEventListener('click', onLabelClick);
      cancelKeyCommit();
      st.pointerId = -1;
      root.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onEnd);
      root.removeEventListener('pointercancel', onEnd);
      root.removeEventListener('dblclick', resetToRest);
      reset?.removeEventListener('click', resetToRest);
    },
  };
}
