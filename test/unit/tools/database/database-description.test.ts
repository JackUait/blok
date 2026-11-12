import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DatabaseData } from '../../../../src/tools/database/types';
import { databaseSanitize } from '../../../../src/shared/tool-descriptions/sanitize/blocks';
import { buildDatabase, makeDoc } from './structure-harness';

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();

    save(): Promise<{ blocks: never[] }> {
      return Promise.resolve({ blocks: [] });
    }

    destroy(): void {}
  },
}));

const data = (extra: Partial<DatabaseData> = {}): DatabaseData => ({
  title: 'Tasks',
  schema: [{ id: 'title', name: 'Name', type: 'title', position: 'a0' }],
  views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
  activeViewId: 'v1',
  ...extra,
});

const field = (el: HTMLElement): HTMLElement | null => el.querySelector('[data-blok-database-description]');
const open = (extra: Partial<DatabaseData> = {}): ReturnType<typeof buildDatabase> =>
  buildDatabase(makeDoc([{ id: 'db', name: 'database', parentId: null, data: {} }]), 'db', data(extra));
const save = (tool: ReturnType<typeof buildDatabase>['tool']): DatabaseData => tool.save(document.createElement('div'));

describe('DatabaseTool — description on a full-page database', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('draws a saved description first, above the title row and the tabs', () => {
    const { el } = open({ fullPage: true, description: 'Sprint <b>goals</b>' });
    const description = field(el);

    expect(description?.innerHTML).toBe('Sprint <b>goals</b>');
    expect(description?.getAttribute('contenteditable')).toBe('true');
    expect(description?.nextElementSibling?.hasAttribute('data-blok-database-title-row')).toBe(true);
    expect(description?.getAttribute('data-placeholder')).toBe('tools.database.descriptionPlaceholder');
  });

  it('offers Add description in the page header row, and it opens an empty focused field', () => {
    const { tool, el } = open({ fullPage: true });

    expect(field(el)).toBeNull();
    const [action] = tool.pageHeaderActions();

    expect(action?.label).toBe('tools.database.addDescription');
    action?.onActivate();

    expect(field(el)).not.toBeNull();
    expect(field(el)).toHaveFocus();
    expect(tool.pageHeaderActions()[0]?.label).toBe('tools.database.hideDescription');
  });

  it('saves what was typed, and saves nothing once it is cleared', () => {
    const { tool, el } = open({ fullPage: true });

    tool.pageHeaderActions()[0]?.onActivate();
    const description = field(el);

    if (description === null) throw new Error('no field');
    description.innerHTML = 'Plan <i>Q3</i>';
    expect(save(tool).description).toBe('Plan <i>Q3</i>');

    description.innerHTML = '';
    description.dispatchEvent(new FocusEvent('blur'));

    expect(field(el)).toBeNull();
    expect(save(tool)).not.toHaveProperty('description');
  });

  it('keeps Enter and an empty Backspace away from core', () => {
    const { tool, el } = open({ fullPage: true });

    tool.pageHeaderActions()[0]?.onActivate();
    const description = field(el);
    const reached = vi.fn();

    el.addEventListener('keydown', reached);
    ['Enter', 'Backspace', 'Delete', 'Tab'].forEach((key) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

      description?.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });

    expect(reached).not.toHaveBeenCalled();
  });

  it('Hide description removes the line', () => {
    const { tool, el } = open({ fullPage: true, description: 'Gone soon' });

    tool.pageHeaderActions()[0]?.onActivate();

    expect(field(el)).toBeNull();
    expect(save(tool)).not.toHaveProperty('description');
  });

  it('an inline database shows no description and offers no header action, but keeps the saved one', () => {
    const { tool, el } = open({ description: 'Kept' });

    expect(field(el)).toBeNull();
    expect(tool.pageHeaderActions()).toEqual([]);
    expect(save(tool).description).toBe('Kept');
  });

  it('read-only shows the description without editing or a header action', () => {
    const { tool, el } = open({ fullPage: true, description: 'Read me' });

    tool.setReadOnly(true);

    expect(field(el)?.getAttribute('contenteditable')).not.toBe('true');
    expect(tool.pageHeaderActions()).toEqual([]);
  });

  it.each([
    '<img src=x onerror="window.__descXss = 1">Hi',
    'Hi<script>window.__descXss = 1</script>',
  ])('never draws script from a loaded description: %s', (html) => {
    const { el } = open({ fullPage: true, description: html });
    const description = field(el);

    expect(description?.querySelector('img, script')).toBeNull();
    expect(description?.innerHTML).not.toMatch(/onerror|script/i);
    expect(description?.textContent).toBe('Hi');
  });

  it('never draws script from a description that setData brings', () => {
    const { tool, el } = open({ fullPage: true, description: 'Safe' });

    tool.setData(data({ fullPage: true, description: '<b onclick="x()">Bold</b><img src=x onerror="y()">' }));
    const description = field(el);

    expect(description?.innerHTML).toBe('<b>Bold</b>');
  });

  it('keeps inline marks through the sanitizer config and nothing else', () => {
    const config = databaseSanitize().description;

    expect(config).toEqual(expect.objectContaining({ b: expect.anything(), i: expect.anything(), a: expect.anything() }));
    expect(config).not.toHaveProperty('script');
  });
});
