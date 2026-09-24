/**
 * Find in page: Cmd/Ctrl+F opens Blok's own find bar.
 *
 * Search runs over the rendered DOM (see text-index.ts), so it sees read-only
 * content and the children of collapsed toggles. Matches are painted with the
 * Custom Highlight API and never wrapped in markup, so finding never edits the
 * document. Replacing does: it edits text nodes the way typing does.
 */
import { Module } from '../../__module';
import type { Block } from '../../block';
import { getUserOS } from '../../utils/browser';
import { findOwn } from '../../utils/own-element';
import { syncPortalDirection } from '../../utils/portal-direction';
import { prefersReducedMotion } from '../../utils/reduced-motion';
import { FindBar } from './find-bar';
import { FindLens } from './find-lens';
import { clearFindHighlights, paintFindHighlights } from './find-highlight';
import type { FindOptions } from './match-text';
import { editableHostOf, replaceRangeText } from './replace-text';
import { findRanges } from './text-index';
import type { TextPoint } from './text-point';
import { pointOf, startsAtOrAfter } from './text-point';

const EDITOR_SELECTOR = '[data-blok-testid="blok-editor"]';
const TOGGLE_STATE_SELECTOR = '[data-blok-toggle-open]';
const QUERY_DEBOUNCE_MS = 40;
const DOM_DEBOUNCE_MS = 120;
/** Space kept between a revealed match and the viewport edge (or the find bar). */
const REVEAL_MARGIN = 24;
const PREFILL_MAX_LENGTH = 120;

interface RenderOptions {
  /** Scroll the current match into view. */
  reveal: boolean;
  /** Play the arrival animation. */
  pulse?: boolean;
  /** Open collapsed toggles hiding the current match. Only for explicit moves: an open is a document edit. */
  expand?: boolean;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const isModKey = (event: KeyboardEvent): boolean => event.metaKey || event.ctrlKey;

const rectsOf = (range: Range): DOMRect[] =>
  typeof range.getClientRects === 'function' ? [...range.getClientRects()].filter((rect) => rect.width > 0 || rect.height > 0) : [];

const scrollParentOf = (element: Element): HTMLElement | null => {
  const parent = element.parentElement;

  if (parent === null) {
    return null;
  }

  const isScroller = /(auto|scroll|overlay)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight;

  return isScroller ? parent : scrollParentOf(parent);
};

/**
 * @class Find
 * @classdesc The find bar, match painting and replace.
 */
export class Find extends Module {
  /** Every editor listens on `document`; these pick the one a key on <body> belongs to. */
  private static readonly instances = new Set<Find>();
  private static lastActive: Find | null = null;

  private bar: FindBar | null = null;
  private lens: FindLens | null = null;
  private ranges: Range[] = [];
  private active = -1;
  /** Where the next search starts from: the caret at open, the current match, or the text just replaced. */
  private anchor: TextPoint | null = null;
  private observer: MutationObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  /** Focus and selection from before the bar opened, given back when it closes on no match. */
  private returnFocus: { element: HTMLElement; range: Range | null } | null = null;

  /**
   * Whether the find bar is open.
   */
  public get isOpen(): boolean {
    return this.bar?.isOpen === true;
  }

  /**
   * Bind the keyboard shortcuts. Read-only editors get find too, so these are
   * not read-only-mutable listeners.
   */
  public prepare(): void {
    if (this.config.find === false) {
      return;
    }

    const { wrapper } = this.Blok.UI.nodes;

    Find.instances.add(this);
    this.listeners.on(document, 'keydown', this.onDocumentKeydown, true);
    this.listeners.on(wrapper, 'pointerdown', this.markActive, true);
    this.listeners.on(wrapper, 'focusin', this.markActive, true);
    // Scroll does not bubble; capture sees inner scrollers (a wide table, a code block).
    this.listeners.on(wrapper, 'scroll', this.onInnerScroll, { capture: true, passive: true });
  }

  /**
   * Hide the replace controls in read-only mode.
   * @param readOnly - new read-only state
   */
  public toggleReadOnly(readOnly: boolean): void {
    this.bar?.setReadOnly(readOnly);
  }

  /**
   * Open the find bar.
   * @param withReplace - also open the replace row
   */
  public open(withReplace = false): void {
    const bar = this.ensureBar();
    const wasOpen = bar.isOpen;
    const prefill = this.selectedTextForPrefill();

    if (!wasOpen || prefill !== null) {
      const caret = this.caretRange();

      this.anchor = caret === null ? null : pointOf(caret, this.Blok.UI.nodes.redactor);
    }

    if (!wasOpen) {
      this.returnFocus = this.focusToReturn();
      this.startObserving();
    }

    syncPortalDirection(bar.element, { source: this.Blok.UI.nodes.wrapper });
    bar.open({
      query: prefill ?? undefined,
      replace: withReplace,
      readOnly: this.Blok.ReadOnly.isEnabled,
    });

    if (!wasOpen && prefill === null && bar.query !== '') {
      this.search({ reveal: true });
    }
  }

  /**
   * Close the find bar and select the current match, so typing replaces it.
   * When the reader already went back to the text, their caret stays put.
   */
  public close(): void {
    if (this.bar === null || !this.bar.isOpen) {
      return;
    }

    const current = this.ranges[this.active];
    const isInText = this.Blok.UI.nodes.redactor.contains(document.activeElement);

    this.bar.close();
    this.stopObserving();
    this.clearPaint();

    const back = this.returnFocus;

    this.returnFocus = null;

    if (isInText) {
      return;
    }

    if (current !== undefined && !current.collapsed) {
      editableHostOf(current)?.focus({ preventScroll: true });
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(current);

      return;
    }

    if (back !== null && back.element.isConnected) {
      back.element.focus({ preventScroll: true });

      if (back.range !== null) {
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(back.range);
      }
    }
  }

  /**
   * Move to the next (1) or previous (-1) match.
   * @param step - direction
   */
  public move(step: 1 | -1): void {
    if (this.ranges.length === 0) {
      return;
    }

    this.active = (this.active + step + this.ranges.length) % this.ranges.length;
    this.render({ reveal: true, pulse: true, expand: true });
  }

  /**
   * Replace the current match, then move on to the next one.
   * @param replacement - the new text
   */
  public replace(replacement: string): void {
    const current = this.ranges[this.active];

    if (this.Blok.ReadOnly.isEnabled || current === undefined) {
      return;
    }

    const host = editableHostOf(current);

    if (host === null) {
      this.move(1);

      return;
    }

    this.anchor = pointOf(replaceRangeText(current, replacement), this.Blok.UI.nodes.redactor);
    this.notifyInput([host]);
    this.search({ reveal: true, pulse: true, expand: true });
  }

  /**
   * Replace every match, as a single undo step.
   * @param replacement - the new text
   */
  public replaceAll(replacement: string): void {
    const editable = this.ranges.filter((range) => editableHostOf(range) !== null);

    if (this.Blok.ReadOnly.isEnabled || editable.length === 0) {
      return;
    }

    const hosts = new Set<HTMLElement>();
    const { BlockManager } = this.Blok;

    BlockManager.beginToolTransaction();
    try {
      // Last to first: an edit never moves a match that is still to come.
      editable.reverse().forEach((range) => {
        const host = editableHostOf(range);

        if (host !== null) {
          hosts.add(host);
          replaceRangeText(range, replacement);
        }
      });
      this.notifyInput([...hosts]);
    } finally {
      BlockManager.endToolTransaction();
    }

    this.search({ reveal: false });
  }

  /**
   * Tear down the bar, the paint and the shortcuts.
   */
  public destroy(): void {
    this.stopObserving();
    this.clearPaint();
    this.bar?.destroy();
    this.lens?.destroy();
    this.bar = null;
    this.lens = null;
    this.listeners.removeAll();
    Find.instances.delete(this);

    if (Find.lastActive === this) {
      Find.lastActive = null;
    }
  }

  private readonly onInnerScroll = (): void => {
    const current = this.ranges[this.active];

    if (this.isOpen && current !== undefined) {
      this.placeLens(current, false);
    }
  };

  private readonly markActive = (): void => {
    Find.lastActive = this;
  };

  private readonly onDocumentKeydown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent) || this.isDestroyed || !this.ownsKeyTarget(event.target)) {
      return;
    }

    const isMac = getUserOS().mac;
    const isFind = isModKey(event) && !event.altKey && !event.shiftKey && event.code === 'KeyF';
    const isReplace = isMac
      ? event.metaKey && event.altKey && event.code === 'KeyF'
      : event.ctrlKey && !event.altKey && !event.shiftKey && event.code === 'KeyH';

    // Pressed again inside the bar: the reader wants the browser's own find for the whole page.
    if (isFind && this.bar?.element.contains(event.target as Node) === true) {
      return;
    }

    if (isFind || isReplace) {
      event.preventDefault();
      event.stopPropagation();
      this.open(isReplace);

      return;
    }

    if (!this.isOpen) {
      return;
    }

    const isNext = (isModKey(event) && !event.altKey && event.code === 'KeyG') || event.key === 'F3';

    if (isNext) {
      event.preventDefault();
      this.move(event.shiftKey ? -1 : 1);
    }
  };

  /**
   * Whether a shortcut aimed at `target` is this editor's. A key inside another
   * editor, or in a host page's own field, is never ours; a key on <body> goes
   * to the editor used last.
   * @param target - the keydown target
   */
  private ownsKeyTarget(target: EventTarget | null): boolean {
    const { wrapper } = this.Blok.UI.nodes;

    const isInBar = target instanceof Node && this.bar?.element.contains(target) === true;

    if (target instanceof Node && (wrapper.contains(target) || isInBar)) {
      return true;
    }

    if (target instanceof Element) {
      const isInOtherEditor = target.closest(EDITOR_SELECTOR) !== null;
      const isHostField = target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null;

      if (isInOtherEditor || isHostField) {
        return false;
      }
    }

    return Find.instances.size < 2 || Find.lastActive === this;
  }

  private ensureBar(): FindBar {
    if (this.bar !== null) {
      return this.bar;
    }

    const { wrapper } = this.Blok.UI.nodes;
    const { I18n } = this.Blok;

    const hostConfig = typeof this.config.find === 'object' ? this.config.find : {};

    this.bar = new FindBar({
      t: (key, vars) => I18n.t(key, vars),
      isMac: getUserOS().mac,
      placement: hostConfig.placement,
      offset: hostConfig.offset,
      callbacks: {
        onQueryChange: () => this.scheduleSearch(QUERY_DEBOUNCE_MS, { reveal: true }, true),
        onOptionsChange: () => this.search({ reveal: true }),
        onNext: () => this.move(1),
        onPrevious: () => this.move(-1),
        onClose: () => this.close(),
        onReplace: (replacement) => this.replace(replacement),
        onReplaceAll: (replacement) => this.replaceAll(replacement),
        onSeek: (index) => {
          this.active = Math.max(0, Math.min(index, this.ranges.length - 1));
          this.render({ reveal: true, pulse: true, expand: true });
        },
      },
    });
    this.bar.setReadOnly(this.Blok.ReadOnly.isEnabled);
    // On <body>, like the browser's own find bar: fixed to the window, not the editor.
    // The scope attribute brings Blok's preflight reset and tokens along.
    this.bar.element.setAttribute('data-blok-interface', 'find');
    document.body.appendChild(this.bar.element);
    this.lens = new FindLens(wrapper);

    return this.bar;
  }

  /**
   * The selected text, when it is a short single-line selection in this editor.
   */
  private selectedTextForPrefill(): string | null {
    const selection = window.getSelection();

    if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const text = selection.toString().trim();
    const isInEditor = this.Blok.UI.nodes.redactor.contains(range.commonAncestorContainer);

    if (!isInEditor || text === '' || text.length > PREFILL_MAX_LENGTH || /[\n\r]/.test(text)) {
      return null;
    }

    return text;
  }

  private caretRange(): Range | null {
    const selection = window.getSelection();

    if (selection === null || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0).cloneRange();

    range.collapse(true);

    return this.Blok.UI.nodes.redactor.contains(range.startContainer) ? range : null;
  }

  private focusToReturn(): Find['returnFocus'] {
    const element = document.activeElement;
    const selection = window.getSelection();

    if (!(element instanceof HTMLElement) || element === document.body || this.bar?.element.contains(element) === true) {
      return null;
    }

    return {
      element,
      range: selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null,
    };
  }

  private startObserving(): void {
    const { redactor } = this.Blok.UI.nodes;

    this.observer = new MutationObserver(() => this.scheduleSearch(DOM_DEBOUNCE_MS, { reveal: false }, false));
    this.observer.observe(redactor, { childList: true, subtree: true, characterData: true });

    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.render({ reveal: false }));
      this.resizeObserver.observe(redactor);
    }
  }

  private stopObserving(): void {
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    this.observer = null;
    this.resizeObserver = null;

    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  }

  /**
   * Search after `delay`.
   * @param delay - wait in ms
   * @param options - render options
   * @param restart - push a pending search back. Query typing does; document
   * changes do not, or a peer typing without pause would stall the search.
   */
  private scheduleSearch(delay: number, options: RenderOptions, restart: boolean): void {
    if (this.searchTimer !== null && !restart) {
      return;
    }

    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
    }

    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.search(options);
    }, delay);
  }

  /**
   * Run the query again and keep the current match where the reader is.
   * @param options - render options
   * @param options.reveal - scroll to the current match
   * @param options.pulse - play the arrival animation
   */
  private search(options: RenderOptions): void {
    if (this.bar === null || !this.bar.isOpen) {
      return;
    }

    const { redactor } = this.Blok.UI.nodes;
    const anchor = this.anchor;
    const findOptions: FindOptions = this.bar.options;

    this.ranges = findRanges(redactor, this.bar.query, findOptions);

    const after = anchor === null ? this.ranges : this.ranges.filter((range) => startsAtOrAfter(range, anchor, redactor));
    // While typing, prefer a match the reader can see; hidden ones are one Enter away.
    const next = (options.expand === true ? undefined : after.find((range) => !this.isHidden(range))) ?? after[0] ?? this.ranges[0];

    this.active = next === undefined ? -1 : this.ranges.indexOf(next);
    this.render(options);
  }

  private render(options: RenderOptions): void {
    const current = this.ranges[this.active] ?? null;

    if (current !== null) {
      this.anchor = pointOf(current, this.Blok.UI.nodes.redactor);
    }

    if (current !== null && options.expand === true) {
      this.collapsedAncestors(current).reverse().forEach((parent) => parent.call('expand'));
    }

    paintFindHighlights(this, this.ranges, current);
    this.bar?.setResults({
      current: this.active,
      total: this.ranges.length,
      positions: this.positions(),
    });

    if (current === null) {
      this.lens?.hide();

      return;
    }

    if (options.reveal) {
      this.scrollIntoView(current);
    }
    this.placeLens(current, options.pulse === true);
  }

  /**
   * The collapsed toggles hiding the block that holds `range`, innermost first.
   * The block itself does not count: its own text shows even when collapsed.
   * @param range - a match
   */
  private collapsedAncestors(range: Range): Block[] {
    const { BlockManager } = this.Blok;
    const block = BlockManager.getBlockByChildNode(range.startContainer);
    const ancestorsOf = (parentId: string | null): Block[] => {
      const parent = parentId === null ? undefined : BlockManager.getBlockById(parentId);

      return parent === undefined ? [] : [parent, ...ancestorsOf(parent.parentId)];
    };

    return ancestorsOf(block?.parentId ?? null).filter((parent) =>
      findOwn(parent.holder, TOGGLE_STATE_SELECTOR)?.getAttribute('data-blok-toggle-open') === 'false'
    );
  }

  private isHidden(range: Range): boolean {
    return this.collapsedAncestors(range).length > 0;
  }

  private scrollIntoView(range: Range): void {
    const [rect] = rectsOf(range);

    if (rect === undefined) {
      return;
    }

    const parent = scrollParentOf(this.Blok.UI.nodes.wrapper);
    const view = parent?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
    const bar = this.barOver(rect);
    const isCovered = bar !== null && rect.bottom > bar.top && rect.top < bar.bottom;
    const isVisible = !isCovered && rect.top >= view.top + REVEAL_MARGIN && rect.bottom <= view.bottom - REVEAL_MARGIN;

    if (isVisible) {
      return;
    }

    const preferred = view.top + (view.bottom - view.top) * 0.4;
    const collides = bar !== null && preferred + rect.height > bar.top - REVEAL_MARGIN && preferred < bar.bottom + REVEAL_MARGIN;
    const belowBar = bar === null ? preferred : bar.bottom + REVEAL_MARGIN;
    const fitsBelow = belowBar + rect.height <= view.bottom - REVEAL_MARGIN;
    const aboveBar = bar === null ? preferred : bar.top - REVEAL_MARGIN - rect.height;
    const clearOfBar = fitsBelow ? belowBar : aboveBar;
    const target = collides ? clearOfBar : preferred;
    const behavior: ScrollBehavior = prefersReducedMotion() ? 'instant' : 'smooth';

    (parent ?? window).scrollBy({ top: rect.top - target, behavior });
  }

  /**
   * The find bar's box when it shares columns with `rect`, else null. The bar
   * is fixed to the window, so it stays put while the page scrolls under it.
   * @param rect - the match's box
   */
  private barOver(rect: DOMRect): DOMRect | null {
    const box = this.bar?.element.getBoundingClientRect();

    if (box === undefined || box.height === 0 || rect.right < box.left || rect.left > box.right) {
      return null;
    }

    return box;
  }

  private placeLens(range: Range, pulse: boolean): void {
    const base = this.Blok.UI.nodes.wrapper.getBoundingClientRect();
    const rects: Rect[] = rectsOf(range).map((rect) => ({
      top: rect.top - base.top,
      left: rect.left - base.left,
      width: rect.width,
      height: rect.height,
    }));

    if (rects.length === 0) {
      this.lens?.hide();

      return;
    }

    this.lens?.moveTo(rects, { pulse });
  }

  /**
   * Each match's place in the document, 0 (top) to 1 (bottom), for the match
   * map. A match inside a collapsed toggle takes its nearest visible ancestor's.
   */
  private positions(): number[] {
    const box = this.Blok.UI.nodes.redactor.getBoundingClientRect();

    if (box.height === 0) {
      return this.ranges.map((_, index) => (index + 0.5) / this.ranges.length);
    }

    return this.ranges.map((range) => {
      const [rect] = rectsOf(range);
      const top = rect?.top ?? this.visibleAncestorTop(range.startContainer);

      return Math.min(1, Math.max(0, (top - box.top) / box.height));
    });
  }

  private visibleAncestorTop(node: Node): number {
    const element = node.parentElement;

    if (element === null) {
      return 0;
    }

    const [rect] = element.getClientRects();

    return rect?.top ?? this.visibleAncestorTop(element);
  }

  /**
   * Tell the edited hosts their text changed, as typing would: tools that
   * derive state from `input` (code highlighting, empty markers) catch up.
   * @param hosts - editable hosts that were edited
   */
  private notifyInput(hosts: HTMLElement[]): void {
    hosts.forEach((host) => {
      // Not bubbling: the editor's own input handlers read the caret, which is in the find field.
      host.dispatchEvent(new InputEvent('input', { bubbles: false, inputType: 'insertReplacementText' }));
    });
  }

  private clearPaint(): void {
    clearFindHighlights(this);
    this.lens?.hide();
    this.ranges = [];
    this.active = -1;
  }
}
