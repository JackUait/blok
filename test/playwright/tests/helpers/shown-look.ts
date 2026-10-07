import type { Locator } from '@playwright/test';

/** One run of text as the user sees it. */
export interface ShownRun {
  text: string;
  color: string;
  background: string;
  weight: string;
  fontStyle: string;
  decoration: string;
  verticalAlign: string;
  href: string | null;
}

/**
 * What each matched editable shows, run by run: text plus computed colour,
 * background, weight, style, decoration and link. Markup spelling (tag order,
 * attribute order, a `transparent` background) does not show up; a lost mark does.
 * @param editables - contenteditables, in document order
 */
export const shownRuns = (editables: Locator): Promise<ShownRun[][]> => editables.evaluateAll(roots => roots.map((root) => {
  const runs: ShownRun[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  // Background and decoration are not inherited, so read them off the nearest ancestor that sets one.
  const upTo = (start: Element, read: (style: CSSStyleDeclaration) => string, blank: (value: string) => boolean): string => {
    for (let el: Element | null = start; el !== null && root.contains(el); el = el.parentElement) {
      const value = read(getComputedStyle(el));

      if (!blank(value)) {
        return value;
      }
    }

    return '';
  };

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = (node.textContent ?? '').replace(/​/g, '');
    const el = node.parentElement;

    if (text === '' || el === null) {
      continue;
    }
    const style = getComputedStyle(el);
    const run: ShownRun = {
      text,
      color: style.color,
      background: upTo(el, s => s.backgroundColor, v => v === 'rgba(0, 0, 0, 0)' || v === 'transparent'),
      weight: style.fontWeight,
      fontStyle: style.fontStyle,
      decoration: upTo(el, s => s.textDecorationLine, v => v === 'none'),
      verticalAlign: upTo(el, s => s.verticalAlign, v => v === 'baseline'),
      href: el.closest('a')?.getAttribute('href') ?? null,
    };
    const last = runs.at(-1);
    const same = last !== undefined && (Object.keys(run) as Array<keyof ShownRun>).every(key => key === 'text' || last[key] === run[key]);

    if (same) {
      last.text += text;
    } else {
      runs.push(run);
    }
  }

  return runs;
}));
