import './page-comments.css';
import type { Blok } from '../../types';
import { BuiltInComments, type CommentAuthor, type StoredComment } from '../../src/tools/database/database-comments-store';
import { createCommentsPanel, openDatabaseConfirm, type CommentsPanel } from './comments-runtime.js';
import { MessageSquare, createElement } from 'lucide';

/** Discussion belongs to the page header, outside the editable block tree. */
export function placePageComments(holder: HTMLElement, element: HTMLElement): void {
  holder.querySelector('[data-blok-page-header]')?.append(element);
}

/** Page discussion uses the same annotation blocks and collaboration as row comments. */
export function mountPageComments(options: {
  editor: Pick<Blok, 'blocks' | 'tools' | 'events' | 'i18n'>;
  author: () => CommentAuthor;
  canComment: () => boolean;
}): { element: HTMLElement; destroy(): void } {
  const { editor } = options;
  const store = new BuiltInComments(editor, options.author);
  const element = document.createElement('section');
  element.setAttribute('data-blok-database-comments-section', '');
  element.setAttribute('data-desktop-page-comments', '');
  element.setAttribute('aria-label', 'Commentaires de la page');
  const controls = document.createElement('div');
  const open = document.createElement('button'); open.type = 'button'; open.textContent = 'Ouverts';
  const resolved = document.createElement('button'); resolved.type = 'button'; resolved.textContent = 'Résolus';
  controls.setAttribute('data-page-comments-filters', '');
  controls.append(open, resolved);
  const body = document.createElement('div');
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.setAttribute('data-page-comments-toggle', '');
  const label = document.createElement('span');
  toggle.append(createElement(MessageSquare, {'aria-hidden':'true', width:'16', height:'16'}), label);
  const content = document.createElement('div'); content.setAttribute('data-page-comments-content', '');
  content.id = `page-discussion-${crypto.randomUUID()}`; toggle.setAttribute('aria-controls', content.id);
  content.append(controls, body); element.append(toggle, content);
  let expanded = store.threads(null).some(thread => !thread.data.resolved);
  const refreshSummary = (): void => {
    const threads = store.threads(null);
    const count = threads.filter(thread => !thread.data.resolved).length;
    label.textContent = threads.length ? `Commentaires${count ? ` (${count})` : ''}` : 'Ajouter un commentaire…';
    toggle.setAttribute('aria-expanded', String(expanded)); content.hidden = !expanded;
    controls.hidden = !threads.some(thread => thread.data.resolved) && !state.resolved;
    element.hidden = !threads.length && !options.canComment();
  };
  const state: { resolved: boolean; writable: boolean; panel: CommentsPanel | null; timer: ReturnType<typeof setTimeout> | null; destroyed: boolean; draft: string } = {
    resolved: false, writable: false, panel: null, timer: null, destroyed: false, draft: '',
  };
  const writable = (): boolean => !state.destroyed && store.available() && options.canComment();
  const own = (comment: StoredComment): boolean => !!comment.data.authorId && comment.data.authorId === options.author().authorId;
  const find = (id: string): StoredComment | undefined => store.threads(null).flatMap(thread => [thread, ...thread.replies]).find(comment => comment.id === id);
  const owned = (id: string): boolean => { const comment = find(id); return !!comment && own(comment); };
  const update = (write: () => void): void => { if (writable()) { write(); render(); } };
  function render(): void {
    if (state.destroyed) return;
    const previous = state.panel?.element.querySelector<HTMLTextAreaElement>(':scope > [data-blok-database-comment-composer] textarea');
    if (previous) state.draft = previous.value;
    state.panel?.destroy(); state.panel = null; body.replaceChildren();
    state.writable = writable();
    refreshSummary();
    open.setAttribute('aria-pressed', String(!state.resolved)); resolved.setAttribute('aria-pressed', String(state.resolved));
    const threads = (): ReturnType<BuiltInComments['threads']> => store.threads(null).filter(thread => (thread.data.resolved === true) === state.resolved);
    state.panel = createCommentsPanel({
      i18n: editor.i18n, locale: 'fr-FR', canComment: state.writable && !state.resolved, threads,
      nameOf: comment => comment.data.authorName ?? editor.i18n.t('tools.database.commentAnonymous'),
      isOwn: own, viewerName: () => options.author().authorName ?? editor.i18n.t('tools.database.commentAnonymous'),
      onAdd: text => update(() => { store.add(null, text); }),
      onReply: (id, text) => update(() => { if (store.threads(null).some(thread => thread.id === id && !thread.data.resolved)) store.reply(id, text); }),
      onEdit: (id, text) => update(() => { if (owned(id)) store.edit(id, text); }),
      onResolve: id => update(() => { if (store.threads(null).some(thread => thread.id === id)) store.resolve(id, true); }),
      onDelete: async id => {
        if (!writable() || !owned(id)) return;
        const confirmed = await openDatabaseConfirm({ title: 'Supprimer ce commentaire ?', confirmLabel: 'Supprimer', cancelLabel: 'Annuler', destructive: true, directionSource: element });
        if (confirmed) update(() => { if (owned(id)) store.remove(id); });
      },
    });
    const composer = state.panel.element.querySelector<HTMLTextAreaElement>(':scope > [data-blok-database-comment-composer] textarea');
    if (composer) { composer.value = state.draft; composer.dispatchEvent(new Event('input')); }
    body.append(state.panel.element);
    if (state.resolved && state.writable) {
      for (const thread of threads()) {
        const reopen = document.createElement('button'); reopen.type = 'button'; reopen.textContent = 'Rouvrir'; reopen.setAttribute('data-page-comment-reopen', '');
        reopen.setAttribute('aria-label', `Rouvrir : ${thread.data.text.slice(0, 80)}`);
        reopen.addEventListener('click', () => update(() => { if (store.threads(null).some(item => item.id === thread.id)) store.resolve(thread.id, false); }));
        const row = [...body.querySelectorAll<HTMLElement>('[data-blok-database-comment-thread]')].find(item => item.getAttribute('data-blok-database-comment-thread') === thread.id);
        row?.append(reopen);
      }
    }
  }
  const onChange = (): void => {
    if (state.destroyed || state.timer !== null) return;
    state.timer = setTimeout(() => {
      state.timer = null;
      if (state.destroyed) return;
      if (state.resolved || state.writable !== writable()) render();
      else { state.panel?.refresh(); refreshSummary(); }
    }, 0);
  };
  open.addEventListener('click', () => { state.resolved = false; render(); });
  resolved.addEventListener('click', () => { state.resolved = true; render(); });
  toggle.addEventListener('click', () => {
    expanded = !expanded; refreshSummary();
    if (expanded) body.querySelector<HTMLTextAreaElement>('textarea')?.focus();
  });
  editor.events.on('block changed', onChange);
  render();
  return { element, destroy() {
    state.destroyed = true;
    editor.events.off('block changed', onChange);
    if (state.timer !== null) clearTimeout(state.timer);
    state.panel?.destroy(); state.panel = null;
    element.remove();
  } };
}
