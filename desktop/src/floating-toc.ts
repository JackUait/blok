import { outlineDepths } from '../../src/shared/outline-depths';

interface Heading {
  id: string;
  level: number;
  text: string;
  element: HTMLElement;
}

/** Notion's floating outline follows the heading nearest the scroller's upper quarter. */
export function closestTocHeading(
  rects: readonly { id: string; top: number; height: number }[],
  targetY: number,
): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const rect of rects) {
    const distance = Math.abs(targetY - (rect.top + rect.height / 2));
    if (best === null || distance < best.distance) best = { id: rect.id, distance };
  }
  return best?.id ?? null;
}

/** The live DOM gives reading order and the expanded state of nested headings. */
export function collectFloatingHeadings(redactor: Element): Heading[] {
  return Array.from(redactor.querySelectorAll<HTMLElement>('[data-blok-tool="header"]')).flatMap((element) => {
    const holder = element.closest<HTMLElement>('[data-blok-element]');
    const id = holder?.getAttribute('data-blok-id') ?? '';
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!holder || !id || !text || !redactor.contains(holder) ||
      element.closest('[hidden], [aria-hidden="true"], .hidden') || element.getClientRects().length === 0) return [];
    const rawLevel = Number.parseInt(element.getAttribute('data-blok-heading-level') ?? '', 10);
    const level = Number.isFinite(rawLevel) ? Math.max(1, Math.min(6, rawLevel)) : 1;
    return [{ id, level, text, element }];
  });
}

export interface FloatingToc {
  element: HTMLElement;
  destroy(): void;
}

export function createFloatingToc(scroller: HTMLElement, redactor: HTMLElement): FloatingToc {
  const nav = document.createElement('nav');
  const list = document.createElement('ol');
  nav.setAttribute('data-desktop-floating-toc', '');
  nav.setAttribute('aria-label', 'Sommaire de la page');
  list.setAttribute('role', 'list');
  nav.append(list);
  document.body.append(nav);

  let headings: Heading[] = [];
  let activeId: string | null = null;
  let frame: number | null = null;
  let destroyed = false;

  const place = (): void => {
    const rect = scroller.getBoundingClientRect();
    nav.hidden = headings.length === 0 || rect.width < 900 || rect.height < 250 || getComputedStyle(scroller).display === 'none';
    nav.style.right = `${Math.max(12, window.innerWidth - rect.right + 16)}px`;
    nav.style.top = `${Math.max(rect.top + 16, rect.top + rect.height * 0.25)}px`;
    nav.style.maxHeight = `${Math.max(100, rect.bottom - (rect.top + rect.height * 0.25) - 24)}px`;
  };
  const markActive = (): void => {
    if (nav.hidden || headings.length === 0) return;
    const rect = scroller.getBoundingClientRect();
    const targetY = rect.top + rect.height * 0.25;
    const id = closestTocHeading(headings.map(({ id, element }) => {
      const headingRect = element.getBoundingClientRect();
      return { id, top: headingRect.top, height: headingRect.height };
    }), targetY);
    if (id === activeId) return;
    activeId = id;
    list.querySelectorAll<HTMLAnchorElement>('a[data-desktop-floating-toc-link]').forEach((link) => {
      if (link.dataset.desktopFloatingTocLink === id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  };
  const refresh = (): void => {
    frame = null;
    if (destroyed) return;
    const next = collectFloatingHeadings(redactor);
    const before = JSON.stringify(headings.map(({ id, level, text }) => [id, level, text]));
    const after = JSON.stringify(next.map(({ id, level, text }) => [id, level, text]));
    headings = next;
    if (before !== after) {
      const depths = outlineDepths(headings.map(({ level }) => level));
      list.replaceChildren(...headings.map(({ id, text }, index) => {
        const item = document.createElement('li');
        const link = document.createElement('a');
        const line = document.createElement('span');
        const label = document.createElement('span');
        item.style.setProperty('--toc-depth', String(depths[index]));
        link.href = `#${encodeURIComponent(id)}`;
        link.dataset.desktopFloatingTocLink = id;
        link.setAttribute('aria-label', text);
        line.setAttribute('data-desktop-floating-toc-line', '');
        label.setAttribute('data-desktop-floating-toc-label', '');
        label.textContent = text;
        link.append(line, label);
        item.append(link);
        return item;
      }));
      activeId = null;
    }
    place();
    markActive();
  };
  const schedule = (): void => {
    if (frame === null && !destroyed) frame = window.requestAnimationFrame(refresh);
  };
  const onClick = (event: MouseEvent): void => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-desktop-floating-toc-link]') : null;
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = headings.find(({ id }) => id === link.dataset.desktopFloatingTocLink)?.element;
    if (!target) return;
    event.preventDefault();
    const rect = scroller.getBoundingClientRect();
    scroller.scrollTo({ top: scroller.scrollTop + target.getBoundingClientRect().top - rect.top - 94, behavior: 'smooth' });
  };
  const observer = new MutationObserver(schedule);
  observer.observe(redactor, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['class', 'hidden', 'aria-hidden', 'data-blok-heading-level', 'data-blok-toggle-open'] });
  const resize = new ResizeObserver(schedule);
  resize.observe(scroller);
  resize.observe(redactor);
  scroller.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  nav.addEventListener('click', onClick);
  refresh();

  return {
    element: nav,
    destroy: () => {
      destroyed = true;
      observer.disconnect();
      resize.disconnect();
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      nav.removeEventListener('click', onClick);
      if (frame !== null) window.cancelAnimationFrame(frame);
      nav.remove();
    },
  };
}
