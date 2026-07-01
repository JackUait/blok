/**
 * Roving-tabindex keyboard controller for a set of radios (or tabs) that behave
 * as a single-select group — the Radix `RadioGroup` interaction contract adapted
 * for Blok's vanilla-TS surfaces.
 *
 * Contract:
 * - **Single tab stop.** Only the selected member is `tabindex=0`; the rest are
 *   `-1`, so Tab enters/leaves the group once rather than stepping through each
 *   option.
 * - **Selection follows focus.** Arrow keys (and Home/End) move focus *and*
 *   select the target via `onSelect`, matching native radio-group behaviour.
 * - Arrow keys wrap around the ends.
 *
 * The controller owns focus + roving `tabindex`; the caller owns the selection
 * model (updating `aria-checked`/`aria-selected`, syncing app state) inside
 * `onSelect` and reports the current selection through `getSelectedIndex`.
 */

export type RovingOrientation = 'horizontal' | 'vertical' | 'both';

export interface RovingRadioGroupOptions {
  /** Radio elements (`role="radio"` or `role="tab"`), in navigation order. */
  radios: HTMLElement[];
  /** Index of the currently-selected radio, or `-1` when none is selected. */
  getSelectedIndex(): number;
  /**
   * Invoked when keyboard navigation selects a radio (selection-follows-focus).
   * The caller syncs its own selection state here.
   */
  onSelect(index: number): void;
  /**
   * Which arrow-key axis moves between radios. Defaults to `'horizontal'`
   * (Left/Right); `'vertical'` uses Up/Down; `'both'` accepts either axis.
   */
  orientation?: RovingOrientation;
}

export interface RovingRadioGroup {
  /** Re-apply the roving tab stop from the current selection (call after selection changes elsewhere, e.g. a click). */
  refresh(): void;
  /** Detach keyboard handling. */
  destroy(): void;
}

export function rovingRadioGroup(options: RovingRadioGroupOptions): RovingRadioGroup {
  const { radios, getSelectedIndex, onSelect } = options;
  const orientation = options.orientation ?? 'horizontal';

  const prevKeys = orientation === 'vertical'
    ? ['ArrowUp']
    : orientation === 'both'
      ? ['ArrowLeft', 'ArrowUp']
      : ['ArrowLeft'];
  const nextKeys = orientation === 'vertical'
    ? ['ArrowDown']
    : orientation === 'both'
      ? ['ArrowRight', 'ArrowDown']
      : ['ArrowRight'];

  const applyTabStop = (): void => {
    const selected = getSelectedIndex();
    // A roving group must always keep exactly one focusable member; fall back to
    // the first radio when nothing is selected yet.
    const stop = selected >= 0 ? selected : 0;
    radios.forEach((radio, i) => {
      radio.tabIndex = i === stop ? 0 : -1;
    });
  };

  const move = (index: number): void => {
    if (radios.length === 0) return;
    const target = ((index % radios.length) + radios.length) % radios.length;
    onSelect(target);
    applyTabStop();
    radios[target].focus();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const current = radios.indexOf(event.currentTarget as HTMLElement);
    if (current < 0) return;

    if (nextKeys.includes(event.key)) {
      event.preventDefault();
      move(current + 1);
    } else if (prevKeys.includes(event.key)) {
      event.preventDefault();
      move(current - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      move(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      move(radios.length - 1);
    }
  };

  for (const radio of radios) {
    radio.addEventListener('keydown', onKeyDown);
  }
  applyTabStop();

  return {
    refresh: applyTabStop,
    destroy(): void {
      for (const radio of radios) {
        radio.removeEventListener('keydown', onKeyDown);
      }
    },
  };
}
