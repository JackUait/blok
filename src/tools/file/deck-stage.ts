import type { DeckOptions, DeckView } from './pptx/viewer';
import type { PreviewChrome } from './preview-chrome';
import { counted, fill } from './preview-labels';

type OpenDeck = (
  buf: ArrayBuffer,
  container: HTMLElement,
  isCancelled?: () => boolean,
  options?: DeckOptions,
) => Promise<DeckView>;

/** Width of a filmstrip thumbnail, in px. */
const THUMB_WIDTH = 112;
/** Room kept around the slide on the stage, in px: both sides, then top and bottom. */
const STAGE_GUTTER_X = 48;
const STAGE_GUTTER_Y = 40;
const SLIDE_MS = 380;
const SLIDE_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';

function el(className: string, role: string): HTMLElement {
  const node = document.createElement('div');
  node.className = className;
  node.setAttribute('data-role', role);

  return node;
}

/** Child indexes that lead from `root` down to `node`. */
function pathTo(root: Element, node: Element): number[] {
  const path: number[] = [];
  const walk = (current: Element): void => {
    const parent = current.parentElement;
    if (current === root || parent === null) {
      return;
    }
    path.unshift(Array.prototype.indexOf.call(parent.children, current));
    walk(parent);
  };
  walk(node);

  return path;
}

/** Whether `node`, or something around it inside `root`, is a link the slide drew. */
function linkAt(root: Element, node: Element): Element | null {
  const link = node.closest('[role="link"], a');
  if (link !== null && root.contains(link)) {
    return link;
  }
  const pointer = (current: Element | null): Element | null => {
    if (current === null || !root.contains(current)) {
      return null;
    }

    return current instanceof HTMLElement && current.style.cursor === 'pointer' ? current : pointer(current.parentElement);
  };

  return pointer(node);
}

/**
 * A deck as a stage and a filmstrip. The strip holds the real slides, drawn at
 * thumbnail size; the stage shows a copy of the current one, fitted to the
 * room it has. The copy is redrawn when its slide changes (a picture that
 * lands late), and a click on a link in it goes to the real link.
 */
export async function openDeckStage(
  buf: ArrayBuffer,
  container: HTMLElement,
  chrome: PreviewChrome,
  open: OpenDeck,
): Promise<DeckView> {
  const { labels } = chrome;
  const stage = el('blok-file-preview-stage', 'file-preview-stage');
  const frame = el('blok-file-preview-stage-frame', 'file-preview-stage-frame');
  const film = el('blok-file-preview-film', 'file-preview-film');
  stage.appendChild(frame);
  container.replaceChildren(stage, film);

  const cards: HTMLElement[] = [];
  const thumbs: HTMLElement[] = [];
  const size = { width: 0, height: 0 };
  const state: { current: number; sheet: HTMLElement | null; zoom: number; queued: boolean; destroyed: boolean } = {
    current: -1, sheet: null, zoom: 1, queued: false, destroyed: false,
  };
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const copyOf = (card: HTMLElement): HTMLElement | null => {
    const slide = card.firstElementChild;
    if (!(slide instanceof HTMLElement)) {
      return null;
    }
    const copy = slide.cloneNode(true) as HTMLElement;
    copy.style.transformOrigin = 'top left';
    copy.style.transform = `scale(${state.zoom})`;

    return copy;
  };

  const fillSheet = (sheet: HTMLElement, card: HTMLElement): void => {
    const copy = copyOf(card);
    sheet.replaceChildren(...(copy === null ? [] : [copy]));
  };

  const watcher = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => {
    if (state.queued) {
      return;
    }
    state.queued = true;
    queueMicrotask(() => {
      state.queued = false;
      const card = cards[state.current];
      if (!state.destroyed && state.sheet !== null && card !== undefined) {
        fillSheet(state.sheet, card);
      }
    });
  });

  const fit = (): void => {
    const zoom = Math.min((stage.clientWidth - STAGE_GUTTER_X) / size.width, (stage.clientHeight - STAGE_GUTTER_Y) / size.height);
    state.zoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    frame.style.width = `${size.width * state.zoom}px`;
    frame.style.height = `${size.height * state.zoom}px`;
    frame.querySelectorAll<HTMLElement>('[data-role="file-preview-stage-sheet"] > *').forEach((copy) => {
      copy.style.setProperty('transform', `scale(${state.zoom})`);
    });
  };

  const show = (index: number): void => {
    const card = cards[index];
    if (card === undefined || index === state.current) {
      return;
    }
    const direction = index > state.current ? 1 : -1;
    const old = state.sheet;
    const sheet = el('blok-file-preview-stage-sheet', 'file-preview-stage-sheet');
    fillSheet(sheet, card);
    frame.appendChild(sheet);
    // The slide moves sideways as a solid sheet: no fade, so no see-through frame.
    const slides = old !== null && !reduceMotion && typeof sheet.animate === 'function';
    if (slides) {
      const timing = { duration: SLIDE_MS, easing: SLIDE_EASING };
      sheet.animate([{ transform: `translateX(${direction * 100}%)` }, { transform: 'none' }], timing);
      old.animate([{ transform: 'none' }, { transform: `translateX(${direction * -100}%)` }], timing).onfinish = () => old.remove();
    } else {
      old?.remove();
    }
    state.current = index;
    state.sheet = sheet;
    thumbs.forEach((thumb, i) => thumb.setAttribute('aria-current', String(i === index)));
    thumbs[index]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    watcher?.disconnect();
    watcher?.observe(card, { subtree: true, childList: true, attributes: true, characterData: true });
  };

  const wrap = (card: HTMLElement, index: number): HTMLElement => {
    const thumb = el('blok-file-preview-thumb', 'file-preview-thumb');
    thumb.setAttribute('role', 'button');
    thumb.tabIndex = 0;
    thumb.setAttribute('aria-label', fill(labels.slideN, { number: index + 1 }));
    thumb.setAttribute('aria-current', 'false');
    // In the strip a slide is a picture of itself: its links take no clicks or focus.
    card.setAttribute('inert', '');
    const number = document.createElement('span');
    number.setAttribute('data-role', 'file-preview-thumb-number');
    number.textContent = String(index + 1);
    thumb.append(card, number);
    thumb.addEventListener('click', () => show(index));
    thumb.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        show(index);
      }
    });
    cards[index] = card;
    thumbs[index] = thumb;
    if (index === 0) {
      show(0);
    }

    return thumb;
  };

  const deck = await open(buf, film, chrome.isClosed, { fitWidth: () => THUMB_WIDTH, wrap, onGoToSlide: show });
  Object.assign(size, { width: deck.width, height: deck.height });

  frame.addEventListener('click', (event) => {
    const copy = state.sheet?.firstElementChild;
    const real = cards[state.current]?.firstElementChild;
    const link = copy instanceof Element && event.target instanceof Element ? linkAt(copy, event.target) : null;
    if (link !== null && copy instanceof Element && real instanceof Element) {
      const twin = pathTo(copy, link).reduce<Element | undefined>((node, child) => node?.children[child], real);
      twin?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      return;
    }
    const box = frame.getBoundingClientRect();
    show(state.current + (event.clientX - box.left > box.width / 2 ? 1 : -1));
  });
  chrome.onKey((event) => {
    if (event.key === 'ArrowRight') {
      show(state.current + 1);
    } else if (event.key === 'ArrowLeft') {
      show(state.current - 1);
    }
  });

  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
  resize?.observe(stage);
  fit();
  if (deck.count > 0) {
    chrome.setFacts([counted(deck.count, labels.slidesOne, labels.slides)]);
  }

  return {
    count: deck.count,
    width: deck.width,
    height: deck.height,
    destroy: () => {
      state.destroyed = true;
      watcher?.disconnect();
      resize?.disconnect();
      deck.destroy();
      container.replaceChildren();
    },
  };
}
