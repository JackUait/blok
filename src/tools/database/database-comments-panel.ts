import type { I18n } from '../../../types';
import { IconArrowUp, IconCheck, IconDotsHorizontal } from '../../components/icons';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { markEscapeConsumed } from '../../components/utils/consumed-escape';
import { onHover } from '../../components/utils/tooltip';
import type { StoredComment, StoredThread } from './database-comments-store';

const ATTR = {
  panel: 'data-blok-database-comments',
  thread: 'data-blok-database-comment-thread',
  comment: 'data-blok-database-comment',
  avatar: 'data-blok-database-comment-avatar',
  author: 'data-blok-database-comment-author',
  time: 'data-blok-database-comment-time',
  text: 'data-blok-database-comment-text',
  tools: 'data-blok-database-comment-tools',
  composer: 'data-blok-database-comment-composer',
  input: 'data-blok-database-comment-input',
  send: 'data-blok-database-comment-send',
  actions: 'data-blok-database-comment-actions',
} as const;

export interface CommentsPanelOptions {
  i18n: Pick<I18n, 't'>;
  locale: string;
  /** False: read the threads, write nothing. */
  canComment: boolean;
  /** The threads to show, read on every redraw. Resolved threads are left out. */
  threads: () => StoredThread[];
  /** The writer's name as shown; Anonymous when there is none. */
  nameOf: (comment: StoredComment) => string;
  /** Only the writer edits or deletes a comment. */
  isOwn: (comment: StoredComment) => boolean;
  /** No thread yet: the composer starts one. With one: it replies to the first. */
  onAdd: (text: string) => void;
  onReply: (threadId: string, text: string) => void;
  onEdit: (id: string, text: string) => void;
  onResolve: (threadId: string) => void;
  /** Asks first ("Delete this comment?"); resolves once answered. */
  onDelete: (id: string) => Promise<void>;
  now?: () => number;
  /** The viewer's name: the composer starts with their avatar (feel/findings-rowpage R14). */
  viewerName?: () => string;
}

export interface CommentsPanel {
  element: HTMLElement;
  /** Draws the threads again; a draft in the composer survives. */
  refresh(): void;
  focusComposer(): void;
  /** Drops the window Escape listener of an open edit or actions menu. */
  destroy(): void;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "Just now" under a minute, then a short relative time (research/12 §3: "2m"). */
export const commentTime = (at: number, now: number, locale: string, justNow: string): string => {
  const ago = Math.max(0, now - at);

  if (ago < MINUTE) return justNow;
  const format = new Intl.RelativeTimeFormat(locale, { style: 'narrow', numeric: 'always' });

  if (ago < HOUR) return format.format(-Math.floor(ago / MINUTE), 'minute');
  if (ago < DAY) return format.format(-Math.floor(ago / HOUR), 'hour');

  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(at));
};

const iconButton = (attr: string, label: string, icon: string): HTMLButtonElement => {
  const button = document.createElement('button');

  button.type = 'button';
  button.setAttribute(attr, '');
  button.setAttribute('aria-label', label);
  button.innerHTML = icon;
  onHover(button, label);

  return button;
};

/** The first letter of the name, on a neutral disc. */
const avatar = (name: string): HTMLElement => {
  const el = document.createElement('span');

  el.setAttribute(ATTR.avatar, '');
  el.setAttribute('aria-hidden', 'true');
  el.textContent = Array.from(name.trim())[0]?.toUpperCase() ?? '';

  return el;
};

/**
 * One textarea that grows with its text. Enter sends, Shift+Enter breaks the
 * line. Send stays disabled while the text is empty (research/12 §3).
 */
const composer = (options: CommentsPanelOptions, onSend: (text: string) => void, initial = ''): { element: HTMLElement; input: HTMLTextAreaElement } => {
  const { t } = options.i18n;
  const row = document.createElement('div');
  const input = document.createElement('textarea');
  const send = iconButton(ATTR.send, t('tools.database.commentSend'), IconArrowUp);

  row.setAttribute(ATTR.composer, '');
  input.setAttribute(ATTR.input, '');
  input.rows = 1;
  input.value = initial;
  input.placeholder = t('tools.database.commentPlaceholder');
  input.setAttribute('aria-label', t('tools.database.commentPlaceholder'));
  const sync = (): void => {
    send.disabled = input.value.trim() === '';
  };
  const submit = (): void => {
    const text = input.value.trim();

    if (text === '') return;
    input.value = '';
    sync();
    onSend(text);
  };

  sync();
  input.addEventListener('input', sync);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    submit();
  });
  send.addEventListener('click', submit);
  if (options.viewerName !== undefined) row.append(avatar(options.viewerName()));
  row.append(input, send);

  return { element: row, input };
};

/**
 * Notion's comment thread and composer (research/12 §3, research/19 §2d): each
 * comment shows its writer, a short time and the text; hovering one shows
 * Resolve and More actions. The composer below starts a thread, then replies.
 * The panel is a keyboard owner, so typing never reaches the editor.
 */
export const createCommentsPanel = (options: CommentsPanelOptions): CommentsPanel => {
  const { t } = options.i18n;
  const now = options.now ?? Date.now;
  const panel = document.createElement('div');
  const list = document.createElement('div');
  const editing: { id: string | null } = { id: null };
  const stopEditKeys: { current: (() => void) | null } = { current: null };
  /** Closes the one open actions menu and drops its Escape listener. */
  const openMenu: { close: (() => void) | null } = { close: null };

  panel.setAttribute(ATTR.panel, '');
  panel.setAttribute(DATA_ATTR.keyboardOwner, '');
  panel.setAttribute(DATA_ATTR.annotation, '');
  list.setAttribute('role', 'list');

  const editor = (comment: StoredComment): HTMLElement => {
    const box = composer(options, (text) => {
      editing.id = null;
      options.onEdit(comment.id, text);
      draw();
    }, comment.data.text);

    // One Escape leaves the edit, not the whole popover. The popover hears
    // Escape in the document's capture phase, so this listens on window.
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.target !== box.input) return;
      event.preventDefault();
      event.stopPropagation();
      markEscapeConsumed(event);
      editing.id = null;
      draw();
    };

    window.addEventListener('keydown', onEscape, true);
    stopEditKeys.current = (): void => window.removeEventListener('keydown', onEscape, true);
    queueMicrotask(() => box.input.focus());

    return box.element;
  };

  const commentRow = (comment: StoredComment, thread: StoredThread): HTMLElement => {
    const row = document.createElement('div');
    const head = document.createElement('div');
    const name = options.nameOf(comment);
    const author = document.createElement('span');
    const time = document.createElement('span');

    row.setAttribute(ATTR.comment, comment.id);
    row.setAttribute('role', 'listitem');
    author.setAttribute(ATTR.author, '');
    author.textContent = name;
    time.setAttribute(ATTR.time, '');
    time.textContent = commentTime(comment.data.createdAt, now(), options.locale, t('tools.database.commentJustNow'))
      + (comment.data.editedAt === undefined ? '' : ` ${t('tools.database.commentEdited')}`);
    head.append(avatar(name), author, time);
    row.appendChild(head);

    if (editing.id === comment.id) {
      row.appendChild(editor(comment));

      return row;
    }
    const text = document.createElement('div');

    text.setAttribute(ATTR.text, '');
    text.textContent = comment.data.text;
    row.appendChild(text);

    if (!options.canComment) return row;
    const tools = document.createElement('div');

    tools.setAttribute(ATTR.tools, '');
    if (comment.id === thread.id) {
      const resolve = iconButton('data-blok-database-comment-resolve', t('tools.database.commentResolve'), IconCheck);

      resolve.addEventListener('click', () => options.onResolve(thread.id));
      tools.appendChild(resolve);
    }
    if (options.isOwn(comment)) {
      const more = iconButton(ATTR.actions, t('tools.database.commentMoreActions'), IconDotsHorizontal);

      // A menu inside the panel: a second popover would close the thread's.
      const menu = document.createElement('div');
      const item = (name: string, label: string, run: () => void): HTMLButtonElement => {
        const button = document.createElement('button');

        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        button.setAttribute('data-blok-database-comment-action', name);
        button.textContent = label;
        button.addEventListener('click', () => {
          closeMenu();
          run();
        });

        return button;
      };

      const closeMenu = (): void => {
        menu.hidden = true;
        more.setAttribute('aria-expanded', 'false');
        window.removeEventListener('keydown', onEscape, true);
        if (openMenu.close === closeMenu) openMenu.close = null;
      };
      // One Escape closes this menu, not the popover (same window capture as the edit).
      const onEscape = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        markEscapeConsumed(event);
        closeMenu();
        more.focus();
      };

      menu.setAttribute('role', 'menu');
      menu.setAttribute('data-blok-database-comment-menu', '');
      menu.hidden = true;
      menu.append(
        item('edit', t('tools.database.commentEdit'), () => {
          editing.id = comment.id;
          draw();
        }),
        item('delete', t('tools.database.commentDelete'), () => {
          void options.onDelete(comment.id).then(draw);
        })
      );
      more.setAttribute('aria-haspopup', 'menu');
      more.addEventListener('click', () => {
        if (!menu.hidden) {
          closeMenu();

          return;
        }
        openMenu.close?.();
        menu.hidden = false;
        more.setAttribute('aria-expanded', 'true');
        window.addEventListener('keydown', onEscape, true);
        openMenu.close = closeMenu;
      });
      tools.appendChild(more);
      row.appendChild(menu);
    }
    row.prepend(tools);

    return row;
  };

  const box = composer(options, (text) => {
    const first = options.threads()[0];

    if (first === undefined) options.onAdd(text);
    else options.onReply(first.id, text);
    draw();
  });

  const stopKeys = (): void => {
    stopEditKeys.current?.();
    stopEditKeys.current = null;
    openMenu.close?.();
  };

  const draw = (): void => {
    stopKeys();
    const threads = options.threads();

    list.replaceChildren(...threads.map((thread) => {
      const el = document.createElement('div');

      el.setAttribute(ATTR.thread, thread.id);
      el.append(commentRow(thread, thread), ...thread.replies.map((reply) => commentRow(reply, thread)));

      return el;
    }));
    list.hidden = threads.length === 0;
  };

  panel.appendChild(list);
  if (options.canComment) panel.appendChild(box.element);
  draw();

  return {
    element: panel,
    refresh: draw,
    focusComposer: () => box.input.focus(),
    destroy: stopKeys,
  };
};
