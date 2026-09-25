import { DATA_ATTR } from '../../constants/data-attributes';
import type { FindConfig, FindPlacement } from '../../../../types';
import { IconChevronDown, IconChevronRight, IconCross } from '../../icons';
import { hide as hideTooltip, onHover } from '../../utils/tooltip';
import { promoteToTopLayer, removeFromTopLayer } from '../../utils/top-layer';
import { createTooltipContent } from '../toolbar/tooltip';

import type { FindOptions } from './match-text';

export interface FindBarCallbacks {
  onQueryChange(query: string): void;
  onNext(): void;
  onPrevious(): void;
  onClose(): void;
  onOptionsChange(options: FindOptions): void;
  onReplace(replacement: string): void;
  onReplaceAll(replacement: string): void;
  onSeek(index: number): void;
}

export interface FindBarResults {
  /** 0-based index of the active match, -1 when none. */
  current: number;
  total: number;
  /** One per match, 0..1 down the document. */
  positions: number[];
}

export interface FindBarInit {
  t: (key: string, vars?: Record<string, string | number>) => string;
  callbacks: FindBarCallbacks;
  isMac: boolean;
  /** Where the host wants the bar; see FindConfig. */
  placement?: FindPlacement;
  offset?: FindConfig['offset'];
}

/** Above this the map draws buckets, not one tick per match. */
const MAX_TICKS = 200;

const ATTR = {
  dock: 'data-blok-find',
  bar: 'data-blok-find-bar',
  row: 'data-blok-find-row',
  field: 'data-blok-find-field',
  counter: 'data-blok-find-counter',
  iconButton: 'data-blok-find-icon-button',
  toggle: 'data-blok-find-toggle',
  divider: 'data-blok-find-divider',
  controls: 'data-blok-find-controls',
  replaceToggle: 'data-blok-find-replace-toggle',
  replaceRow: 'data-blok-find-replace-row',
  textButton: 'data-blok-find-text-button',
  map: 'data-blok-find-map',
  tick: 'data-blok-find-tick',
  active: 'data-blok-find-active',
  empty: 'data-blok-find-empty',
  shake: 'data-blok-find-shake',
  bump: 'data-blok-find-bump',
  roll: 'data-blok-find-roll',
  rollFrom: 'data-blok-find-roll-from',
  open: 'data-blok-find-open',
  readOnly: 'data-blok-find-read-only',
  placement: 'data-blok-find-placement',
} as const;

const TICK_INDEX = 'data-blok-find-index';

/** Stands in for the current number, to find where a locale puts it. */
const CURRENT_MARK = '\uE000';

const PLACEMENTS: readonly FindPlacement[] = ['top-start', 'top-center', 'top-end', 'bottom-start', 'bottom-center', 'bottom-end'];

/** Keeps `aria-controls` ids unique across editors on one page. */
const idSequence = { next: 0 };

interface Shortcuts {
  next: string;
  previous: string;
  close: string;
  matchCase: string;
  wholeWord: string;
  replace: string;
  replaceAll: string;
}

const shortcutsFor = (isMac: boolean): Shortcuts => isMac
  ? { next: '⏎', previous: '⇧⏎', close: 'Esc', matchCase: '⌥C', wholeWord: '⌥W', replace: '⏎', replaceAll: '⌘⏎' }
  : { next: 'Enter', previous: 'Shift+Enter', close: 'Esc', matchCase: 'Alt+C', wholeWord: 'Alt+W', replace: 'Enter', replaceAll: 'Ctrl+Enter' };

const build = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {}
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);

  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }

  return element;
};

/**
 * Restarts a one-shot CSS animation keyed on an attribute.
 * @param element - the animated element
 * @param attribute - the attribute its keyframes hang on
 */
const replay = (element: HTMLElement, attribute: string): void => {
  element.removeAttribute(attribute);
  void element.offsetWidth;
  element.setAttribute(attribute, '');
};

export class FindBar {
  public readonly element: HTMLElement;

  private readonly t: FindBarInit['t'];
  private readonly callbacks: FindBarCallbacks;
  private readonly isMac: boolean;

  private readonly bar: HTMLElement;
  private readonly field: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly counter: HTMLElement;
  private readonly replaceToggle: HTMLButtonElement;
  private readonly matchCaseButton: HTMLButtonElement;
  private readonly wholeWordButton: HTMLButtonElement;
  private readonly previousButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly map: HTMLElement;
  private readonly replaceRow: HTMLElement;
  private readonly replaceInput: HTMLInputElement;
  private readonly replaceButton: HTMLButtonElement;
  private readonly replaceAllButton: HTMLButtonElement;

  private ticks: HTMLElement[] = [];
  private positions: number[] = [];

  private opened = false;
  private readOnly = false;
  private replaceOpen = false;
  private matchCase = false;
  private wholeWord = false;
  private total = 0;
  /** The count the counter shows now, -1 when it shows none. */
  private shown = { current: -1, total: 0 };
  private noResults = false;

  private readonly listeners: Array<() => void> = [];

  constructor(init: FindBarInit) {
    this.t = init.t;
    this.callbacks = init.callbacks;
    this.isMac = init.isMac;

    const shortcuts = shortcutsFor(this.isMac);
    const replaceRowId = `blok-find-replace-${++idSequence.next}`;

    this.element = build('div', {
      [ATTR.dock]: '',
      [DATA_ATTR.keyboardOwner]: '',
      'data-blok-testid': 'find-dock',
    });
    this.element.hidden = true;
    this.element.toggleAttribute('inert', true);

    // A search landmark, not a dialog: the bar is non-modal and the page stays usable behind it.
    this.bar = build('div', {
      [ATTR.bar]: '',
      role: 'search',
      'aria-label': this.t('find.placeholder'),
      'data-blok-testid': 'find-bar',
    });

    const row = build('div', { [ATTR.row]: '' });

    this.replaceToggle = this.makeIconButton('find.toggleReplace', IconChevronRight, 'find-replace-toggle');
    this.replaceToggle.setAttribute(ATTR.replaceToggle, '');
    this.replaceToggle.setAttribute('aria-expanded', 'false');
    this.replaceToggle.setAttribute('aria-controls', replaceRowId);

    this.field = build('div', { [ATTR.field]: '', 'data-blok-testid': 'find-field' });

    this.input = build('input', {
      type: 'search',
      'aria-label': this.t('find.placeholder'),
      placeholder: this.t('find.placeholder'),
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      enterkeyhint: 'search',
      'data-blok-testid': 'find-input',
    });

    this.counter = build('span', {
      [ATTR.counter]: '',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      'data-blok-testid': 'find-counter',
    });

    this.field.append(this.input, this.counter);

    this.matchCaseButton = this.makeToggle('find.matchCase', 'Aa', 'find-match-case');
    this.wholeWordButton = this.makeToggle('find.wholeWord', 'ab', 'find-whole-word');
    this.previousButton = this.makeIconButton('find.previous', IconChevronDown, 'find-previous');
    this.previousButton.setAttribute('data-blok-find-previous', '');
    this.nextButton = this.makeIconButton('find.next', IconChevronDown, 'find-next');
    this.closeButton = this.makeIconButton('find.close', IconCross, 'find-close');

    const divider = build('span', { [ATTR.divider]: '', 'aria-hidden': 'true' });

    // find.css lays both rows on one grid: toggle | field | controls.
    const controls = build('div', { [ATTR.controls]: '' });

    controls.append(
      this.matchCaseButton,
      this.wholeWordButton,
      divider,
      this.previousButton,
      this.nextButton,
      this.closeButton
    );
    row.append(this.replaceToggle, this.field, controls);

    // Pointer shortcut only; keyboard users step with Enter / Shift+Enter.
    this.map = build('div', { [ATTR.map]: '', 'aria-hidden': 'true', 'data-blok-testid': 'find-map' });
    this.map.hidden = true;

    this.replaceRow = build('div', { [ATTR.replaceRow]: '', id: replaceRowId, 'data-blok-testid': 'find-replace-row' });
    this.replaceRow.hidden = true;

    const replaceInner = build('div', { [ATTR.row]: '' });
    const replaceField = build('div', { [ATTR.field]: '', 'data-blok-testid': 'find-replace-field' });

    this.replaceInput = build('input', {
      type: 'text',
      'aria-label': this.t('find.replacePlaceholder'),
      placeholder: this.t('find.replacePlaceholder'),
      autocomplete: 'off',
      spellcheck: 'false',
      'data-blok-testid': 'find-replace-input',
    });
    replaceField.append(this.replaceInput);

    this.replaceButton = this.makeTextButton('find.replace', 'find-replace');
    this.replaceAllButton = this.makeTextButton('find.replaceAll', 'find-replace-all');
    const replaceControls = build('div', { [ATTR.controls]: '' });

    replaceControls.append(this.replaceButton, this.replaceAllButton);
    replaceInner.append(replaceField, replaceControls);
    this.replaceRow.append(replaceInner);

    this.bar.append(row, this.replaceRow, this.map);
    this.element.append(this.bar);

    this.bindTooltip(this.matchCaseButton, 'find.matchCase', shortcuts.matchCase);
    this.bindTooltip(this.wholeWordButton, 'find.wholeWord', shortcuts.wholeWord);
    this.bindTooltip(this.previousButton, 'find.previous', shortcuts.previous);
    this.bindTooltip(this.nextButton, 'find.next', shortcuts.next);
    this.bindTooltip(this.closeButton, 'find.close', shortcuts.close);
    this.bindTooltip(this.replaceButton, 'find.replace', shortcuts.replace);
    this.bindTooltip(this.replaceAllButton, 'find.replaceAll', shortcuts.replaceAll);

    this.listen(this.input, 'input', () => this.handleInput());
    this.listen(this.bar, 'keydown', (event) => this.handleKeydown(event));
    this.listen(this.replaceToggle, 'click', () => this.setReplaceOpen(!this.replaceOpen));
    this.listen(this.matchCaseButton, 'click', () => this.toggleOption('matchCase'));
    this.listen(this.wholeWordButton, 'click', () => this.toggleOption('wholeWord'));
    this.listen(this.previousButton, 'click', () => this.callbacks.onPrevious());
    this.listen(this.nextButton, 'click', () => this.callbacks.onNext());
    this.listen(this.closeButton, 'click', () => this.callbacks.onClose());
    this.listen(this.replaceButton, 'click', () => this.callbacks.onReplace(this.replaceInput.value));
    this.listen(this.replaceAllButton, 'click', () => this.callbacks.onReplaceAll(this.replaceInput.value));
    this.listen(this.map, 'click', (event) => this.handleMapClick(event));
    this.listen(this.field, 'animationend', (event) => {
      if (event.target === this.field) {
        this.field.removeAttribute(ATTR.shake);
      }
    });
    this.listen(this.counter, 'animationend', () => this.counter.removeAttribute(ATTR.bump));
    this.place(init.placement, init.offset);

    this.renderResults();
  }

  public get isOpen(): boolean {
    return this.opened;
  }

  public get query(): string {
    return this.input.value;
  }

  public get options(): FindOptions {
    return { matchCase: this.matchCase, wholeWord: this.wholeWord };
  }

  public open(init: { query?: string; replace?: boolean; readOnly: boolean }): void {
    this.setReadOnly(init.readOnly);

    if (init.replace === true && !this.readOnly) {
      this.setReplaceOpen(true);
    }

    if (this.opened) {
      if (init.query !== undefined) {
        this.input.value = init.query;
        this.callbacks.onQueryChange(init.query);
      }

      this.focusQuery();

      return;
    }

    this.opened = true;
    this.element.hidden = false;
    this.element.toggleAttribute('inert', false);
    // The top layer sits above every stacking context a host page can build.
    promoteToTopLayer(this.element);

    if (init.query !== undefined) {
      this.input.value = init.query;
    }

    // A reopened bar keeps its last query, which must be searched again.
    if (init.query !== undefined || this.input.value !== '') {
      this.callbacks.onQueryChange(this.input.value);
    }

    this.focusQuery();
  }

  public close(): void {
    if (!this.opened) {
      return;
    }

    this.opened = false;
    hideTooltip();
    // `hidden` and `inert` land now; the exit animation rides a discrete `display` transition in find.css.
    this.element.toggleAttribute('inert', true);
    this.element.hidden = true;
    removeFromTopLayer(this.element);
  }

  public setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly;
    this.replaceToggle.hidden = readOnly;
    this.bar.toggleAttribute(ATTR.readOnly, readOnly);

    if (readOnly) {
      this.setReplaceOpen(false);
    }
  }

  public setResults(results: FindBarResults): void {
    this.total = results.total;
    this.positions = results.positions;
    this.renderResults(results.current);
  }

  public destroy(): void {
    this.opened = false;
    hideTooltip();
    this.listeners.forEach((remove) => remove());
    this.listeners.length = 0;
    removeFromTopLayer(this.element);
    this.element.remove();
  }

  /**
   * Pin the bar where the host configured it. find.css does the placing; an
   * unknown placement or a non-finite offset falls back to the default.
   * @param placement - window corner or edge
   * @param offset - distance from the named edges, in px
   */
  private place(placement: FindPlacement | undefined, offset: FindConfig['offset']): void {
    const known = placement !== undefined && PLACEMENTS.includes(placement);

    this.element.setAttribute(ATTR.placement, known ? placement : 'top-end');

    for (const [axis, value] of [['x', offset?.x], ['y', offset?.y]] as const) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        this.element.style.setProperty(`--blok-find-offset-${axis}`, `${value}px`);
      }
    }
  }

  private focusQuery(): void {
    this.input.focus({ preventScroll: true });
    this.input.select();
  }

  private handleInput(): void {
    if (!this.opened) {
      return;
    }

    if (this.input.value === '') {
      this.total = 0;
      this.positions = [];
      this.renderResults();
    }

    this.callbacks.onQueryChange(this.input.value);
  }

  private handleKeydown(event: KeyboardEvent): void {
    if (!this.opened || event.isComposing) {
      return;
    }

    if (event.key === 'Escape') {
      // One Escape closes one layer: a host dialog around the editor must stay open.
      event.preventDefault();
      event.stopPropagation();
      this.callbacks.onClose();

      return;
    }

    const target = event.target;
    const inFind = target === this.input;
    const inReplace = target === this.replaceInput;

    if (!inFind && !inReplace) {
      return;
    }

    // `code`, not `key`: macOS Option turns C into ç and W into ∑.
    if (event.altKey && !event.metaKey && !event.ctrlKey && (event.code === 'KeyC' || event.code === 'KeyW')) {
      event.preventDefault();
      this.toggleOption(event.code === 'KeyC' ? 'matchCase' : 'wholeWord');

      return;
    }

    if (event.key !== 'Enter') {
      return;
    }

    if (inFind) {
      event.preventDefault();

      if (event.shiftKey) {
        this.callbacks.onPrevious();
      } else {
        this.callbacks.onNext();
      }

      return;
    }

    event.preventDefault();

    if (this.readOnly || this.total === 0) {
      return;
    }

    const mod = this.isMac ? event.metaKey : event.ctrlKey;
    const otherMod = this.isMac ? event.ctrlKey : event.metaKey;

    if (otherMod || event.altKey || event.shiftKey) {
      return;
    }

    if (mod) {
      this.callbacks.onReplaceAll(this.replaceInput.value);
    } else {
      this.callbacks.onReplace(this.replaceInput.value);
    }
  }

  private toggleOption(option: 'matchCase' | 'wholeWord'): void {
    if (option === 'matchCase') {
      this.matchCase = !this.matchCase;
      this.matchCaseButton.setAttribute('aria-pressed', String(this.matchCase));
    } else {
      this.wholeWord = !this.wholeWord;
      this.wholeWordButton.setAttribute('aria-pressed', String(this.wholeWord));
    }

    this.callbacks.onOptionsChange(this.options);
  }

  private setReplaceOpen(open: boolean): void {
    const next = open && !this.readOnly;

    this.replaceOpen = next;
    this.replaceRow.hidden = !next;
    this.replaceToggle.setAttribute('aria-expanded', String(next));
    this.bar.toggleAttribute(ATTR.open, next);
  }

  private renderResults(current = -1): void {
    const hasQuery = this.input.value !== '';
    const noResults = hasQuery && this.total === 0;
    const text = this.counterText(current, noResults);

    if (this.counter.textContent !== text && !this.rollCounter(current, text)) {
      this.counter.textContent = text;

      if (text !== '') {
        replay(this.counter, ATTR.bump);
      }
    }

    this.shown = { current: this.total > 0 ? current : -1, total: this.total };

    this.field.toggleAttribute(ATTR.empty, noResults);

    if (noResults) {
      this.input.setAttribute('aria-invalid', 'true');
    } else {
      this.input.removeAttribute('aria-invalid');
    }

    if (noResults && !this.noResults) {
      replay(this.field, ATTR.shake);
    }

    if (!noResults) {
      this.field.removeAttribute(ATTR.shake);
    }

    this.noResults = noResults;

    const none = this.total === 0;

    // A disabled button drops focus to <body>, where Escape no longer reaches the bar.
    if (none && document.activeElement instanceof HTMLButtonElement) {
      const focused = document.activeElement;

      if (focused === this.replaceButton || focused === this.replaceAllButton) {
        this.replaceInput.focus({ preventScroll: true });
      } else if (focused === this.previousButton || focused === this.nextButton) {
        this.input.focus({ preventScroll: true });
      }
    }

    this.previousButton.disabled = none;
    this.nextButton.disabled = none;
    this.replaceButton.disabled = none;
    this.replaceAllButton.disabled = none;

    this.renderMap(current);
  }

  private counterText(current: number, noResults: boolean): string {
    if (this.total > 0) {
      return this.t('find.count', { current: current + 1, total: this.total });
    }

    return noResults ? this.t('find.noResults') : '';
  }

  /**
   * Roll the digits of the current number that changed, when only it changed.
   * The old digits live in an attribute that CSS paints, so the counter's
   * text and what it announces stay the new count.
   * @param current - zero-based index of the new current match
   * @param text - the full new counter text
   * @returns false when the count cannot roll and needs a plain redraw
   */
  private rollCounter(current: number, text: string): boolean {
    if (this.shown.current < 0 || current < 0 || this.shown.total !== this.total) {
      return false;
    }

    const marked = this.t('find.count', { current: CURRENT_MARK, total: this.total });
    const [before, after] = marked.split(CURRENT_MARK);
    const next = String(current + 1);
    const previous = String(this.shown.current + 1);

    // A locale that formats the number itself cannot be split this way.
    if (next === previous || after === undefined || before + next + after !== text) {
      return false;
    }

    const kept = next.length === previous.length
      ? [...next].findIndex((digit, index) => digit !== previous[index])
      : 0;
    const roll = build('span', {
      [ATTR.roll]: current > this.shown.current ? 'up' : 'down',
      [ATTR.rollFrom]: previous.slice(kept),
    });

    roll.textContent = next.slice(kept);
    this.counter.replaceChildren(before + next.slice(0, kept), roll, after);

    return true;
  }

  private renderMap(current: number): void {
    const total = this.total;
    const buckets = Math.min(total, MAX_TICKS);
    const positionOf = (index: number): number => Math.min(1, Math.max(0, this.positions[index] ?? 0));
    const bucketFor = (index: number): number =>
      total <= MAX_TICKS ? index : Math.min(buckets - 1, Math.floor(positionOf(index) * buckets));

    this.map.hidden = total === 0;

    // One tick per bucket; each keeps the first match that fell into it.
    const seen = new Set<number>();
    const firstIndex = Array.from({ length: total }, (_, index) => index).filter((index) => {
      const bucket = bucketFor(index);
      const isFirst = !seen.has(bucket);

      seen.add(bucket);

      return isFirst;
    });
    const tickOfBucket = new Map(firstIndex.map((matchIndex, tickIndex) => [bucketFor(matchIndex), tickIndex]));
    const activeTick = current >= 0 && current < total ? tickOfBucket.get(bucketFor(current)) ?? -1 : -1;

    while (this.ticks.length > firstIndex.length) {
      this.ticks.pop()?.remove();
    }

    firstIndex.forEach((matchIndex, tickIndex) => {
      const tick = this.ticks[tickIndex] ?? this.makeTick();

      tick.style.left = `${positionOf(matchIndex) * 100}%`;
      tick.setAttribute(TICK_INDEX, String(matchIndex));
      tick.toggleAttribute(ATTR.active, tickIndex === activeTick);
    });

  }

  private makeTick(): HTMLElement {
    const tick = build('span', { [ATTR.tick]: '', 'data-blok-testid': 'find-map-tick' });

    this.map.append(tick);
    this.ticks.push(tick);

    return tick;
  }

  private handleMapClick(event: MouseEvent): void {
    if (!this.opened || this.total === 0) {
      return;
    }

    const tick = event.target instanceof Element ? event.target.closest(`[${ATTR.tick}]`) : null;
    const index = tick?.getAttribute(TICK_INDEX);

    if (index !== undefined && index !== null) {
      this.callbacks.onSeek(Number(index));

      return;
    }

    const box = this.map.getBoundingClientRect();

    if (box.width === 0) {
      return;
    }

    const ratio = (event.clientX - box.left) / box.width;
    const nearest = this.positions.reduce((best, position, i) =>
      Math.abs(position - ratio) < Math.abs(this.positions[best] - ratio) ? i : best, 0);

    this.callbacks.onSeek(nearest);
  }

  private makeIconButton(labelKey: string, icon: string, testId: string): HTMLButtonElement {
    const button = build('button', {
      type: 'button',
      [ATTR.iconButton]: '',
      'aria-label': this.t(labelKey),
      'data-blok-testid': testId,
    });

    button.innerHTML = icon;

    return button;
  }

  private makeToggle(labelKey: string, glyph: string, testId: string): HTMLButtonElement {
    const button = build('button', {
      type: 'button',
      [ATTR.iconButton]: '',
      [ATTR.toggle]: testId,
      'aria-label': this.t(labelKey),
      'aria-pressed': 'false',
      'data-blok-testid': testId,
    });
    const glyphElement = build('span', { 'aria-hidden': 'true' });

    glyphElement.textContent = glyph;
    button.append(glyphElement);

    return button;
  }

  private makeTextButton(labelKey: string, testId: string): HTMLButtonElement {
    const button = build('button', { type: 'button', [ATTR.textButton]: '', 'data-blok-testid': testId });

    button.textContent = this.t(labelKey);

    return button;
  }

  private bindTooltip(element: HTMLElement, labelKey: string, shortcut?: string): void {
    const label = { text: this.t(labelKey), highlight: true };
    const line = shortcut === undefined
      ? [label]
      : [label, { text: '  ', highlight: false }, { text: shortcut, highlight: false, direction: 'ltr' as const }];

    onHover(element, createTooltipContent([line]), { placement: 'bottom', delay: 400 });
  }

  private listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void
  ): void {
    const guarded = (event: HTMLElementEventMap[K]): void => {
      // Buttons keep working through the exit transition otherwise.
      if (!this.opened && type === 'click') {
        return;
      }

      handler(event);
    };

    target.addEventListener(type, guarded);
    this.listeners.push(() => target.removeEventListener(type, guarded));
  }
}
