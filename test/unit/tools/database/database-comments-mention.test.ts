import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BuiltInCommentsUi } from '../../../../src/tools/database/database-comments';
import { DatabaseCommentTool } from '../../../../src/tools/database-comment';
import { databaseCommentSanitize } from '../../../../src/shared/tool-descriptions/sanitize/blocks';
import { DATABASE_COMMENT_DATA } from '../../../../src/shared/tool-descriptions/database-comment';
import { sanitizeBlocks } from '../../../../src/components/utils/sanitizer';
import type { API } from '../../../../types';
import type { DatabaseCommentData } from '../../../../types/tools/database-comment';
import type { PageConfig, PageSearchResult } from '../../../../src/tools/page/types';

interface FakeBlock { id: string; name: string; parentId: string | null; data: DatabaseCommentData }

/** A row `r1` and the comment blocks written under it. */
const harness = (page?: Partial<PageConfig>): { api: API; blocks: FakeBlock[] } => {
  const blocks: FakeBlock[] = [];
  const handle = (block: FakeBlock): unknown => ({
    id: block.id,
    name: block.name,
    call: (method: string, param: { receive: (data: DatabaseCommentData) => void }) => {
      if (method === 'readData') param.receive(structuredClone(block.data));
    },
  });
  const api = {
    events: { on: vi.fn(), off: vi.fn() },
    i18n: { t: (key: string) => key },
    tools: {
      getBlockTools: () => [
        { name: 'database-comment' },
        ...(page === undefined ? [] : [{ name: 'page', settings: page }]),
      ],
    },
    config: {},
    blocks: {
      transactWithoutCapture: (fn: () => void) => fn(),
      getChildren: (id: string) => blocks.filter((block) => block.parentId === id).map(handle),
      getById: (id: string) => (id === 'r1' ? { id: 'r1', name: 'database-row' } : (() => {
        const block = blocks.find((each) => each.id === id);

        return block === undefined ? null : handle(block);
      })()),
      insertAt: (name: string, data: DatabaseCommentData, at: { parentId: string }) => {
        const block = { id: `c${blocks.length + 1}`, name, parentId: at.parentId, data };

        blocks.push(block);

        return { id: block.id };
      },
    },
  } as unknown as API;

  return { api, blocks };
};

const PEOPLE = [{ id: 'u1', name: 'Ann Lee' }, { id: 'u2', name: 'Bob Stone' }];

const mount = (api: API): { ui: BuiltInCommentsUi; section: HTMLElement } => {
  const ui = new BuiltInCommentsUi({
    api,
    locale: () => 'en-US',
    me: () => null,
    personName: (id) => PEOPLE.find((person) => person.id === id)?.name,
    people: () => PEOPLE,
    permitted: () => true,
    readOnly: () => false,
    onChange: vi.fn(),
  });
  const section = ui.section('r1');

  document.body.appendChild(section);

  return { ui, section };
};

const inputOf = (root: ParentNode): HTMLTextAreaElement => {
  const input = root.querySelector<HTMLTextAreaElement>('[data-blok-database-comment-input]');

  if (input === null) throw new Error('no composer');

  return input;
};

const menu = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-blok-database-comment-mention-menu]');

/** Each option's title, then its hint when it has one. */
const optionTexts = (): string[] => [...(menu()?.querySelectorAll('[role="option"]') ?? [])].map((option) => [
  ...option.querySelectorAll('[data-blok-database-comment-mention-title], [data-blok-database-comment-mention-hint]'),
].map((part) => part.textContent).join(' '));

const type = (input: HTMLTextAreaElement, text: string): void => {
  input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
  input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
};

const press = (input: HTMLElement, key: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

  input.dispatchEvent(event);

  return event;
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('comment composer — Mention (notion-motion.md Round 62 §2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('the Mention button puts "@" at the caret and opens Date, People and Link to page, first option active', async () => {
    const search = vi.fn(async (): Promise<PageSearchResult[]> => [{ pageId: 'p1', title: 'Roadmap', path: ['Team'] }]);
    const { api } = harness({ search });
    const { section } = mount(api);
    const input = inputOf(section);
    const button = section.querySelector<HTMLButtonElement>('[data-blok-database-comment-mention]');

    input.focus();
    type(input, 'hi ');
    button?.click();
    await flush();

    expect(input.value).toBe('hi @');
    expect(input).toHaveFocus();
    expect(button?.getAttribute('aria-label')).toBe('tools.database.commentMention');
    const labels = [...(menu()?.querySelectorAll('[data-blok-database-comment-mention-section]') ?? [])].map((el) => el.textContent);

    expect(labels).toEqual(['tools.database.propertyTypeDate', 'tools.database.commentMentionPeople', 'toolNames.pageLink']);
    expect(optionTexts()[0]).toContain('tools.database.dateToday');
    expect(optionTexts()).toEqual(expect.arrayContaining(['Ann Lee', 'Bob Stone']));
    expect(optionTexts().some((text) => text.includes('Roadmap') && text.includes('Team'))).toBe(true);
    expect(search).toHaveBeenCalledWith('');
    expect(menu()?.querySelector('[aria-selected="true"]')?.textContent).toContain('tools.database.dateToday');
    expect(input.getAttribute('aria-controls')).toBe(menu()?.id);
  });

  it('typing after "@" filters: People by name, Date drops out', async () => {
    const { api } = harness();
    const { section } = mount(api);
    const input = inputOf(section);

    input.focus();
    type(input, '@');
    await flush();
    expect(menu()).not.toBeNull();
    type(input, 'bo');
    await flush();

    expect(optionTexts()).toEqual(['Bob Stone']);
  });

  it('only opens on an "@" that starts a word', async () => {
    const { api } = harness();
    const { section } = mount(api);
    const input = inputOf(section);

    input.focus();
    type(input, 'mail@');
    await flush();

    expect(menu()).toBeNull();
  });

  it('ArrowDown and Enter pick a person: "@query" becomes "@Ann Lee " and the sent comment carries the mention', async () => {
    const { api, blocks } = harness();
    const { section } = mount(api);
    const input = inputOf(section);

    input.focus();
    type(input, 'ask @an');
    await flush();
    press(input, 'Enter');
    expect(input.value).toBe('ask @Ann Lee ');
    expect(menu()).toBeNull();
    type(input, 'now');
    press(input, 'Enter');

    expect(blocks[0].data.text).toBe('ask @Ann Lee now');
    expect(blocks[0].data.mentions).toEqual([{ type: 'person', id: 'u1', start: 4, label: '@Ann Lee' }]);
  });

  it('picking Today stores the day, and a mention whose text was edited away is not saved', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 18, 10));
    const { api, blocks } = harness();
    const { section } = mount(api);
    const input = inputOf(section);

    input.focus();
    type(input, '@');
    await flush();
    press(input, 'Enter');
    const label = input.value.trimEnd();

    expect(label).toBe('@Nov 18, 2026');
    type(input, 'and @bo');
    await flush();
    press(input, 'Enter');
    // Break the second mention's text before sending.
    input.setRangeText('R', input.value.indexOf('Bob'), input.value.indexOf('Bob') + 1);
    press(input, 'Enter');
    vi.useRealTimers();

    expect(blocks[0].data.mentions).toEqual([{ type: 'date', id: '2026-11-18', start: 0, label: '@Nov 18, 2026' }]);
  });

  it('Escape closes only the menu: the text stays and the event is consumed', async () => {
    const { api } = harness();
    const { section } = mount(api);
    const input = inputOf(section);

    input.focus();
    type(input, '@bo');
    await flush();
    const event = press(input, 'Escape');

    expect(menu()).toBeNull();
    expect(input.value).toBe('@bo');
    expect(event.defaultPrevented).toBe(true);
    expect(input.hasAttribute('aria-controls')).toBe(false);
  });

  it('Enter with the menu open picks, it does not send', async () => {
    const { api, blocks } = harness();
    const { section } = mount(api);
    const input = inputOf(section);

    input.focus();
    type(input, '@bo');
    await flush();
    press(input, 'Enter');

    expect(blocks).toHaveLength(0);
  });

  it('a page search that answers after the menu closed draws nothing', async () => {
    const answers: Array<(value: PageSearchResult[]) => void> = [];
    const search = vi.fn(() => new Promise<PageSearchResult[]>((resolve) => answers.push(resolve)));
    const { api } = harness({ search });
    const { section } = mount(api);
    const input = inputOf(section);

    input.focus();
    type(input, '@');
    await flush();
    press(input, 'Escape');
    answers.forEach((answer) => answer([{ pageId: 'p1', title: 'Late' }]));
    await flush();

    expect(menu()).toBeNull();
    expect(document.body.textContent).not.toContain('Late');
  });

  it('a blur and the section going away close the menu', async () => {
    const { api } = harness();
    const { ui, section } = mount(api);
    const input = inputOf(section);

    input.focus();
    type(input, '@');
    await flush();
    input.blur();
    expect(menu()).toBeNull();

    input.focus();
    type(input, ' @');
    await flush();
    expect(menu()).not.toBeNull();
    ui.destroy();
    expect(menu()).toBeNull();
  });

  it('picking a page with the pointer keeps the focus in the composer', async () => {
    const search = vi.fn(async (): Promise<PageSearchResult[]> => [{ pageId: 'p1', title: 'Roadmap' }]);
    const { api, blocks } = harness({ search });
    const { section } = mount(api);
    const input = inputOf(section);

    input.focus();
    type(input, '@road');
    await flush();
    const option = [...(menu()?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])].find((el) => el.textContent?.includes('Roadmap'));
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });

    option?.dispatchEvent(down);
    option?.click();
    expect(down.defaultPrevented).toBe(true);
    expect(input.value).toBe('Roadmap ');
    press(input, 'Enter');

    expect(blocks[0].data.mentions).toEqual([{ type: 'page', id: 'p1', start: 0, label: 'Roadmap' }]);
  });
});

describe('a comment with mentions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const seeded = (page?: Partial<PageConfig>): HTMLElement => {
    const { api, blocks } = harness(page);

    blocks.push({
      id: 'c1',
      name: 'database-comment',
      parentId: 'r1',
      data: {
        text: 'ask @Ann Lee about Roadmap',
        createdAt: 1,
        mentions: [
          { type: 'person', id: 'u1', start: 4, label: '@Ann Lee' },
          { type: 'page', id: 'p1', start: 19, label: 'Roadmap' },
        ],
      },
    });

    return mount(api).section;
  };

  it('shows each mention as a chip in the text', () => {
    const section = seeded();
    const text = section.querySelector('[data-blok-database-comment-text]');
    const chips = [...(text?.querySelectorAll('[data-blok-database-comment-mention-chip]') ?? [])];

    expect(text?.textContent).toBe('ask @Ann Lee about Roadmap');
    expect(chips.map((chip) => [chip.getAttribute('data-blok-database-comment-mention-chip'), chip.textContent])).toEqual([
      ['person', '@Ann Lee'],
      ['page', 'Roadmap'],
    ]);
  });

  it('a page chip links to the page and a plain click opens it the host\'s way', () => {
    const open = vi.fn();
    const section = seeded({ href: (id: string) => `https://pages.test/${id}`, open });
    const chip = section.querySelector<HTMLAnchorElement>('[data-blok-database-comment-mention-chip="page"]');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });

    expect(chip?.getAttribute('href')).toBe('https://pages.test/p1');
    chip?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith('p1', { event: click });
  });

  it('a page href with a script scheme is dropped', () => {
    const section = seeded({ href: () => 'javascript:alert(1)' });
    const chip = section.querySelector('[data-blok-database-comment-mention-chip="page"]');

    expect(chip?.hasAttribute('href')).toBe(false);
  });
});

describe('database-comment mentions data', () => {
  it('the tool keeps a mention only where its label is the text at its start', () => {
    const tool = new DatabaseCommentTool({
      data: {
        text: 'hi @Ann',
        createdAt: 1,
        mentions: [
          { type: 'person', id: 'u1', start: 3, label: '@Ann' },
          { type: 'person', id: 'u2', start: 0, label: '@Bob' },
          { type: 'robot', id: 'x', start: 0, label: 'hi' },
          { type: 'page', id: '', start: 0, label: 'hi' },
        ],
      } as unknown as DatabaseCommentData,
    } as never);

    expect(tool.save().mentions).toEqual([{ type: 'person', id: 'u1', start: 3, label: '@Ann' }]);
  });

  it('the tool leaves the field out when no mention survives', () => {
    const tool = new DatabaseCommentTool({ data: { text: 'hi', createdAt: 1, mentions: [] } } as never);

    expect(tool.save()).not.toHaveProperty('mentions');
  });

  // Plain text like `text`, so a label still matches the text it covers. Chips draw it with textContent.
  it('the sanitizer keeps mentions byte for byte, like the text they cover', () => {
    const mentions = [{ type: 'person', id: 'u<1>', start: 3, label: '@A<b>&' }];
    const [block] = sanitizeBlocks([{
      tool: 'database-comment',
      data: { text: 'hi @A<b>&', createdAt: 1, mentions },
    }], databaseCommentSanitize());

    expect(block.data.text).toBe('hi @A<b>&');
    expect(block.data.mentions).toEqual(mentions);
  });

  it('the agent schema describes mentions', () => {
    expect(DATABASE_COMMENT_DATA.properties).toHaveProperty('mentions');
  });
});
