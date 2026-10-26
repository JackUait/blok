import type { API } from '../../../types';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import { isAnnotationType } from '../../shared/annotation-blocks';
import { DATABASE_MENU_CLASS } from './database-group-menu';
import { openDatabaseConfirm } from './database-confirm-dialog';
import { createCommentsPanel, type CommentsPanel } from './database-comments-panel';
import { BuiltInComments, type CommentAuthor, type StoredComment, type StoredThread } from './database-comments-store';

export interface BuiltInCommentsUiOptions {
  api: API;
  locale: () => string;
  /** The host's current user (`people.me`), if it has one. */
  me: () => string | null;
  personName: (id: string) => string | undefined;
  /** `permissions.can('comment')`. */
  permitted: () => boolean;
  /** The editor is read-only: threads are read, never written. */
  readOnly: () => boolean;
  /** A comment changed here or in a peer: the badges read their counts again. */
  onChange: () => void;
}

const parentOf = (payload: unknown): { name?: unknown; parentId?: unknown } | undefined =>
  (payload as { event?: { detail?: { target?: { name?: unknown; parentId?: unknown } } } } | undefined)?.event?.detail?.target;

/**
 * The database's own comments when the host gives no `comments` hook (user
 * decision 2026-10-16): threads live in the document as `database-comment`
 * blocks, drawn in a popover from the existing entry points and in the row page.
 */
export class BuiltInCommentsUi {
  private readonly options: BuiltInCommentsUiOptions;
  private readonly store: BuiltInComments;
  private popover: PopoverDesktop | null = null;
  private readonly panels = new Set<CommentsPanel>();
  /** Feed card boxes: redrawn when a comment changes; release drops the box's composer. */
  private readonly boxes = new Map<HTMLElement, { draw: () => void; release: () => void }>();
  private redraw: ReturnType<typeof setTimeout> | null = null;

  constructor(options: BuiltInCommentsUiOptions) {
    this.options = options;
    this.store = new BuiltInComments(options.api, () => this.author());
  }

  /** Starts hearing comment changes. The database calls it after its own listeners. */
  public listen(): void {
    this.options.api.events.on('block changed', this.handleChange);
  }

  /** The comment tool is registered and permissions allow comments. */
  public enabled(): boolean {
    return this.options.permitted() && this.store.available();
  }

  /** A person here could write a comment now: what the thread panel's composer needs. */
  public writable(): boolean {
    return this.enabled() && !this.options.readOnly();
  }

  public count(rowId: string): number {
    return this.enabled() ? this.store.count(rowId) : 0;
  }

  /** The thread popover under `anchor`: a cell's threads, or the row's. */
  public open(rowId: string, propertyId: string | undefined, anchor: HTMLElement): void {
    this.close();
    const panel = this.panel(rowId, propertyId);
    const popover = new PopoverDesktop({
      class: DATABASE_MENU_CLASS,
      trigger: anchor,
      items: [{ type: PopoverItemType.Html, element: panel.element, name: 'database-comments' }],
      width: 'auto',
      flippable: true,
      autoFocusFirstItem: false,
    });

    this.popover = popover;
    popover.on(PopoverEvent.Closed, () => {
      if (this.popover !== popover) return;
      this.popover = null;
      this.panels.delete(panel);
      panel.destroy();
      queueMicrotask(() => popover.destroy());
    });
    popover.show();
    panel.focusComposer();
  }

  /** The row page's "Comments" section (research/12 §3): threads, then an always-shown composer. */
  public section(rowId: string): HTMLElement {
    const section = document.createElement('section');
    const label = document.createElement('div');
    const panel = this.panel(rowId, undefined);

    section.setAttribute('data-blok-database-comments-section', '');
    label.setAttribute('data-blok-database-comments-label', '');
    label.textContent = this.options.api.i18n.t('tools.database.commentsSection');
    section.append(label, panel.element);
    section.setAttribute('aria-label', label.textContent);

    return section;
  }

  /**
   * A feed card's comment box (research/19 §2d): "Add a comment…" until the
   * row has an open comment, then "N reply · <time>", which opens the thread.
   */
  public feedBox(rowId: string): HTMLElement {
    const box = document.createElement('div');
    const state = { release: (): void => undefined };
    const draw = (): void => {
      state.release();
      state.release = () => undefined;
      const comments = this.store.threads(rowId)
        .filter((thread) => thread.data.resolved !== true)
        .flatMap((thread) => [thread, ...thread.replies]);

      if (comments.length > 0) {
        box.replaceChildren(this.feedSummary(rowId, comments));

        return;
      }
      if (this.options.readOnly()) {
        box.replaceChildren();

        return;
      }
      // Shows no thread, so the composer always starts a new one.
      const panel = this.panel(rowId, undefined, () => []);

      box.replaceChildren(panel.element);
      state.release = () => {
        this.panels.delete(panel);
        panel.destroy();
      };
    };

    box.setAttribute('data-blok-database-feed-comments', '');
    draw();
    this.boxes.set(box, { draw, release: () => state.release() });

    return box;
  }

  public close(): void {
    this.popover?.hide();
  }

  public destroy(): void {
    this.options.api.events.off('block changed', this.handleChange);
    if (this.redraw !== null) clearTimeout(this.redraw);
    this.close();
    this.panels.forEach((panel) => panel.destroy());
    this.panels.clear();
    this.boxes.forEach((box) => box.release());
    this.boxes.clear();
  }

  private readonly handleChange = (payload: unknown): void => {
    const target = parentOf(payload);

    if (target !== undefined && !isAnnotationType(target.name)) return;
    // The event fires before the new block is linked under its row.
    if (this.redraw !== null) return;
    this.redraw = setTimeout(() => {
      this.redraw = null;
      // A row page that closed took its section out of the page.
      [...this.panels].filter((panel) => !panel.element.isConnected).forEach((panel) => {
        panel.destroy();
        this.panels.delete(panel);
      });
      this.panels.forEach((panel) => panel.refresh());
      // A feed redraw replaced its cards, and their boxes with them.
      [...this.boxes].forEach(([element, box]) => {
        if (element.isConnected) {
          box.draw();

          return;
        }
        box.release();
        this.boxes.delete(element);
      });
      this.options.onChange();
    }, 0);
  };

  /** "1 reply" or "N replies", then the latest comment's time; opens the thread. */
  private feedSummary(rowId: string, comments: StoredComment[]): HTMLElement {
    const { t } = this.options.api.i18n;
    const locale = this.options.locale();
    const latest = comments.reduce((last, comment) => (comment.data.createdAt > last.data.createdAt ? comment : last));
    const button = document.createElement('button');
    const initial = document.createElement('span');
    const count = document.createElement('span');
    const time = document.createElement('span');
    const at = new Date(latest.data.createdAt);
    const today = at.toDateString() === new Date().toDateString();

    button.type = 'button';
    button.setAttribute('data-blok-database-feed-comments-summary', '');
    initial.setAttribute('data-blok-database-comment-avatar', '');
    initial.setAttribute('aria-hidden', 'true');
    initial.textContent = Array.from(this.nameOf(latest).trim())[0]?.toUpperCase() ?? '';
    count.setAttribute('data-blok-database-feed-comments-count', '');
    count.textContent = t('tools.database.feedCommentReplies', { count: comments.length });
    time.setAttribute('data-blok-database-feed-comments-time', '');
    // Notion shows the clock time (research/19 §2d); an older day shows its date.
    time.textContent = new Intl.DateTimeFormat(locale, today ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric' }).format(at);
    button.append(initial, count, time);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.open(rowId, undefined, button);
    });

    return button;
  }

  private panel(rowId: string, propertyId: string | undefined, shown?: () => StoredThread[]): CommentsPanel {
    const { api } = this.options;
    const canComment = !this.options.readOnly();
    const threads = shown ?? ((): StoredThread[] => this.store.threads(rowId)
      .filter((thread) => thread.data.resolved !== true && (propertyId === undefined || thread.data.propertyId === propertyId)));
    const panel = createCommentsPanel({
      i18n: api.i18n,
      locale: this.options.locale(),
      canComment,
      threads,
      nameOf: (comment) => this.nameOf(comment),
      isOwn: (comment) => this.isOwn(comment),
      viewerName: () => this.author().authorName ?? api.i18n.t('tools.database.commentAnonymous'),
      onAdd: (text) => { this.store.add(rowId, text, propertyId); },
      onReply: (threadId, text) => { this.store.reply(threadId, text); },
      onEdit: (id, text) => this.store.edit(id, text),
      onResolve: (threadId) => this.store.resolve(threadId, true),
      onDelete: async (id) => {
        const confirmed = await openDatabaseConfirm({
          title: api.i18n.t('tools.database.commentDeleteConfirm'),
          confirmLabel: api.i18n.t('tools.database.commentDelete'),
          cancelLabel: api.i18n.t('tools.database.commentCancel'),
          destructive: true,
          directionSource: panel.element,
          // Inside the thread popover, so the confirm's focus does not close it.
          ...this.popoverSurface(panel.element),
        });

        if (confirmed) this.store.remove(id);
      },
    });

    this.panels.add(panel);

    return panel;
  }

  private popoverSurface(element: HTMLElement): { container?: HTMLElement } {
    const surface = element.closest<HTMLElement>('[data-blok-popover]');

    return surface === null ? {} : { container: surface };
  }

  /** The host's user; else the collaboration display name; else nobody, shown as Anonymous. */
  private author(): CommentAuthor {
    const me = this.options.me();

    if (me !== null) {
      const name = this.options.personName(me);

      return { authorId: me, ...(name === undefined ? {} : { authorName: name }) };
    }
    const name = this.collaborationName();

    return name === undefined ? {} : { authorName: name };
  }

  private collaborationName(): string | undefined {
    const name = this.options.api.config.collaboration?.user?.name;

    return typeof name === 'string' && name.trim() !== '' ? name : undefined;
  }

  private nameOf(comment: StoredComment): string {
    const fromHost = comment.data.authorId === undefined ? undefined : this.options.personName(comment.data.authorId);

    return fromHost ?? comment.data.authorName ?? this.options.api.i18n.t('tools.database.commentAnonymous');
  }

  /** The writer, by host id when the comment has one, else by name; two anonymous writers are one. */
  private isOwn(comment: StoredComment): boolean {
    const mine = this.author();

    if (comment.data.authorId !== undefined) return comment.data.authorId === mine.authorId;

    return mine.authorId === undefined && comment.data.authorName === mine.authorName;
  }
}
