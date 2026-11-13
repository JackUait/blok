import { IconChevronDown, IconCross } from '../../../components/icons';
import { clearFindHighlights, paintFindHighlights } from '../../../components/modules/find/find-highlight';
import { registerLayer } from '../../../components/utils/dismissable-layer';
import { findTextMatches } from '../../../shared/text-match';
import { hintButton, pillDivider, pillText, type PreviewChrome } from '../preview-chrome';
import type { PdfDocumentLike } from './pdf-types';

/** What find needs from the page view. */
export interface PdfFindView {
  scroller: HTMLElement;
  /** The box that holds a page's text layer. */
  pageBox(index: number): HTMLElement | undefined;
  currentPage(): number;
  isVisible(index: number): boolean;
  scrollToPage(index: number): void;
}

/** A page's text as find reads it, with where each text-layer span sits in it. */
interface PageText {
  text: string;
  /** One per item with text, in the order pdf.js's TextLayer makes its spans. */
  pieces: Array<{ start: number; end: number }>;
}

interface Match {
  page: number;
  start: number;
  end: number;
}

/** Without requestIdleCallback (Safari), a short task stands in for an idle period. */
const IDLE_SLICE_MS = 8;
/** An idle callback runs by then even on a busy page, so the search keeps moving. */
const IDLE_TIMEOUT_MS = 200;
const TEXT_SPANS = '.blok-file-preview-pdf-text span[role="presentation"]';

function whenIdle(run: (deadline: IdleDeadline) => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });

    return;
  }
  setTimeout(() => {
    const end = performance.now() + IDLE_SLICE_MS;
    run({ didTimeout: false, timeRemaining: () => Math.max(0, end - performance.now()) });
  }, 0);
}

const onNextFrame = (run: () => void): void => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(run);
  } else {
    setTimeout(run, 0);
  }
};

/**
 * Joins the items of a page's getTextContent() the way the text layer lays
 * them out: an item with text is a span; a line end is a newline between.
 */
function readPageText(content: unknown): PageText {
  const items: unknown[] = content instanceof Object && 'items' in content && Array.isArray(content.items) ? content.items : [];

  const read: PageText = { text: '', pieces: [] };
  items.forEach((item) => {
    // Marked-content items carry no `str`; the text layer makes no span for them.
    if (!(item instanceof Object) || !('str' in item) || typeof item.str !== 'string') {
      return;
    }
    if (item.str !== '') {
      read.pieces.push({ start: read.text.length, end: read.text.length + item.str.length });
      read.text += item.str;
    }
    if ('hasEOL' in item && item.hasEOL === true) {
      read.text += '\n';
    }
  });

  return read;
}

/** A DOM range over the spans a match covers, or null when the layer does not line up. */
function rangeOf(match: Match, text: PageText, spans: Element[]): Range | null {
  if (spans.length !== text.pieces.length) {
    return null;
  }
  const first = text.pieces.findIndex((piece) => piece.end > match.start);
  const last = text.pieces.reduce((found, piece, i) => (piece.start < match.end ? i : found), -1);
  const startNode = spans[first]?.firstChild;
  const endNode = spans[last]?.firstChild;
  if (first === -1 || last < first || startNode == null || endNode == null) {
    return null;
  }
  const range = document.createRange();
  range.setStart(startNode, Math.max(0, match.start - text.pieces[first].start));
  range.setEnd(endNode, Math.min(match.end, text.pieces[last].end) - text.pieces[last].start);

  return range;
}

/**
 * Cmd/Ctrl+F in an open PDF: a find field in the pager pill. Page text is
 * read once, a page per idle callback, and matched in idle chunks, so a long
 * PDF never holds the main thread. Matches paint in the text layer of the
 * pages that are drawn.
 */
export function mountPdfFind(
  doc: PdfDocumentLike,
  view: PdfFindView,
  pill: HTMLElement,
  chrome: PreviewChrome,
): { destroy(): void } {
  const { labels } = chrome;
  const owner = {};
  const texts: Array<PageText | undefined> = [];
  const state: {
    query: string;
    /** Bumped by every new search and by close; a step that sees another number stops. */
    gen: number;
    matches: Match[];
    active: Match | null;
    done: boolean;
    paintQueued: boolean;
    destroyed: boolean;
    open: { group: HTMLElement; input: HTMLInputElement; count: HTMLElement; unlayer: () => void; back: Element | null } | null;
  } = { query: '', gen: 0, matches: [], active: null, done: true, paintQueued: false, destroyed: false, open: null };

  const showCount = (): void => {
    const count = state.open?.count;
    if (count === undefined) {
      return;
    }
    if (state.active !== null) {
      // Numbers and a slash read the same in every locale, like the zoom's "100%".
      count.textContent = `${state.matches.indexOf(state.active) + 1} / ${state.matches.length}`;
    } else {
      count.textContent = state.done && state.query.trim() !== '' ? labels.findNoResults : '';
    }
  };

  const paint = (): void => {
    state.paintQueued = false;
    if (state.destroyed || state.open === null) {
      return;
    }
    const ranges = new Map<Match, Range>();
    const pages = new Set(state.matches.map((match) => match.page));
    pages.forEach((page) => {
      const text = texts[page];
      const spans = Array.from(view.pageBox(page)?.querySelectorAll(TEXT_SPANS) ?? []);
      if (text === undefined || spans.length === 0) {
        return;
      }
      state.matches.filter((match) => match.page === page).forEach((match) => {
        const range = rangeOf(match, text, spans);
        if (range !== null) {
          ranges.set(match, range);
        }
      });
    });
    const active = state.active === null ? null : ranges.get(state.active) ?? null;
    paintFindHighlights(owner, [...ranges.values()], active);
  };

  const schedulePaint = (): void => {
    if (!state.paintQueued) {
      state.paintQueued = true;
      onNextFrame(paint);
    }
  };

  // Text layers fill in after a page draws, and a zoom swaps them for new ones.
  const layers = new MutationObserver(schedulePaint);

  /** Brings the current match on screen: its page first, then the words within it. */
  const reveal = (): void => {
    const match = state.active;
    if (match === null) {
      return;
    }
    if (!view.isVisible(match.page)) {
      view.scrollToPage(match.page);

      return;
    }
    const text = texts[match.page];
    const spans = Array.from(view.pageBox(match.page)?.querySelectorAll(TEXT_SPANS) ?? []);
    const range = text === undefined ? null : rangeOf(match, text, spans);
    if (range === null || typeof range.getBoundingClientRect !== 'function') {
      return;
    }
    const box = range.getBoundingClientRect();
    const frame = view.scroller.getBoundingClientRect();
    if (box.top < frame.top || box.bottom > frame.bottom) {
      view.scroller.scrollBy({ top: box.top - frame.top - frame.height / 3, behavior: 'smooth' });
    }
  };

  const select = (match: Match): void => {
    state.active = match;
    showCount();
    reveal();
    schedulePaint();
  };

  const move = (step: number): void => {
    const total = state.matches.length;
    if (total === 0 || state.active === null) {
      return;
    }
    select(state.matches[(state.matches.indexOf(state.active) + step + total) % total]);
  };

  /** Adds a page's matches, keeping the list in reading order. */
  const take = (page: number, query: string): void => {
    const text = texts[page];
    if (text === undefined) {
      return;
    }
    const found = findTextMatches(text.text, query).map(({ start, end }) => ({ page, start, end }));
    if (found.length === 0) {
      return;
    }
    const at = state.matches.findIndex((match) => match.page > page);
    state.matches.splice(at === -1 ? state.matches.length : at, 0, ...found);
    if (state.active === null) {
      select(found[0]);
    } else {
      showCount();
      schedulePaint();
    }
  };

  const search = (query: string): void => {
    state.gen += 1;
    const gen = state.gen;
    const live = (): boolean => !state.destroyed && state.gen === gen;
    state.query = query;
    state.matches = [];
    state.active = null;
    state.done = query.trim() === '';
    showCount();
    schedulePaint();
    if (state.done) {
      return;
    }
    // From the page being read to the end, then round from the start.
    const first = view.currentPage();
    const order = Array.from({ length: doc.numPages }, (_, i) => (first + i) % doc.numPages);
    const cursor = { at: 0 };

    const finish = (): void => {
      state.done = true;
      showCount();
    };

    const step = (deadline: IdleDeadline): void => {
      if (!live()) {
        return;
      }
      while (cursor.at < order.length) {
        const page = order[cursor.at];
        if (texts[page] === undefined) {
          // The read runs in the worker; the next chunk starts once it is back.
          doc.getPage(page + 1)
            .then((proxy) => proxy.getTextContent())
            .then((content) => {
              texts[page] ??= readPageText(content);
            }, () => {
              // A page whose text cannot be read has nothing to find.
              texts[page] ??= { text: '', pieces: [] };
            })
            .then(() => {
              if (live()) {
                take(page, query);
                cursor.at += 1;
                whenIdle(step);
              }
            }, () => undefined);

          return;
        }
        take(page, query);
        cursor.at += 1;
        if (deadline.timeRemaining() <= 0) {
          break;
        }
      }
      if (cursor.at < order.length) {
        whenIdle(step);
      } else {
        finish();
      }
    };
    whenIdle(step);
  };

  const close = (): void => {
    const open = state.open;
    if (open === null) {
      return;
    }
    state.open = null;
    state.gen += 1;
    open.unlayer();
    open.group.remove();
    layers.disconnect();
    clearFindHighlights(owner);
    if (open.back instanceof HTMLElement && open.back.isConnected) {
      open.back.focus();
    }
  };

  const open = (): void => {
    if (state.open !== null) {
      state.open.input.focus();
      state.open.input.select();

      return;
    }
    const group = document.createElement('span');
    group.className = 'blok-file-preview-find';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'blok-file-preview-find-field';
    input.setAttribute('data-role', 'file-preview-find');
    input.setAttribute('data-blok-field', 'text');
    input.setAttribute('aria-label', labels.findPlaceholder);
    input.placeholder = labels.findPlaceholder;
    const count = pillText('file-preview-find-count');
    count.setAttribute('aria-live', 'polite');
    const prev = hintButton(IconChevronDown, labels.findPrevious, 'preview-find-prev', () => move(-1));
    const next = hintButton(IconChevronDown, labels.findNext, 'preview-find-next', () => move(1));
    group.append(
      pillDivider(),
      input,
      count,
      prev,
      next,
      hintButton(IconCross, labels.findClose, 'preview-find-close', close),
    );
    input.addEventListener('input', () => search(input.value));
    input.addEventListener('keydown', (event) => {
      // This Enter ends an IME composition; it is not meant for find.
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        move(event.shiftKey ? -1 : 1);
      }
    });
    const back = document.activeElement;
    pill.appendChild(group);
    // Escape closes find before it reaches the modal.
    const unlayer = registerLayer({ element: group, escape: true, outside: false, onDismiss: close });
    state.open = { group, input, count, unlayer, back };
    layers.observe(view.scroller, { childList: true, subtree: true });
    input.focus();
    if (state.query !== '') {
      input.value = state.query;
      input.select();
      search(state.query);
    }
  };

  chrome.onKey((event) => {
    if (state.destroyed) {
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.altKey && !event.shiftKey && event.code === 'KeyF') {
      event.preventDefault();
      open();
    }
  });

  const destroy = (): void => {
    if (state.destroyed) {
      return;
    }
    close();
    state.destroyed = true;
  };
  chrome.onRelease(destroy);

  return { destroy };
}
