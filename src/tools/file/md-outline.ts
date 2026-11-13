import type { PreviewChrome } from './preview-chrome';

/** How far above a heading a jump lands, so the heading is not flush with the edge. */
const JUMP_PAD = 16;
/** A heading is "in view" once it is within this share of the view from its top. */
const CURRENT_LINE = 0.35;

/**
 * The outline rail of a rendered document: a short dash per heading on the
 * body's edge, opening into the heading list on hover or keyboard focus. It marks the heading in
 * view and scrolls to the one that is pressed. Fewer than two headings: no rail.
 */
export function mountOutline(view: HTMLElement, chrome: PreviewChrome): HTMLElement | null {
  const headings = Array.from(view.querySelectorAll<HTMLElement>('h1, h2, h3'));
  if (headings.length < 2) {
    return null;
  }
  const rail = document.createElement('nav');
  rail.className = 'blok-file-preview-rail';
  rail.setAttribute('data-role', 'file-preview-outline');
  rail.setAttribute('aria-label', chrome.labels.outline);

  const topOf = (heading: HTMLElement): number =>
    heading.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop;

  const items = headings.map((heading) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.setAttribute('data-level', heading.tagName.slice(1));
    const dash = document.createElement('span');
    dash.className = 'blok-file-preview-rail-dash';
    dash.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'blok-file-preview-rail-label';
    label.textContent = heading.textContent ?? '';
    item.append(dash, label);
    item.addEventListener('click', () => {
      view.scrollTo({ top: Math.max(0, topOf(heading) - JUMP_PAD), behavior: 'smooth' });
    });
    rail.appendChild(item);

    return item;
  });

  const track = (): void => {
    const line = view.getBoundingClientRect().top + view.clientHeight * CURRENT_LINE;
    const passed = headings.reduce((found, heading, index) => (heading.getBoundingClientRect().top <= line ? index : found), 0);
    // The last headings of a document may never reach the line; the end of the scroll belongs to the last one.
    const atEnd = view.scrollTop > 0 && view.scrollTop + view.clientHeight >= view.scrollHeight - 1;
    const current = atEnd ? headings.length - 1 : passed;
    items.forEach((item, index) => item.setAttribute('aria-current', String(index === current)));
  };

  // CSS opens the rail on data-open. A pointer over it opens it; so does
  // keyboard focus. A click also focuses an entry, and must not hold it open.
  const state = { hover: false, keyboard: false };
  const sync = (): void => {
    rail.toggleAttribute('data-open', state.hover || state.keyboard);
  };
  rail.addEventListener('pointerenter', () => {
    state.hover = true;
    sync();
  });
  rail.addEventListener('pointerleave', () => {
    state.hover = false;
    sync();
  });
  rail.addEventListener('focusin', (event) => {
    state.keyboard = event.target instanceof Element && event.target.matches(':focus-visible');
    sync();
  });
  rail.addEventListener('focusout', (event) => {
    if (!(event.relatedTarget instanceof Node) || !rail.contains(event.relatedTarget)) {
      state.keyboard = false;
      sync();
    }
  });

  view.addEventListener('scroll', track, { passive: true });
  chrome.addOverlay(rail);
  track();

  return rail;
}
