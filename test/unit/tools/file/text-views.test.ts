import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { parseCsv, renderCsv } from '../../../../src/tools/file/csv-view';
import { renderLog, renderPlainText } from '../../../../src/tools/file/log-view';
import { mountOutline } from '../../../../src/tools/file/md-outline';
import { detachedChrome, type PreviewChrome } from '../../../../src/tools/file/preview-chrome';

interface Harness {
  chrome: PreviewChrome;
  body: HTMLElement;
  header: HTMLElement;
  bar: () => HTMLElement;
}

function harness(): Harness {
  const body = document.createElement('div');
  document.body.appendChild(body);
  const slots: { bar: HTMLElement | null } = { bar: null };
  const chrome: PreviewChrome = {
    ...detachedChrome(body),
    setBar: (bar) => { slots.bar = bar; },
  };

  return {
    chrome, body, header: chrome.header,
    bar: () => {
      if (slots.bar === null) {
        throw new Error('no bar');
      }

      return slots.bar;
    },
  };
}

const pressed = (root: ParentNode, action: string): Array<string | null> =>
  Array.from(root.querySelectorAll(`[data-action="${action}"]`)).map((el) => el.getAttribute('aria-pressed'));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('parseCsv', () => {
  it('splits rows and fields on commas', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps commas, quotes and line breaks inside a quoted field', () => {
    expect(parseCsv('name,note\n"Souza, R.","said ""hi""\nthen left"')).toEqual([
      ['name', 'note'],
      ['Souza, R.', 'said "hi"\nthen left'],
    ]);
  });

  it('reads Windows line ends and ignores the last empty line', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps an empty field, also at the end of a row', () => {
    expect(parseCsv('a,,c\n1,2,')).toEqual([['a', '', 'c'], ['1', '2', '']]);
  });

  it('drops a byte order mark', () => {
    expect(parseCsv('﻿a,b')).toEqual([['a', 'b']]);
  });

  it('reads semicolon files, the way Excel saves them in much of Europe', () => {
    expect(parseCsv('a;b;c\n1,5;2;3')).toEqual([['a', 'b', 'c'], ['1,5', '2', '3']]);
  });

  it('reads tab-separated files', () => {
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('does not count a separator inside quotes when picking the delimiter', () => {
    expect(parseCsv('"a;b;c;d",x\n1,2')).toEqual([['a;b;c;d', 'x'], ['1', '2']]);
  });

  it('reads an empty file as no rows', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('renderCsv', () => {
  const CSV = 'Name,Seats\nAmara,4\nJonas,12\n';

  it('shows the file as a grid, numbers as numbers', () => {
    const h = harness();
    renderCsv(h.chrome, CSV);

    expect(h.body.querySelector('td[data-ref="A2"]')?.textContent).toBe('Amara');
    expect(h.body.querySelector('td[data-ref="B3"]')?.classList.contains('blok-file-preview-xlsx-num')).toBe(true);
    expect(h.body.querySelector('td[data-ref="A2"]')?.classList.contains('blok-file-preview-xlsx-num')).toBe(false);
  });

  it('has no sheet tabs', () => {
    const h = harness();
    renderCsv(h.chrome, CSV);

    expect(h.bar().querySelector('[data-action="preview-sheet"]')).toBeNull();
  });

  it('switches between the table and the source text', () => {
    const h = harness();
    renderCsv(h.chrome, CSV);
    const table = h.body.querySelector<HTMLElement>('[data-role="file-preview-csv"]');
    const source = h.body.querySelector<HTMLElement>('[data-role="file-preview-csv-raw"]');

    expect(Array.from(h.header.querySelectorAll('.blok-file-preview-toggle button')).map((b) => b.textContent)).toEqual(['Table', 'Source']);
    expect(table?.hidden).toBe(false);
    expect(source?.hidden).toBe(true);
    expect(source?.textContent).toBe(CSV);

    h.header.querySelector<HTMLElement>('[data-action="preview-raw"]')?.click();
    expect(table?.hidden).toBe(true);
    expect(source?.hidden).toBe(false);
    expect(h.bar().hidden).toBe(true);
    expect(pressed(h.header, 'preview-raw')).toEqual(['true']);

    h.header.querySelector<HTMLElement>('[data-action="preview-render"]')?.click();
    expect(table?.hidden).toBe(false);
    expect(h.bar().hidden).toBe(false);
  });
});

describe('renderLog', () => {
  const LOG = [
    '2026-11-13 09:14:02 INFO  server listening on :4444',
    '2026-11-13 09:14:31 WARN  slow write doc=q3 took=412ms',
    '2026-11-13 09:16:10 ERROR upload failed status=413',
    'plain line with no stamp',
    '[2026-11-13T09:17:00Z] [error] socket closed',
  ].join('\n');
  const lines = (h: Harness): HTMLElement[] => Array.from(h.body.querySelectorAll<HTMLElement>('[data-role="file-preview-log"] > *'));

  it('keeps every character of every line', () => {
    const h = harness();
    renderLog(h.chrome, LOG);

    expect(lines(h).map((line) => line.textContent).join('\n')).toBe(LOG);
  });

  it('numbers the lines and tags each with its level', () => {
    const h = harness();
    renderLog(h.chrome, LOG);

    expect(lines(h).map((line) => line.getAttribute('data-line'))).toEqual(['1', '2', '3', '4', '5']);
    expect(lines(h).map((line) => line.getAttribute('data-level'))).toEqual(['info', 'warn', 'error', 'info', 'error']);
  });

  it('marks the timestamp, the level word and each key= for dimming and colour', () => {
    const h = harness();
    renderLog(h.chrome, LOG);
    const [, warn, , plain, bracketed] = lines(h);

    expect(warn.querySelector('[data-part="time"]')?.textContent).toBe('2026-11-13 09:14:31');
    expect(warn.querySelector('[data-part="level"]')?.textContent).toBe('WARN');
    expect(Array.from(warn.querySelectorAll('[data-part="key"]')).map((el) => el.textContent)).toEqual(['doc=', 'took=']);
    expect(plain.querySelector('[data-part]')).toBeNull();
    expect(bracketed.querySelector('[data-part="time"]')?.textContent).toBe('[2026-11-13T09:17:00Z]');
    expect(bracketed.querySelector('[data-part="level"]')?.textContent).toBe('error');
  });

  it('does not call a line an error because its message says "error"', () => {
    const h = harness();
    renderLog(h.chrome, '2026-11-13 09:00:00 INFO  no error found');

    expect(lines(h)[0].getAttribute('data-level')).toBe('info');
  });

  it('counts lines per filter and starts on All', () => {
    const h = harness();
    renderLog(h.chrome, LOG);

    const filters = Array.from(h.bar().querySelectorAll('[data-action="preview-log-filter"]'));
    expect(filters.map((b) => b.textContent)).toEqual(['All 5', 'Errors 2', 'Warnings 1']);
    expect(pressed(h.bar(), 'preview-log-filter')).toEqual(['true', 'false', 'false']);
  });

  it('shows only the errors, or only the warnings, and keeps their line numbers', () => {
    const h = harness();
    renderLog(h.chrome, LOG);
    const filters = Array.from(h.bar().querySelectorAll<HTMLElement>('[data-action="preview-log-filter"]'));
    const shown = (): Array<string | null> => lines(h).filter((line) => !line.hidden).map((line) => line.getAttribute('data-line'));

    filters[1].click();
    expect(shown()).toEqual(['3', '5']);
    expect(pressed(h.bar(), 'preview-log-filter')).toEqual(['false', 'true', 'false']);

    filters[2].click();
    expect(shown()).toEqual(['2']);

    filters[0].click();
    expect(shown()).toEqual(['1', '2', '3', '4', '5']);
  });

  it('offers a Copy button for the whole file', () => {
    const h = harness();
    renderLog(h.chrome, LOG);

    expect(h.bar().querySelector('[data-action="preview-copy"]')).not.toBeNull();
  });
});

describe('renderPlainText', () => {
  it('shows the text untouched, with a Copy button', () => {
    const h = harness();
    renderPlainText(h.chrome, 'one\ntwo\n');

    const pre = h.body.querySelector('[data-role="file-preview-text"]');
    expect(pre?.textContent).toBe('one\ntwo\n');
    expect(pre?.className).toBe('blok-file-preview-pre');
    expect(h.bar().querySelector('[data-action="preview-copy"]')).not.toBeNull();
  });
});

describe('mountOutline', () => {
  /** A scrolling view of headings, each 300px below the last, in a 400px-tall view. */
  const view = (html: string): HTMLElement => {
    const el = document.createElement('div');
    el.innerHTML = html;
    document.body.appendChild(el);
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 400 });
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 2000 });
    el.getBoundingClientRect = () => new DOMRect(0, 0, 800, 400);
    Array.from(el.querySelectorAll<HTMLElement>('h1,h2,h3,h4')).forEach((heading, index) => {
      // eslint-disable-next-line no-param-reassign -- a test double for layout
      heading.getBoundingClientRect = () => new DOMRect(0, index * 300 - el.scrollTop, 800, 30);
    });
    el.scrollTo = ((options: ScrollToOptions) => {
      el.scrollTop = options.top ?? 0;
      el.dispatchEvent(new Event('scroll'));
    }) as typeof el.scrollTo;

    return el;
  };
  const DOC = '<h1>Blok</h1><p>x</p><h2>Install</h2><h3>With React</h3><h4>Deep</h4><h2>License</h2>';
  const current = (rail: HTMLElement): string[] =>
    Array.from(rail.querySelectorAll('[aria-current="true"]')).map((el) => el.textContent ?? '');

  it('lists the first three heading levels, in order, with their level', () => {
    const h = harness();
    const rail = mountOutline(view(DOC), h.chrome);
    const items = Array.from(rail?.querySelectorAll('button') ?? []);

    expect(items.map((item) => item.textContent)).toEqual(['Blok', 'Install', 'With React', 'License']);
    expect(items.map((item) => item.getAttribute('data-level'))).toEqual(['1', '2', '3', '2']);
    expect(rail?.getAttribute('aria-label')).toBe('On this page');
  });

  it('mounts nothing for a document with fewer than two headings', () => {
    const h = harness();

    expect(mountOutline(view('<h1>Only</h1><p>x</p>'), h.chrome)).toBeNull();
    expect(h.body.querySelector('[data-role="file-preview-outline"]')).toBeNull();
  });

  it('marks the heading in view and follows the scroll', () => {
    const h = harness();
    const el = view(DOC);
    const rail = mountOutline(el, h.chrome);
    if (rail === null) {
      throw new Error('no rail');
    }
    expect(current(rail)).toEqual(['Blok']);

    // "Install" is 300px down. It becomes current once it is 140px (35% of the view) from the top.
    el.scrollTop = 159;
    el.dispatchEvent(new Event('scroll'));
    expect(current(rail)).toEqual(['Blok']);

    el.scrollTop = 160;
    el.dispatchEvent(new Event('scroll'));
    expect(current(rail)).toEqual(['Install']);
  });

  it('marks the last heading at the very end, even when it never reaches the top', () => {
    const h = harness();
    const el = view(DOC);
    const rail = mountOutline(el, h.chrome);
    if (rail === null) {
      throw new Error('no rail');
    }
    el.scrollTop = 1600;
    el.dispatchEvent(new Event('scroll'));

    expect(current(rail)).toEqual(['License']);
  });

  it('opens into the heading list while the pointer is over it', () => {
    const h = harness();
    const rail = mountOutline(view(DOC), h.chrome);

    expect(rail?.hasAttribute('data-open')).toBe(false);
    rail?.dispatchEvent(new MouseEvent('pointerenter'));
    expect(rail?.hasAttribute('data-open')).toBe(true);
    rail?.dispatchEvent(new MouseEvent('pointerleave'));
    expect(rail?.hasAttribute('data-open')).toBe(false);
  });

  it('opens for keyboard focus and closes when focus leaves it', () => {
    const h = harness();
    const rail = mountOutline(view(DOC), h.chrome);
    const first = rail?.querySelector('button');
    if (rail === null || first === null || first === undefined) {
      throw new Error('no rail');
    }
    vi.spyOn(first, 'matches').mockImplementation((selector) => selector === ':focus-visible');

    first.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(rail.hasAttribute('data-open')).toBe(true);

    first.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }));
    expect(rail.hasAttribute('data-open')).toBe(false);
  });

  it('stays closed when a click, not the keyboard, focuses an entry', () => {
    const h = harness();
    const rail = mountOutline(view(DOC), h.chrome);
    const first = rail?.querySelector('button');
    if (rail === null || first === null || first === undefined) {
      throw new Error('no rail');
    }
    vi.spyOn(first, 'matches').mockReturnValue(false);

    first.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(rail.hasAttribute('data-open')).toBe(false);
  });

  it('scrolls to a heading when its entry is pressed', () => {
    const h = harness();
    const el = view(DOC);
    const rail = mountOutline(el, h.chrome);
    rail?.querySelectorAll('button')[1].click();

    expect(el.scrollTop).toBe(300 - 16);
    expect(rail === null ? [] : current(rail)).toEqual(['Install']);
  });
});
