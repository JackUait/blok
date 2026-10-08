import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TableOfContentsTool } from '../../../../src/tools/table-of-contents';
import { renderTableOfContentsPreview } from '../../../../src/tools/table-of-contents/preview';
import type { TableOfContentsData } from '../../../../src/tools/table-of-contents/types';
import type { API, BlockToolConstructorOptions } from '../../../../types';

type Handler = (payload: unknown) => void;

const createApi = (): { api: API; handlers: Map<string, Set<Handler>>; scrollToBlock: ReturnType<typeof vi.fn> } => {
  const handlers = new Map<string, Set<Handler>>();
  const scrollToBlock = vi.fn();
  const api = {
    i18n: { t: (key: string) => key },
    events: {
      on: (name: string, cb: Handler) => {
        handlers.set(name, (handlers.get(name) ?? new Set()).add(cb));
      },
      off: (name: string, cb: Handler) => {
        handlers.get(name)?.delete(cb);
      },
    },
    blocks: { scrollToBlock },
  } as unknown as API;

  return { api, handlers, scrollToBlock };
};

const frames: FrameRequestCallback[] = [];

const flushFrames = (): void => {
  frames.splice(0).forEach((cb) => cb(0));
};

const emit = (handlers: Map<string, Set<Handler>>, name: string, payload: unknown = {}): void => {
  handlers.get(name)?.forEach((cb) => cb(payload));
  flushFrames();
};

const holder = (id: string, tool: string, child?: HTMLElement): HTMLElement => {
  const el = document.createElement('div');
  const content = document.createElement('div');

  el.setAttribute('data-blok-element', '');
  el.setAttribute('data-blok-component', tool);
  el.setAttribute('data-blok-id', id);
  content.setAttribute('data-blok-element-content', '');
  if (child !== undefined) {
    content.appendChild(child);
  }
  el.appendChild(content);

  return el;
};

const heading = (id: string, level: number, text: string): HTMLElement => {
  const h = document.createElement(`h${level}`);

  h.setAttribute('data-blok-tool', 'header');
  h.setAttribute('data-blok-heading-level', String(level));
  h.textContent = text;

  return holder(id, 'header', h);
};

const setup = (
  headings: HTMLElement[],
  data: TableOfContentsData = {},
  origin: BlockToolConstructorOptions['origin'] = 'load'
): {
  tool: TableOfContentsTool;
  root: HTMLElement;
  redactor: HTMLElement;
  handlers: Map<string, Set<Handler>>;
  scrollToBlock: ReturnType<typeof vi.fn>;
  dispatchChange: ReturnType<typeof vi.fn>;
} => {
  const { api, handlers, scrollToBlock } = createApi();
  const dispatchChange = vi.fn();
  const tool = new TableOfContentsTool({
    api,
    block: { id: 'toc', dispatchChange } as never,
    data,
    config: {},
    origin,
    readOnly: false,
  } as BlockToolConstructorOptions<TableOfContentsData>);
  const redactor = document.createElement('div');

  redactor.setAttribute('data-blok-redactor', '');
  const root = tool.render();

  redactor.append(holder('toc', 'table_of_contents', root), ...headings);
  document.body.appendChild(redactor);
  tool.rendered();

  return { tool, root, redactor, handlers, scrollToBlock, dispatchChange };
};

const links = (root: HTMLElement): HTMLAnchorElement[] => Array.from(root.querySelectorAll('a'));

describe('TableOfContentsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    frames.length = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => frames.push(cb));
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('is a labelled navigation landmark that core neither diffs nor treats as its links', () => {
    const { root } = setup([]);

    expect(root.tagName).toBe('NAV');
    expect(root.getAttribute('aria-label')).toBe('toolNames.tableOfContents');
    expect(root.getAttribute('data-blok-tool')).toBe('table_of_contents');
    expect(root.getAttribute('data-blok-mutation-free')).toBe('true');
    expect(root.hasAttribute('data-blok-link-owner')).toBe(true);
  });

  it('links every heading of the page, indented by outline depth', () => {
    const { root } = setup([ heading('a', 1, 'Intro'), heading('b', 3, 'Detail'), heading('c', 2, 'Next') ]);

    expect(links(root).map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Intro', '#a'],
      ['Detail', '#b'],
      ['Next', '#c'],
    ]);
    expect(Array.from(root.querySelectorAll('li')).map((li) => li.getAttribute('data-depth'))).toEqual(['0', '1', '1']);
  });

  it('shows the empty hint when the page has no headings', () => {
    const { root } = setup([]);

    expect(links(root)).toHaveLength(0);
    expect(root.querySelector<HTMLElement>('[data-blok-toc-empty]')?.hidden).toBe(false);
    expect(root.textContent).toContain('tools.tableOfContents.empty');
  });

  it('follows the page as headings are added and renamed', () => {
    const { root, redactor, handlers } = setup([ heading('a', 1, 'Intro') ]);

    redactor.appendChild(heading('b', 2, 'Added'));
    emit(handlers, 'block changed');

    expect(links(root).map((a) => a.textContent)).toEqual(['Intro', 'Added']);

    redactor.querySelector('[data-blok-id="a"] h1')?.replaceChildren('Renamed');
    emit(handlers, 'block changed');

    expect(links(root).map((a) => a.textContent)).toEqual(['Renamed', 'Added']);
    expect(root.querySelector<HTMLElement>('[data-blok-toc-empty]')?.hidden).toBe(true);
  });

  it('keeps its entries in place when a change leaves the outline as it was', () => {
    const { root, handlers } = setup([ heading('a', 1, 'Intro') ]);
    const before = links(root)[0];

    emit(handlers, 'block changed');

    expect(links(root)[0]).toBe(before);
  });

  it('marks only entries that are new since the last outline as entering', () => {
    const { root, redactor, handlers } = setup([ heading('a', 1, 'Intro') ]);

    redactor.appendChild(heading('b', 2, 'Added'));
    emit(handlers, 'block changed');

    expect(Array.from(root.querySelectorAll('li')).map((li) => li.hasAttribute('data-entering'))).toEqual([false, true]);
  });

  it('reveals the entries of a page that renders after the outline, without the new-heading wash', () => {
    const { root, redactor, handlers } = setup([]);

    redactor.append(heading('a', 1, 'Intro'), heading('b', 2, 'Details'));
    emit(handlers, 'block changed');

    const rows = Array.from(root.querySelectorAll('li'));

    expect(rows.map((li) => li.hasAttribute('data-entering'))).toEqual([false, false]);
    expect(rows.map((li) => li.hasAttribute('data-revealing'))).toEqual([true, true]);
  });

  it('jumps to the heading on click without letting the browser follow the fragment', () => {
    const { root, scrollToBlock } = setup([ heading('a', 1, 'Intro') ]);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });

    links(root)[0].dispatchEvent(click);

    expect(scrollToBlock).toHaveBeenCalledWith('a', { select: false });
    expect(click.defaultPrevented).toBe(true);
  });

  it('links a block id that needs percent-encoding and jumps to the raw id', () => {
    const { root, scrollToBlock } = setup([ heading('заголовок 1', 1, 'Intro') ]);

    links(root)[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));

    expect(scrollToBlock).toHaveBeenCalledWith('заголовок 1', { select: false });
  });

  it('takes keyboard focus to the current entry when Enter is pressed on the selected block', () => {
    const { tool, root } = setup([ heading('a', 1, 'A'), heading('b', 1, 'B') ]);

    links(root)[1].setAttribute('aria-current', 'location');

    expect(tool.onNavigationEnter()).toBe(true);
    expect(links(root)[1]).toHaveFocus();
  });

  it('takes keyboard focus to the first entry when no section is current', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 5000 } as DOMRect);
    const { tool, root } = setup([ heading('a', 1, 'A'), heading('b', 1, 'B') ]);

    expect(root.querySelector('[aria-current]')).toBeNull();

    expect(tool.onNavigationEnter()).toBe(true);
    expect(links(root)[0]).toHaveFocus();
  });

  it('leaves Enter to the editor when there is nothing to focus', () => {
    const { tool } = setup([]);

    expect(tool.onNavigationEnter()).toBe(false);
  });

  it('keeps list semantics even when the list is unstyled', () => {
    const { root } = setup([ heading('a', 1, 'A') ]);

    expect(root.querySelector('ol')?.getAttribute('role')).toBe('list');
  });

  it('draws no rail beside the entries: no reading marker and no read-progress state', () => {
    const { root, redactor } = setup([ heading('a', 1, 'A'), heading('b', 1, 'B'), heading('c', 1, 'C') ]);
    const tops: Record<string, number> = { a: -400, b: 100, c: 900 };

    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    redactor.querySelectorAll<HTMLElement>('[data-blok-component="header"]').forEach((el) => {
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: tops[el.getAttribute('data-blok-id') ?? ''] } as DOMRect);
    });
    document.dispatchEvent(new Event('scroll'));
    flushFrames();

    expect(root.querySelector('[data-blok-toc-thumb]')).toBeNull();
    expect(root.querySelectorAll('li[data-read]')).toHaveLength(0);
  });

  it('shows no rail in the toolbox preview either', () => {
    const preview = renderTableOfContentsPreview();

    expect(preview.querySelector('[data-thumb]')).toBeNull();
  });

  it('keeps focus on the clicked entry, so a following key cannot reach the selected heading', () => {
    // WebKit does not focus a link on click: focus stayed on <body> and Backspace deleted the heading.
    const { root } = setup([ heading('a', 1, 'Intro') ]);
    const [link] = links(root);

    (document.activeElement as HTMLElement | null)?.blur();
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));

    expect(link).toHaveFocus();
  });

  it('leaves a modified click to the browser', () => {
    const { root, scrollToBlock } = setup([ heading('a', 1, 'Intro') ]);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true });

    links(root)[0].dispatchEvent(click);

    expect(scrollToBlock).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(false);
  });

  it('walks its entries with the arrow keys, Home and End', () => {
    const { root } = setup([ heading('a', 1, 'A'), heading('b', 1, 'B'), heading('c', 1, 'C') ]);
    const [a, b, c] = links(root);
    const press = (key: string): void => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    };

    a.focus();
    press('ArrowDown');
    expect(b).toHaveFocus();
    press('End');
    expect(c).toHaveFocus();
    press('ArrowDown');
    expect(c).toHaveFocus();
    press('Home');
    expect(a).toHaveFocus();
    press('ArrowUp');
    expect(a).toHaveFocus();
  });

  it('marks the section being read as the current location', () => {
    const { root, redactor } = setup([ heading('a', 1, 'A'), heading('b', 1, 'B'), heading('c', 1, 'C') ]);
    const tops: Record<string, number> = { a: -400, b: 100, c: 900 };

    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    redactor.querySelectorAll<HTMLElement>('[data-blok-component="header"]').forEach((el) => {
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: tops[el.getAttribute('data-blok-id') ?? ''] } as DOMRect);
    });
    document.dispatchEvent(new Event('scroll'));
    flushFrames();

    const current = links(root).filter((a) => a.getAttribute('aria-current') === 'location');

    expect(current.map((a) => a.textContent)).toEqual(['B']);
  });

  it('marks no section while the reader is above the first heading', () => {
    const { root, redactor } = setup([ heading('a', 1, 'A') ]);

    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    vi.spyOn(redactor.querySelector('[data-blok-id="a"]') as HTMLElement, 'getBoundingClientRect').mockReturnValue({ top: 500 } as DOMRect);
    document.dispatchEvent(new Event('scroll'));
    flushFrames();

    expect(links(root)[0].hasAttribute('aria-current')).toBe(false);
  });

  it('stops listening once removed', () => {
    const { tool, root, redactor, handlers } = setup([ heading('a', 1, 'Intro') ]);

    tool.removed();
    redactor.appendChild(heading('b', 1, 'Late'));
    emit(handlers, 'block changed');
    emit(handlers, 'blocks:rendered');

    expect(links(root).map((a) => a.textContent)).toEqual(['Intro']);
    expect([...handlers.values()].every((set) => set.size === 0)).toBe(true);
  });

  it('does not subscribe while the editor only probes the tool', () => {
    const { handlers } = setup([], {}, 'probe');

    expect([...handlers.values()].every((set) => set.size === 0)).toBe(true);
  });

  it('saves only its colour, never the derived heading list', () => {
    const { tool } = setup([ heading('a', 1, 'Intro') ], { textColor: 'red', backgroundColor: 'nope' });

    expect(tool.save()).toEqual({ textColor: 'red' });
  });

  it('paints its block colour on the root', () => {
    const { root } = setup([], { textColor: 'red' });

    expect(root.style.color).toContain('red');
  });

  it('can never hold children and works read-only', () => {
    expect(TableOfContentsTool.acceptsChildren).toBe(false);
    expect(TableOfContentsTool.isReadOnlySupported).toBe(true);
  });
});
