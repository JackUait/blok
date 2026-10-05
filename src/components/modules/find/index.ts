/**
 * Find in page: Cmd/Ctrl+F opens Blok's own find bar.
 *
 * Search runs over the page DOM (see text-index.ts), so it sees host text,
 * read-only content and the children of collapsed toggles. Matches are painted with the
 * Custom Highlight API and never wrapped in markup, so finding never edits the
 * document. Replacing does: it edits text nodes the way typing does.
 */
import { Module } from '../../__module';
import type { Block } from '../../block';
import { getUserOS } from '../../utils/browser';
import { hiddenAncestors } from '../blockManager/new-block-placement';
import { syncPortalDirection } from '../../utils/portal-direction';
import { prefersReducedMotion } from '../../utils/reduced-motion';
import { FindBar } from './find-bar';
import { hopSourceFromRange, type HopSource } from './find-motion';
import { FindLens } from './find-lens';
import { clearFindHighlights, paintFindHighlights } from './find-highlight';
import type { FindOptions } from './match-text';
import { isPreviewMutation, ReplacePreview } from './replace-preview';
import { editableHostOf, replaceRangeText } from './replace-text';
import { findRanges } from './text-index';
import type { TextPoint } from './text-point';
import { pointOf, startsAtOrAfter } from './text-point';

const EDITOR_SELECTOR = '[data-blok-testid="blok-editor"]';
const editorOf = (node: Node): Element | null =>
  (node instanceof Element ? node : node.parentElement)?.closest(EDITOR_SELECTOR) ?? null;
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
  /** Disabled Find editors still own matches in collapsed toggles. */
  private static readonly allInstances = new Set<Find>();
  private static lastActive: Find | null = null;

  private bar: FindBar | null = null;
  private lens: FindLens | null = null;
  private preview: ReplacePreview | null = null;
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
    Find.allInstances.add(this);

    if (this.config.find === false) {
      return;
    }

    const { wrapper } = this.Blok.UI.nodes;

    Find.instances.add(this);
    this.listeners.on(document, 'keydown', this.onDocumentKeydown, true);
    this.listeners.on(document, 'keydown', this.onHostFieldKeydown);
    this.listeners.on(wrapper, 'pointerdown', this.markActive, true);
    this.listeners.on(wrapper, 'focusin', this.markActive, true);
    // Scroll does not bubble; capture sees scrollers outside this editor too.
    this.listeners.on(document, 'scroll', this.onPageScroll, { capture: true, passive: true });
    this.listeners.on(window, 'scroll', this.onPageScroll, { passive: true });
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
    // Before bar.open() takes focus and the search reveal scrolls.
    const hop = prefill === null ? null : this.hopSource(prefill);

    if (!wasOpen || prefill !== null) {
      const caret = this.caretRange();

      this.anchor = caret === null ? null : pointOf(caret, document.body);
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
      hop,
    });

    // Search now, not after the typing debounce: until then the bar would show "No results".
    if (bar.query !== '' && (!wasOpen || prefill !== null)) {
      this.cancelSearch();
      this.search({ reveal: true });
    }
  }

  /**
   * Close the find bar and select a match in this editor, so typing replaces it.
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

    if (current !== undefined && !current.collapsed && this.ownsRange(current)) {
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

    const host = this.canReplace(current) ? editableHostOf(current) : null;

    if (host === null) {
      this.move(1);

      return;
    }

    this.anchor = pointOf(replaceRangeText(current, replacement), document.body);
    this.notifyInput([host]);
    this.search({ reveal: true, pulse: true, expand: true });
  }

  /**
   * Replace every match, as a single undo step.
   * @param replacement - the new text
   */
  public replaceAll(replacement: string): void {
    const editable = this.ranges.filter((range) => this.canReplace(range));

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
    Find.allInstances.delete(this);

    if (Find.lastActive === this) {
      Find.lastActive = null;
    }
  }

  private readonly onPageScroll = (): void => {
    const current = this.ranges[this.active];

    if (this.isOpen && current !== undefined) {
      this.placeLens(this.onScreen(current), false);
    }
  };

  private readonly markActive = (): void => {
    Find.lastActive = this;
  };

  private readonly onDocumentKeydown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent) || this.isDestroyed || !this.ownsKeyTarget(event.target, false)) {
      return;
    }

    this.handleShortcut(event);
  };

  /** Bubble phase, so a host field that handles the shortcut itself keeps it. */
  private readonly onHostFieldKeydown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent) || this.isDestroyed || event.defaultPrevented || !this.ownsKeyTarget(event.target, true)) {
      return;
    }

    this.handleShortcut(event);
  };

  private handleShortcut(event: KeyboardEvent): void {
    const isMac = getUserOS().mac;
    const isFind = isModKey(event) && !event.altKey && !event.shiftKey && event.code === 'KeyF';
    const isReplace = isMac
      ? event.metaKey && event.altKey && event.code === 'KeyF'
      : event.ctrlKey && !event.altKey && !event.shiftKey && event.code === 'KeyH';

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
  }

  /**
   * Whether a shortcut aimed at `target` is this editor's. A key inside another
   * editor is never ours; a key on <body> or in a host page's own field goes to
   * the editor used last.
   * @param target - the keydown target
   * @param inHostField - true for the bubble-phase pass, which only takes host fields
   */
  private ownsKeyTarget(target: EventTarget | null, inHostField: boolean): boolean {
    const { wrapper } = this.Blok.UI.nodes;

    const isInBar = target instanceof Node && this.bar?.element.contains(target) === true;

    if (isInBar) {
      return !inHostField;
    }

    if (target instanceof Node) {
      const editor = editorOf(target);

      if (editor !== null) {
        return !inHostField && editor === wrapper;
      }

      if (wrapper.contains(target)) {
        return !inHostField;
      }
    }

    const isHostField = target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null;

    if (isHostField !== inHostField) {
      return false;
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
        onReplaceChange: () => {
          if (this.bar?.isOpen === true) {
            this.showPreview();
            this.render({ reveal: false });
          }
        },
      },
    });
    this.bar.setReadOnly(this.Blok.ReadOnly.isEnabled);
    // On <body>, like the browser's own find bar: fixed to the window, not the editor.
    // The scope attribute brings Blok's preflight reset and tokens along.
    this.bar.element.setAttribute('data-blok-interface', 'find');
    document.body.appendChild(this.bar.element);
    this.lens = new FindLens(document.documentElement, wrapper);
    this.preview = new ReplacePreview(this.Blok.UI.nodes.redactor);

    return this.bar;
  }

  private ownsRange(range: Range): boolean {
    const { wrapper, redactor } = this.Blok.UI.nodes;

    return redactor.contains(range.commonAncestorContainer) &&
      editorOf(range.startContainer) === wrapper &&
      editorOf(range.endContainer) === wrapper;
  }

  /** In this editor's editable text. Host text, read-only content and other editors are not. */
  private canReplace(range: Range): boolean {
    return this.ownsRange(range) && editableHostOf(range) !== null;
  }

  /** Host page text: outside every editor and outside the bar. */
  private isHostNode(node: Node): boolean {
    return editorOf(node) === null && this.bar?.element.contains(node) !== true;
  }

  /** A selection Find may start from: in this editor or in the host page, never in another editor. */
  private takesRange(range: Range): boolean {
    return this.ownsRange(range) || (this.isHostNode(range.startContainer) && this.isHostNode(range.endContainer));
  }

  /**
   * The selected text, when it is a short single-line selection in this editor or the host page.
   */
  private selectedTextForPrefill(): string | null {
    const field = document.activeElement;
    const selection = window.getSelection();
    // An input's selected text is not part of the document selection.
    const isHostTextField = (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && this.isHostNode(field);

    if (!isHostTextField && (selection === null || selection.rangeCount === 0 || selection.isCollapsed || !this.takesRange(selection.getRangeAt(0)))) {
      return null;
    }

    const text = (isHostTextField
      ? field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0)
      : selection?.toString() ?? '').trim();

    if (text === '' || text.length > PREFILL_MAX_LENGTH || /[\n\r]/.test(text)) {
      return null;
    }

    return text;
  }

  /** Where the prefilled word sits on screen. A host input's selection has no range to measure. */
  private hopSource(text: string): HopSource | null {
    const field = document.activeElement;
    const selection = window.getSelection();

    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || selection === null || selection.rangeCount === 0) {
      return null;
    }

    return hopSourceFromRange(selection.getRangeAt(0), text);
  }

  private caretRange(): Range | null {
    const selection = window.getSelection();

    if (selection === null || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0).cloneRange();

    range.collapse(true);

    return this.takesRange(range) ? range : null;
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
    this.observer = new MutationObserver((records) => {
      const isOwnMutation = (record: MutationRecord): boolean => {
        const target = record.target instanceof Element ? record.target : record.target.parentElement;

        return isPreviewMutation(record) || (target?.closest('[data-blok-interface="find"]') ?? null) !== null;
      };

      if (!records.every(isOwnMutation)) {
        this.scheduleSearch(DOM_DEBOUNCE_MS, { reveal: false }, false);
      }
    });
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.render({ reveal: false }));
      this.resizeObserver.observe(document.body);
    }
  }

  private stopObserving(): void {
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    this.observer = null;
    this.resizeObserver = null;
    this.cancelSearch();
  }

  private cancelSearch(): void {
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

    const anchor = this.anchor;
    const findOptions: FindOptions = this.bar.options;

    this.ranges = findRanges(document.body, this.bar.query, findOptions);

    const after = anchor === null ? this.ranges : this.ranges.filter((range) => startsAtOrAfter(range, anchor, document.body));
    // While typing, prefer a match the reader can see; hidden ones are one Enter away.
    const next = (options.expand === true ? undefined : after.find((range) => !this.isHidden(range))) ?? after[0] ?? this.ranges[0];

    this.active = next === undefined ? -1 : this.ranges.indexOf(next);
    this.showPreview();
    this.render(options);
  }

  /**
   * Show the replacement in the text while one is typed. Not in render(): the
   * preview resizes the redactor, and a resize renders again.
   */
  private showPreview(): void {
    const bar = this.bar;

    if (bar === null || this.Blok.ReadOnly.isEnabled || bar.replacement === '') {
      this.preview?.clear();

      return;
    }

    this.preview?.show(this.ranges.filter((range) => this.ownsRange(range)), bar.query, bar.options, bar.replacement);
  }

  /**
   * Where a match is on screen: in the preview while one is shown.
   * @param range - a real match
   */
  private onScreen(range: Range): Range {
    return this.preview?.rangeFor(range) ?? range;
  }

  private render(options: RenderOptions): void {
    const current = this.ranges[this.active] ?? null;

    if (current !== null) {
      this.anchor = pointOf(current, document.body);
    }

    if (current !== null && options.expand === true) {
      this.collapsedAncestors(current).reverse().forEach((parent) => parent.call('expand'));
    }

    paintFindHighlights(this, this.ranges.map((range) => this.onScreen(range)), current === null ? null : this.onScreen(current));
    this.bar?.setResults({
      current: this.active,
      total: this.ranges.length,
      replaceable: this.ranges.filter((range) => this.canReplace(range)).length,
      currentReplaceable: current !== null && this.canReplace(current),
    });

    if (current === null) {
      this.lens?.hide();

      return;
    }

    if (options.reveal) {
      this.scrollIntoView(this.onScreen(current));
    }
    this.placeLens(this.onScreen(current), options.pulse === true);
  }

  /**
   * The ancestors hiding the block that holds `range`. See {@link hiddenAncestors}.
   * @param range - a match
   */
  private collapsedAncestors(range: Range): Block[] {
    const editor = editorOf(range.startContainer);
    const owner = Array.from(Find.allInstances).find((instance) => instance.Blok.UI.nodes.wrapper === editor);
    const BlockManager = owner?.Blok.BlockManager;
    const block = BlockManager?.getBlockByChildNode(range.startContainer);

    if (BlockManager === undefined || block === undefined) {
      return [];
    }

    return hiddenAncestors(block, (id) => BlockManager.getBlockById(id));
  }

  private isHidden(range: Range): boolean {
    return this.collapsedAncestors(range).length > 0;
  }

  private scrollIntoView(range: Range): void {
    const [rect] = rectsOf(range);

    if (rect === undefined) {
      return;
    }

    const element = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const scrollStart = element?.closest(EDITOR_SELECTOR) ?? element ?? this.Blok.UI.nodes.wrapper;
    const parent = scrollParentOf(scrollStart);
    const view = parent?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
    const behavior: ScrollBehavior = prefersReducedMotion() ? 'instant' : 'smooth';

    const bar = this.barOver(rect);
    const isCovered = bar !== null && rect.bottom > bar.top && rect.top < bar.bottom;
    const isVisible = !isCovered &&
      rect.top >= Math.max(view.top, 0) + REVEAL_MARGIN &&
      rect.bottom <= Math.min(view.bottom, window.innerHeight) - REVEAL_MARGIN;

    if (isVisible) {
      return;
    }

    if (parent !== null && element !== null && (view.top < 0 || view.bottom > window.innerHeight)) {
      element.scrollIntoView({ block: 'center', behavior });

      return;
    }

    const preferred = view.top + (view.bottom - view.top) * 0.4;
    const collides = bar !== null && preferred + rect.height > bar.top - REVEAL_MARGIN && preferred < bar.bottom + REVEAL_MARGIN;
    const belowBar = bar === null ? preferred : bar.bottom + REVEAL_MARGIN;
    const fitsBelow = belowBar + rect.height <= view.bottom - REVEAL_MARGIN;
    const aboveBar = bar === null ? preferred : bar.top - REVEAL_MARGIN - rect.height;
    const clearOfBar = fitsBelow ? belowBar : aboveBar;
    const target = collides ? clearOfBar : preferred;

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
    const rects: Rect[] = rectsOf(range).map((rect) => ({
      top: rect.top,
      left: rect.left,
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
    this.preview?.clear();
    clearFindHighlights(this);
    this.lens?.hide();
    this.ranges = [];
    this.active = -1;
  }
}
