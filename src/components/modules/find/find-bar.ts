import { DATA_ATTR } from '../../constants/data-attributes';
import type { FindConfig, FindPlacement } from '../../../../types';
import type { PopoverItemParams } from '../../../../types/utils/popover/popover-item';
import { PopoverEvent } from '../../../../types/utils/popover/popover-event';
import { IconCheck, IconChevronDown, IconChevronRight, IconCross, IconPlayerSettings } from '../../icons';
import { hide as hideTooltip, onHover } from '../../utils/tooltip';
import { PopoverDesktop } from '../../utils/popover';
import { promoteToTopLayer, removeFromTopLayer } from '../../utils/top-layer';
import { createTooltipContent } from '../toolbar/tooltip';

import { bloom, cornerOf, hop, HOP_DELAY, HOP_MS, springEasing, SPRINGS, stretch, type Corner, type Hop, type HopSource } from './find-motion';

import type { FindOptions } from './match-text';

export interface FindBarCallbacks {
  onQueryChange(query: string): void;
  onNext(): void;
  onPrevious(): void;
  onClose(): void;
  onOptionsChange(options: FindOptions): void;
  onReplace(replacement: string): void;
  onReplaceAll(replacement: string): void;
  /** The replacement to preview changed; read it from `FindBar.replacement`. */
  onReplaceChange(): void;
}

export interface FindBarResults {
  /** 0-based index of the active match, -1 when none. */
  current: number;
  total: number;
}

export interface FindBarInit {
  t: (key: string, vars?: Record<string, string | number>) => string;
  callbacks: FindBarCallbacks;
  isMac: boolean;
  /** Where the host wants the bar; see FindConfig. */
  placement?: FindPlacement;
  offset?: FindConfig['offset'];
}

const ATTR = {
  dock: 'data-blok-find',
  bar: 'data-blok-find-bar',
  row: 'data-blok-find-row',
  field: 'data-blok-find-field',
  counter: 'data-blok-find-counter',
  iconButton: 'data-blok-find-icon-button',
  options: 'data-blok-find-options',
  optionsActive: 'data-blok-find-options-active',
  optionsMenu: 'data-blok-find-options-menu',
  divider: 'data-blok-find-divider',
  controls: 'data-blok-find-controls',
  replaceToggle: 'data-blok-find-replace-toggle',
  replaceRow: 'data-blok-find-replace-row',
  textButton: 'data-blok-find-text-button',
  active: 'data-blok-find-active',
  empty: 'data-blok-find-empty',
  overflow: 'data-blok-find-overflow',
  shake: 'data-blok-find-shake',
  hopping: 'data-blok-find-hopping',
  bump: 'data-blok-find-bump',
  roll: 'data-blok-find-roll',
  rollFrom: 'data-blok-find-roll-from',
  open: 'data-blok-find-open',
  readOnly: 'data-blok-find-read-only',
  placement: 'data-blok-find-placement',
} as const;

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
  private readonly optionsButton: HTMLButtonElement;
  private readonly previousButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly replaceRow: HTMLElement;
  private readonly replaceInput: HTMLInputElement;
  private readonly replaceButton: HTMLButtonElement;
  private readonly replaceAllButton: HTMLButtonElement;

  private opened = false;
  private readOnly = false;
  private replaceOpen = false;
  private matchCase = false;
  private wholeWord = false;
  private total = 0;
  /** The count the counter shows now, -1 when it shows none. */
  private shown = { current: -1, total: 0 };
  private noResults = false;

  private optionsMenu: PopoverDesktop | null = null;
  private readonly replaceField: HTMLElement;
  private motion: Animation[] = [];
  private flight: Hop | null = null;

  private readonly listeners: Array<() => void> = [];
  private inputResize: ResizeObserver | undefined;

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

    this.field = build('div', { [ATTR.field]: '', 'data-blok-field': 'text', 'data-blok-testid': 'find-field' });

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

    this.optionsButton = this.makeIconButton('find.options', IconPlayerSettings, 'find-options');
    this.optionsButton.setAttribute(ATTR.options, '');
    this.optionsButton.setAttribute('aria-haspopup', 'menu');
    this.optionsButton.setAttribute('aria-expanded', 'false');
    this.previousButton = this.makeIconButton('find.previous', IconChevronDown, 'find-previous');
    this.previousButton.setAttribute('data-blok-find-previous', '');
    this.nextButton = this.makeIconButton('find.next', IconChevronDown, 'find-next');
    this.closeButton = this.makeIconButton('find.close', IconCross, 'find-close');

    const divider = build('span', { [ATTR.divider]: '', 'aria-hidden': 'true' });

    // find.css lays both rows on one grid: toggle | field | controls.
    const controls = build('div', { [ATTR.controls]: '' });

    controls.append(
      this.optionsButton,
      divider,
      this.previousButton,
      this.nextButton,
      this.closeButton
    );
    row.append(this.replaceToggle, this.field, controls);

    this.replaceRow = build('div', { [ATTR.replaceRow]: '', id: replaceRowId, 'data-blok-testid': 'find-replace-row' });
    this.replaceRow.hidden = true;

    const replaceInner = build('div', { [ATTR.row]: '' });
    this.replaceField = build('div', { [ATTR.field]: '', 'data-blok-field': 'text', 'data-blok-testid': 'find-replace-field' });

    this.replaceInput = build('input', {
      type: 'text',
      'aria-label': this.t('find.replacePlaceholder'),
      placeholder: this.t('find.replacePlaceholder'),
      autocomplete: 'off',
      spellcheck: 'false',
      'data-blok-testid': 'find-replace-input',
    });
    this.replaceField.append(this.replaceInput);

    this.replaceButton = this.makeTextButton('find.replace', 'find-replace');
    this.replaceAllButton = this.makeTextButton('find.replaceAll', 'find-replace-all');
    const replaceControls = build('div', { [ATTR.controls]: '' });

    replaceControls.append(this.replaceButton, this.replaceAllButton);
    replaceInner.append(this.replaceField, replaceControls);
    this.replaceRow.append(replaceInner);

    this.bar.append(row, this.replaceRow);
    this.element.append(this.bar);

    this.bindTooltip(this.optionsButton, 'find.options');
    this.bindTooltip(this.previousButton, 'find.previous', shortcuts.previous);
    this.bindTooltip(this.nextButton, 'find.next', shortcuts.next);
    this.bindTooltip(this.closeButton, 'find.close', shortcuts.close);
    this.bindTooltip(this.replaceButton, 'find.replace', shortcuts.replace);
    this.bindTooltip(this.replaceAllButton, 'find.replaceAll', shortcuts.replaceAll);

    this.listen(this.input, 'input', () => this.handleInput());
    this.listen(this.input, 'input', () => this.syncOverflow());
    this.listen(this.input, 'scroll', () => this.syncOverflow());
    this.listen(this.bar, 'keydown', (event) => this.handleKeydown(event));
    this.listen(this.replaceToggle, 'click', () => this.setReplaceOpen(!this.replaceOpen));
    // close() froze the motion for the fade; once faded, let it go.
    this.listen(this.element, 'transitionend', (event) => {
      if (event.target === this.element && !this.opened) {
        this.stopMotion();
      }
    });
    this.listen(this.optionsButton, 'click', () => this.toggleOptionsMenu());
    this.listen(this.previousButton, 'click', () => this.callbacks.onPrevious());
    this.listen(this.nextButton, 'click', () => this.callbacks.onNext());
    this.listen(this.closeButton, 'click', () => this.callbacks.onClose());
    this.listen(this.replaceButton, 'click', () => this.callbacks.onReplace(this.replaceInput.value));
    this.listen(this.replaceAllButton, 'click', () => this.callbacks.onReplaceAll(this.replaceInput.value));
    this.listen(this.replaceInput, 'input', () => this.callbacks.onReplaceChange());
    this.listen(this.field, 'animationend', (event) => {
      if (event.target === this.field) {
        this.field.removeAttribute(ATTR.shake);
      }
    });
    this.listen(this.counter, 'animationend', () => this.counter.removeAttribute(ATTR.bump));
    this.watchInputWidth();
    this.place(init.placement, init.offset);

    this.renderResults();
  }

  public get isOpen(): boolean {
    return this.opened;
  }

  public get query(): string {
    return this.input.value;
  }

  /** The text to preview in place of each match: empty while the replace row is closed. */
  public get replacement(): string {
    return this.replaceOpen ? this.replaceInput.value : '';
  }

  public get options(): FindOptions {
    return { matchCase: this.matchCase, wholeWord: this.wholeWord };
  }

  public open(init: { query?: string; replace?: boolean; readOnly: boolean; hop?: HopSource | null }): void {
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
      this.playHop(init.hop ?? null, 0);

      return;
    }

    this.opened = true;
    this.element.hidden = false;
    this.element.toggleAttribute('inert', false);
    // The top layer sits above every stacking context a host page can build.
    promoteToTopLayer(this.element);

    // The hop measures the field with the query already in it.
    if (init.query !== undefined) {
      this.input.value = init.query;
    }

    this.stopMotion();
    const hopping = this.playHop(init.hop ?? null, HOP_DELAY);

    this.track(...bloom({
      dock: this.element,
      bar: this.bar,
      field: this.field,
      query: this.input,
      counter: hopping ? null : this.counter,
      controls: [this.replaceToggle, this.optionsButton, this.previousButton, this.nextButton, this.closeButton].filter((control) => !control.hidden),
    }, this.corner()));

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

    this.flight?.end();
    // Paused, not cancelled, so the fade starts from this frame.
    // Running ones only: pause() brings a cancelled one back to its first frame.
    this.motion.filter((animation) => animation.playState === 'running').forEach((animation) => animation.pause());
    this.opened = false;
    hideTooltip();
    this.optionsMenu?.hide();
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
    this.renderResults(results.current);
  }

  public destroy(): void {
    this.flight?.end();
    this.stopMotion();
    this.opened = false;
    hideTooltip();
    this.optionsMenu?.destroy();
    this.listeners.forEach((remove) => remove());
    this.listeners.length = 0;
    this.inputResize?.disconnect();
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
    this.flight?.end();

    if (!this.opened) {
      return;
    }

    if (this.input.value === '') {
      this.total = 0;
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

    const isArrow = event.key === 'ArrowUp' || event.key === 'ArrowDown';

    // Modified arrows stay the field's: Shift selects, Alt/Cmd jump the caret.
    if (inFind && isArrow && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();

      if (event.key === 'ArrowUp') {
        this.callbacks.onPrevious();
      } else {
        this.callbacks.onNext();
      }

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

  private toggleOption(option: 'matchCase' | 'wholeWord', fromMenu = false): void {
    if (option === 'matchCase') {
      this.matchCase = !this.matchCase;
    } else {
      this.wholeWord = !this.wholeWord;
    }

    // The menu's rows cannot be re-checked from outside, so a shortcut closes it.
    if (!fromMenu) {
      this.optionsMenu?.hide();
    }

    this.optionsButton.toggleAttribute(ATTR.optionsActive, this.matchCase || this.wholeWord);
    this.callbacks.onOptionsChange(this.options);
  }

  private toggleOptionsMenu(): void {
    if (this.optionsMenu !== null) {
      this.optionsMenu.hide();

      return;
    }

    const shortcuts = shortcutsFor(this.isMac);
    const row = (option: 'matchCase' | 'wholeWord', labelKey: string, shortcut: string): PopoverItemParams => ({
      title: this.t(labelKey),
      name: option,
      toggle: true,
      isActive: this[option],
      secondaryLabel: shortcut,
      trailingIcon: IconCheck,
      onActivate: () => this.toggleOption(option, true),
    });

    const menu = new PopoverDesktop({
      items: [
        row('matchCase', 'find.matchCase', shortcuts.matchCase),
        row('wholeWord', 'find.wholeWord', shortcuts.wholeWord),
      ],
      trigger: this.optionsButton,
      flippable: true,
    });

    // One Escape closes one layer: the menu, not the bar. Window capture runs
    // before the bar's own handler and the popover registry's.
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        menu.hide();
      }
    };

    menu.getElement().setAttribute(ATTR.optionsMenu, '');
    menu.on(PopoverEvent.Closed, () => {
      window.removeEventListener('keydown', onKeydown, true);

      if (this.optionsMenu !== menu) {
        return;
      }

      this.optionsMenu = null;
      this.optionsButton.setAttribute('aria-expanded', 'false');

      // A row click or Escape would leave focus on <body>, where the bar's keys stop working.
      if (this.opened && (document.activeElement === document.body || (document.activeElement !== null && menu.hasNode(document.activeElement)))) {
        this.optionsButton.focus({ preventScroll: true });
      }

      menu.destroy();
    });

    window.addEventListener('keydown', onKeydown, true);
    this.optionsMenu = menu;
    this.optionsButton.setAttribute('aria-expanded', 'true');
    menu.show();
  }

  private corner(): Corner {
    return cornerOf(this.element.getAttribute(ATTR.placement) ?? 'top-end', this.element.getAttribute('dir') === 'rtl');
  }

  /** @returns true when a word is in flight */
  private playHop(source: HopSource | null, delay: number): boolean {
    this.flight?.end();

    if (source === null) {
      return false;
    }

    // Set once the flight starts; an interrupted hop cancels it so the counter shows at once.
    const roll: { counter?: Animation } = {};

    this.flight = hop(this.element, source, this.input, delay, (landed) => {
      this.flight = null;
      this.field.removeAttribute(ATTR.hopping);

      if (!landed) {
        roll.counter?.cancel();
      }

      if (landed) {
        const pop = springEasing(SPRINGS.bouncy);

        this.track(
          this.field.animate([{ scale: '1' }, { scale: '1.04 0.9', offset: 0.25 }, { scale: '1' }], pop),
          this.input.animate([{ translate: '0 -4px' }, { translate: '0 0' }], pop)
        );
      }
    });

    if (this.flight === null) {
      return false;
    }

    // Paint only: the counter's text, and what it announces, is already current.
    roll.counter = this.counter.animate([{ opacity: 0, translate: '0 14px' }, { opacity: 1, translate: '0 0' }], {
      ...springEasing(SPRINGS.bouncy),
      delay: delay + HOP_MS + 80,
      fill: 'backwards',
    });
    this.track(roll.counter);
    // Last: a throw above must not leave the field's text hidden.
    this.field.setAttribute(ATTR.hopping, '');

    return true;
  }

  /** Drops ended animations as it adds, so an open bar's list stays bounded. */
  private track(...animations: Animation[]): void {
    this.motion = [
      ...this.motion.filter((animation) => animation.playState !== 'idle' && animation.playState !== 'finished'),
      ...animations,
    ];
  }

  private stopMotion(): void {
    this.motion.forEach((animation) => animation.cancel());
    this.motion = [];
  }

  private setReplaceOpen(open: boolean): void {
    const next = open && !this.readOnly;
    const changed = next !== this.replaceOpen;
    // Before the row shows: the stretch springs from this size.
    const from = { width: this.bar.offsetWidth, height: this.bar.offsetHeight };

    this.replaceOpen = next;
    this.replaceRow.hidden = !next;
    this.replaceToggle.setAttribute('aria-expanded', String(next));
    this.bar.toggleAttribute(ATTR.open, next);

    // On a closed bar, the bloom that follows covers both rows.
    if (changed && next && this.opened) {
      this.stopMotion();
      this.motion = stretch({
        dock: this.element,
        bar: this.bar,
        field: this.replaceField,
        buttons: [this.replaceButton, this.replaceAllButton],
      }, from, this.corner());
    }

    // A stretch left running would paint the tall skin over a collapsing row.
    if (changed && !next) {
      this.stopMotion();
    }

    if (changed) {
      this.callbacks.onReplaceChange();
    }
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

  /**
   * The counter appearing narrows the input without a scroll or input event,
   * so width changes re-check the haze too.
   */
  private watchInputWidth(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    this.inputResize = new ResizeObserver(() => this.syncOverflow());
    this.inputResize.observe(this.input);
  }

  /** find.css hazes the input's end while text hides past it. */
  private syncOverflow(): void {
    // scrollLeft is negative in RTL, so measure from the end either way.
    const hidden = this.input.scrollWidth - this.input.clientWidth - Math.abs(this.input.scrollLeft);

    this.field.toggleAttribute(ATTR.overflow, hidden > 1);
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
