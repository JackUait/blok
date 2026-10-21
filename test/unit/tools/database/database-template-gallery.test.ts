import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openTemplateGallery } from '../../../../src/tools/database/database-template-gallery';
import type { TemplateGalleryOptions } from '../../../../src/tools/database/database-template-gallery';

const t = (key: string, vars?: Record<string, string>): string => (vars === undefined ? key : `${key} ${JSON.stringify(vars)}`);

const template = (id: string, extra: Partial<TemplateGalleryOptions['templates'][number]> = {}): TemplateGalleryOptions['templates'][number] => ({
  id, name: `${id} name`, description: `${id} text`, icon: '<svg></svg>', tint: 'green', columns: [], pills: [], ...extra,
});

const open = (extra: Partial<TemplateGalleryOptions> = {}): TemplateGalleryOptions => {
  const options: TemplateGalleryOptions = {
    t,
    templates: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => template(id)),
    sources: [1, 2, 3, 4, 5].map((n) => ({ id: `s${n}`, title: `Source ${n}`, parent: `Page ${n}` })),
    onEmpty: vi.fn(),
    onSource: vi.fn(),
    onTemplate: vi.fn(),
    ...extra,
  };

  openTemplateGallery(options);

  return options;
};

const dialog = (): HTMLElement | null => document.querySelector('[data-blok-testid="database-template-gallery"]');
const byTestId = (id: string): HTMLElement => {
  const found = dialog()?.querySelector(`[data-blok-testid="${id}"]`);

  if (!(found instanceof HTMLElement)) throw new Error(`no ${id}`);

  return found;
};
const shown = (prefix: string): string[] => [...(dialog()?.querySelectorAll(`[data-blok-testid^="${prefix}"]`) ?? [])]
  .filter((el) => !(el as HTMLElement).hidden)
  .map((el) => el.getAttribute('data-blok-testid')?.slice(prefix.length) ?? '');
const type = (value: string): void => {
  const search = byTestId('database-template-gallery-search') as HTMLInputElement;

  search.value = value;
  search.dispatchEvent(new Event('input'));
};

describe('"More templates" gallery (research/26 §2, research/27 §1e)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('is a dialog with the search focused, then Empty database, Existing data sources and Templates', () => {
    open();

    expect(dialog()?.getAttribute('role')).toBe('dialog');
    expect(byTestId('database-template-gallery-search')).toHaveFocus();
    expect(byTestId('database-template-gallery-search').getAttribute('placeholder')).toBe('tools.database.searchLabel');
    expect(byTestId('database-template-gallery-empty').textContent?.trim()).toBe('tools.database.starterEmptyDatabase');
    expect([...(dialog()?.querySelectorAll('[data-blok-database-tpl-gallery-section]') ?? [])].map((el) => el.textContent?.trim())).toEqual([
      'tools.database.layoutExistingDataSources', 'tools.database.templateMenuLabel',
    ]);
  });

  it('shows four sources and a Show more that reveals the rest', () => {
    open();

    expect(shown('database-template-gallery-source-')).toEqual(['s1', 's2', 's3', 's4']);
    byTestId('database-template-gallery-show-more').click();
    expect(shown('database-template-gallery-source-')).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(dialog()?.querySelector('[data-blok-testid="database-template-gallery-show-more"]')).toBeNull();
  });

  it('shows six templates; More templates expands the list in place', () => {
    open();

    expect(shown('database-template-gallery-template-')).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    byTestId('database-template-gallery-more').click();
    expect(shown('database-template-gallery-template-')).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(dialog()?.querySelector('[data-blok-testid="database-template-gallery-more"]')).toBeNull();
    expect(dialog()).not.toBeNull();
  });

  it('a template card has its name, description and preview: column names and option pills', () => {
    open({ templates: [template('a', { columns: ['Task name', 'Status'], pills: [{ label: 'Done', color: 'green' }], pillColumn: 1 })] });
    const card = byTestId('database-template-gallery-template-a');

    expect(card.querySelector('[data-blok-database-tpl-gallery-card-title]')?.textContent).toBe('a name');
    expect(card.querySelector('[data-blok-database-tpl-gallery-card-text]')?.textContent).toBe('a text');
    expect(card.getAttribute('data-tint')).toBe('green');
    expect([...card.querySelectorAll('[data-blok-database-tpl-gallery-thumb-head] > span')].map((el) => el.textContent)).toEqual(['Task name', 'Status']);
    const pill = card.querySelector('[data-blok-database-tpl-gallery-pill]');

    expect(pill?.textContent).toBe('Done');
    expect(pill?.getAttribute('data-color')).toBe('green');
  });

  it('a click on a template, a source or Empty database closes the gallery and says which', () => {
    const first = open();

    byTestId('database-template-gallery-template-b').click();
    expect(dialog()).toBeNull();
    expect(first.onTemplate).toHaveBeenCalledWith('b');

    const second = open();

    byTestId('database-template-gallery-source-s2').click();
    expect(dialog()).toBeNull();
    expect(second.onSource).toHaveBeenCalledWith('s2');

    const third = open();

    byTestId('database-template-gallery-empty').click();
    expect(dialog()).toBeNull();
    expect(third.onEmpty).toHaveBeenCalledTimes(1);
  });

  it('the close button closes it and picks nothing', () => {
    const options = open();

    byTestId('database-template-gallery-close').click();
    expect(dialog()).toBeNull();
    expect(options.onEmpty).not.toHaveBeenCalled();
    expect(options.onTemplate).not.toHaveBeenCalled();
    expect(options.onSource).not.toHaveBeenCalled();
  });

  it('search keeps the sources and templates whose name matches; a section with none is hidden (Blok choice)', () => {
    open();

    type('source 5');
    expect(shown('database-template-gallery-source-')).toEqual(['s5']);
    expect(shown('database-template-gallery-template-')).toEqual([]);
    expect([...(dialog()?.querySelectorAll('[data-blok-database-tpl-gallery-section]') ?? [])].filter((el) => !(el as HTMLElement).hidden).map((el) => el.textContent?.trim()))
      .toEqual(['tools.database.layoutExistingDataSources']);
    type('G NAME');
    expect(shown('database-template-gallery-template-')).toEqual(['g']);
    expect(shown('database-template-gallery-source-')).toEqual([]);
  });

  it('without sources there is no Existing data sources section', () => {
    open({ sources: [] });

    expect([...(dialog()?.querySelectorAll('[data-blok-database-tpl-gallery-section]') ?? [])].map((el) => el.textContent?.trim())).toEqual(['tools.database.templateMenuLabel']);
  });
});
