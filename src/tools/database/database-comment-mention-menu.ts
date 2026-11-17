import type { I18n } from '../../../types';
import type { DatabaseCommentMention } from '../../../types/tools/database-comment';
import { IconClock, IconPage } from '../../components/icons';
import { markEscapeConsumed } from '../../components/utils/consumed-escape';
import { promoteToTopLayer, removeFromTopLayer } from '../../components/utils/top-layer';
import type { PageSearchResult } from '../page/types';

/** A person the menu lists. */
export interface MentionPerson {
  id: string;
  name: string;
}

export interface MentionMenuOptions {
  input: HTMLTextAreaElement;
  /** The menu's DOM parent, so a click on it stays inside the comment box. */
  host: HTMLElement;
  i18n: Pick<I18n, 't'>;
  locale: string;
  people?: () => readonly MentionPerson[];
  /** Absent: no Link to page section. */
  searchPages?: (query: string) => Promise<readonly PageSearchResult[]>;
  /** Replaces `text[start, end)` with the picked mention's label. */
  onPick: (mention: Omit<DatabaseCommentMention, 'start'>, start: number, end: number) => void;
}

export interface MentionMenu {
  /** Opens, filters or closes the menu from the text before the caret. */
  sync(): void;
  close(): void;
  readonly opened: boolean;
}

interface Option {
  mention: Omit<DatabaseCommentMention, 'start'>;
  element: HTMLElement;
}

/** notion-motion.md Round 62 §2: 330 wide, its left 22 before the "@". */
const MENU_WIDTH = 330;
const AT_OFFSET = 22;
/** Its bottom sits 3.5 above the comment box. */
const GAP = 3.5;
const EDGE = 8;
const MAX_QUERY = 40;

const ids = { next: 0 };

/** The "@" that starts the query before the caret: at a word start, no line break after it. */
const queryStart = (text: string, caret: number): number | null => {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');

  if (at === -1 || (at > 0 && !/\s/.test(before[at - 1]))) return null;
  const query = before.slice(at + 1);

  return query.includes('\n') || query.length > MAX_QUERY ? null : at;
};

const dayId = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Where the character at `index` starts, in viewport x: a hidden copy of the textarea lays the text out. */
const caretLeft = (input: HTMLTextAreaElement, index: number): number => {
  const style = getComputedStyle(input);
  const copy = document.createElement('div');
  const mark = document.createElement('span');

  ['font', 'letterSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'borderLeftWidth', 'boxSizing', 'lineHeight', 'tabSize']
    .forEach((name) => copy.style.setProperty(name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), style.getPropertyValue(name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`))));
  copy.style.width = `${input.clientWidth}px`;
  copy.style.whiteSpace = 'pre-wrap';
  copy.style.overflowWrap = 'anywhere';
  copy.style.visibility = 'hidden';
  copy.style.position = 'absolute';
  copy.textContent = input.value.slice(0, index);
  mark.textContent = '@';
  copy.appendChild(mark);
  input.after(copy);
  const left = input.getBoundingClientRect().left + mark.getBoundingClientRect().left - copy.getBoundingClientRect().left - input.scrollLeft;

  copy.remove();

  return left;
};

/**
 * The composer's "@" menu (notion-motion.md Round 62 §2): Date, People and
 * Link to page, the first option active, typing filters, Escape closes only
 * the menu. It lives inside the comment box, so the box's own popover does
 * not take a click on it as a click outside.
 */
export const createMentionMenu = (options: MentionMenuOptions): MentionMenu => {
  const { input, i18n: { t } } = options;
  const listId = `blok-database-comment-mention-${++ids.next}`;
  const state: {
    menu: HTMLElement | null;
    start: number;
    query: string;
    pages: readonly PageSearchResult[];
    search: number;
    options: Option[];
    active: number;
  } = { menu: null, start: -1, query: '', pages: [], search: 0, options: [], active: 0 };

  input.setAttribute('aria-haspopup', 'listbox');
  input.setAttribute('aria-expanded', 'false');

  const label = (text: string): HTMLElement => {
    const el = document.createElement('div');

    el.setAttribute('data-blok-database-comment-mention-section', '');
    el.setAttribute('role', 'presentation');
    el.textContent = text;

    return el;
  };

  const option = (mention: Omit<DatabaseCommentMention, 'start'>, parts: Array<Node | string>): HTMLElement => {
    const element = document.createElement('div');

    element.id = `${listId}-${state.options.length}`;
    element.setAttribute('role', 'option');
    element.setAttribute('data-blok-database-comment-mention-option', mention.type);
    element.append(...parts);
    element.addEventListener('mousedown', (event) => event.preventDefault());
    element.addEventListener('click', () => pick(mention));
    element.addEventListener('mousemove', () => highlight(state.options.findIndex((each) => each.element === element)));
    state.options.push({ mention, element });

    return element;
  };

  const icon = (svg: string): HTMLElement => {
    const el = document.createElement('span');

    el.setAttribute('data-blok-database-comment-mention-icon', '');
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = svg;

    return el;
  };

  const span = (attr: string, text: string): HTMLElement => {
    const el = document.createElement('span');

    el.setAttribute(attr, '');
    el.textContent = text;

    return el;
  };

  const avatar = (name: string): HTMLElement => {
    const el = span('data-blok-database-comment-avatar', Array.from(name.trim())[0]?.toUpperCase() ?? '');

    el.setAttribute('aria-hidden', 'true');

    return el;
  };

  const highlight = (index: number): void => {
    if (index < 0 || index >= state.options.length) return;
    state.active = index;
    state.options.forEach((entry, at) => entry.element.setAttribute('aria-selected', String(at === index)));
    const current = state.options[index].element;

    input.setAttribute('aria-activedescendant', current.id);
    current.scrollIntoView?.({ block: 'nearest' });
  };

  const place = (): void => {
    const menu = state.menu;

    if (menu === null) return;
    const box = (input.closest('[data-blok-popover-container]') ?? options.host).getBoundingClientRect();
    const left = Math.min(Math.max(caretLeft(input, state.start) - AT_OFFSET, EDGE), window.innerWidth - MENU_WIDTH - EDGE);
    // Layout height: the open scale would shrink a measured rect.
    const fits = box.top - GAP - menu.offsetHeight >= EDGE;

    menu.style.left = `${left}px`;
    // Pinned by its bottom, so it grows upward as sections arrive.
    menu.style.bottom = fits ? `${document.documentElement.clientHeight - box.top + GAP}px` : 'auto';
    menu.style.top = fits ? 'auto' : `${box.bottom + GAP}px`;
  };

  const draw = (): void => {
    const menu = state.menu;

    if (menu === null) return;
    const query = state.query.toLowerCase();
    const today = t('tools.database.dateToday');
    const now = new Date();
    const people = (options.people?.() ?? []).filter((person) => person.name.toLowerCase().includes(query));
    const sections: HTMLElement[] = [];

    state.options = [];
    if (today.toLowerCase().startsWith(query)) {
      const day = new Intl.DateTimeFormat(options.locale, { month: 'short', day: 'numeric', year: 'numeric' }).format(now);

      sections.push(label(t('tools.database.propertyTypeDate')), option(
        { type: 'date', id: dayId(now), label: `@${day}` },
        [icon(IconClock), span('data-blok-database-comment-mention-title', today), span('data-blok-database-comment-mention-hint', day)]
      ));
    }
    if (people.length > 0) {
      sections.push(label(t('tools.database.commentMentionPeople')), ...people.map((person) => option(
        { type: 'person', id: person.id, label: `@${person.name}` },
        [avatar(person.name), span('data-blok-database-comment-mention-title', person.name)]
      )));
    }
    if (state.pages.length > 0) {
      sections.push(label(t('toolNames.pageLink')), ...state.pages.map((page) => {
        const title = page.title !== undefined && page.title.trim() !== '' ? page.title : t('tools.page.unresolved');
        const text = document.createElement('span');

        text.setAttribute('data-blok-database-comment-mention-text', '');
        text.append(span('data-blok-database-comment-mention-title', title));
        if (page.path !== undefined && page.path.length > 0) text.append(span('data-blok-database-comment-mention-hint', page.path.join(' / ')));

        return option({ type: 'page', id: page.pageId, label: title }, [icon(IconPage), text]);
      }));
    }
    menu.replaceChildren(...sections);
    menu.hidden = sections.length === 0;
    highlight(0);
    place();
  };

  const searchPages = (): void => {
    const token = ++state.search;

    if (options.searchPages === undefined) return;
    void options.searchPages(state.query).catch((): PageSearchResult[] => []).then((pages) => {
      if (token !== state.search || state.menu === null) return;
      state.pages = pages.filter((page) => page.access !== 'none');
      draw();
    });
  };

  // Window capture runs before the comment popover hears the key in the document's capture phase.
  const onKey = (event: KeyboardEvent): void => {
    if (event.target !== input || event.isComposing || state.menu === null) return;
    const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
    const count = state.options.length;

    if (event.key in moves) {
      if (count > 0) highlight((state.active + moves[event.key] + count) % count);
    } else if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && count > 0) {
      pick(state.options[state.active].mention);
    } else if (event.key === 'Escape') {
      markEscapeConsumed(event);
      close();
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const onScroll = (event: Event): void => {
    if (state.menu !== null && !(event.target instanceof Node && state.menu.contains(event.target))) close();
  };

  const open = (): void => {
    const menu = document.createElement('div');

    menu.id = listId;
    menu.setAttribute('data-blok-database-comment-mention-menu', '');
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', t('tools.database.commentMention'));
    state.menu = menu;
    state.pages = [];
    options.host.appendChild(menu);
    promoteToTopLayer(menu);
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', listId);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    input.addEventListener('blur', close);
  };

  function close(): void {
    const menu = state.menu;

    ++state.search;
    if (menu === null) return;
    state.menu = null;
    state.options = [];
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll, { capture: true });
    input.removeEventListener('blur', close);
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-controls');
    input.removeAttribute('aria-activedescendant');
    removeFromTopLayer(menu);
    menu.remove();
  }

  function pick(mention: Omit<DatabaseCommentMention, 'start'>): void {
    const start = state.start;
    const end = input.selectionStart;

    close();
    options.onPick(mention, start, end);
  }

  const sync = (): void => {
    const start = input.selectionStart === input.selectionEnd ? queryStart(input.value, input.selectionStart) : null;

    if (start === null) {
      close();

      return;
    }
    const query = input.value.slice(start + 1, input.selectionStart);
    const fresh = state.menu === null || start !== state.start;

    if (fresh) {
      close();
      open();
    }
    state.start = start;
    if (fresh || query !== state.query) {
      state.query = query;
      draw();
      searchPages();
    }
  };

  return {
    sync,
    close,
    get opened() {
      return state.menu !== null;
    },
  };
};
