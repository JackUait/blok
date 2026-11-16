import { watchLocalProfile } from './local-profile';
import type { API, Blok, InlineTool } from '../../types';
import type { MenuConfig } from '../../types/tools';
import type { CommentAnchor } from '../../types/tools/database-comment';
import { MessageSquare, X, ArrowLeft, createElement } from 'lucide';
import { BuiltInComments, type CommentAuthor, type StoredComment, type StoredThread } from '../../src/tools/database/database-comments-store';
import { createCommentsPanel, openDatabaseConfirm, type CommentsPanel } from './comments-runtime.js';
import { captureCommentAnchor, resolveCommentAnchor } from './comment-anchor';
import './inline-comments.css';

const REQUEST = 'blok:comment-selection';

/** The host handles the discussion; the inline tool only hands it the selection. */
export class CommentInlineTool implements InlineTool {
  static isInline = true;
  static title = 'Commenter';
  constructor(private options: { api: API }) {}
  render(): MenuConfig {
    const selection = window.getSelection();
    const saved = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    return { name: 'comment', title: 'Commenter', icon: createElement(MessageSquare).outerHTML,
      onActivate: () => {
        if (!saved || saved.collapsed) return;
        const origin = saved.commonAncestorContainer;
        const target = origin instanceof Element ? origin : origin.parentElement;
        this.options.api.inlineToolbar.close();
        target?.dispatchEvent(new CustomEvent(REQUEST, { bubbles: true, detail: saved }));
      } };
  }
}

export function mountInlineComments(options: {
  holder: HTMLElement;
  editor: Pick<Blok, 'blocks' | 'tools' | 'events' | 'i18n'>;
  author(): CommentAuthor & { avatarUrl?: string };
  canComment(): boolean;
}): { element: HTMLButtonElement; destroy(): void } {
  const { holder, editor } = options;
  const store = new BuiltInComments(editor, options.author);
  const layer = document.createElement('div');
  layer.setAttribute('data-inline-comments-layer', '');
  layer.setAttribute('data-blok-mutation-free', 'true');
  layer.setAttribute('data-blok-keyboard-owner', '');
  (holder.querySelector('[data-blok-editor]') ?? holder).append(layer);
  const paint = document.createElement('div'); layer.append(paint);
  const element = button('Tous les commentaires', MessageSquare);
  element.setAttribute('data-inline-comments-open', '');
  const state = {
    panel: null as HTMLElement | null,
    discussion: null as CommentsPanel | null,
    selected: null as string | null,
    pending: null as CommentAnchor | null,
    codeAction: null as HTMLButtonElement | null,
    codeSelection: null as Range | null,
    resolved: false,
    destroyed: false,
    frame: 0,
    panelSignature: '',
  };
  const drafts = new Map<string, string>();
  const threads = () => store.threads(null);
  const writable = () => !state.destroyed && options.canComment() && store.available();
  const own = (comment: StoredComment) => !!comment.data.authorId && comment.data.authorId === options.author().authorId;
  const find = (id: string) => threads().flatMap(thread => [thread, ...thread.replies]).find(comment => comment.id === id);
  const draftKey = () => state.selected ?? (state.pending ? JSON.stringify(state.pending) : 'list');
  const saveDraft = () => {
    const input = state.discussion?.element.querySelector<HTMLTextAreaElement>(':scope > [data-blok-database-comment-composer] textarea');
    if (input) drafts.set(draftKey(), input.value);
  };
  const close = (restoreFocus = true) => {
    saveDraft(); state.discussion?.destroy(); state.discussion = null; state.panel?.remove(); state.panel = null;
    state.selected = null; state.pending = null;
    element.setAttribute('aria-expanded', 'false');
    if (restoreFocus) element.focus();
    schedule();
  };
  const mutate = (write: () => void) => { if (writable()) { write(); refresh(); } };
  const quoteText = (anchor: CommentAnchor) => anchor.segments.map(segment => segment.quote).join('\n');
  const locate = (anchor: CommentAnchor) => {
    const ranges = resolveCommentAnchor(holder, anchor);
    const node = ranges?.[0]?.startContainer;
    (node instanceof Element ? node : node?.parentElement)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  };
  function openThread(id: string): void {
    saveDraft(); state.selected = id; state.pending = null;
    const anchor = threads().find(thread => thread.id === id)?.data.anchor;
    if (anchor) locate(anchor);
    renderPanel(); schedule();
  }
  function clearPanel(): void {
    state.discussion?.destroy(); state.discussion = null; state.panel?.remove();
  }
  function renderPanel(): void {
    clearPanel();
    state.panel = document.createElement('aside'); state.panel.setAttribute('data-inline-comment-panel', '');
    state.panel.setAttribute('data-blok-database-comments-section', ''); state.panel.setAttribute('role', 'dialog');
    state.panel.setAttribute('aria-label', state.selected || state.pending ? 'Discussion sur le passage' : 'Commentaires');
    const header = document.createElement('header');
    if (state.selected || state.pending) {
      const back = button('Tous les commentaires', ArrowLeft);
      back.addEventListener('click', () => { saveDraft(); state.selected = null; state.pending = null; renderPanel(); }); header.append(back);
    }
    const title = document.createElement('strong'); title.textContent = state.selected || state.pending ? 'Discussion' : 'Commentaires';
    const dismiss = button('Fermer les commentaires', X); dismiss.addEventListener('click', () => close());
    header.append(title, dismiss); state.panel.append(header);
    element.setAttribute('aria-expanded', 'true');
    const thread = threads().find(item => item.id === state.selected);
    state.panelSignature = `${state.selected}:${thread?.data.resolved}:${writable()}`;
    if (!state.selected && !state.pending) {
      renderList(state.panel);
    } else if (state.selected && !thread) {
      const gone = document.createElement('p'); gone.textContent = 'Ce fil a été supprimé.'; state.panel.append(gone);
    } else {
      renderDiscussion(state.panel, thread);
    }
    layer.append(state.panel);
    positionPanel();
    focusPanel();
  }
  function focusPanel(): void {
    if (state.pending) state.discussion?.focusComposer();
    else state.panel?.querySelector<HTMLButtonElement>('button')?.focus();
  }
  function renderList(panel: HTMLElement): void {
    const filters = document.createElement('nav'); filters.setAttribute('aria-label', 'État des commentaires');
    for (const [value, label] of [[false, 'Ouverts'], [true, 'Résolus']] as const) {
      const tab = document.createElement('button'); tab.type = 'button'; tab.textContent = label;
      tab.setAttribute('data-inline-comment-filter', value ? 'resolved' : 'open'); tab.setAttribute('aria-pressed', String(state.resolved === value));
      tab.addEventListener('click', () => { state.resolved = value; renderPanel(); }); filters.append(tab);
    }
    panel.append(filters);
    const items = threads().filter(item => !!item.data.resolved === state.resolved);
    if (!items.length) { const empty = document.createElement('p'); empty.textContent = state.resolved ? 'Aucun commentaire résolu.' : 'Aucun commentaire ouvert. Sélectionnez un passage puis choisissez « Commenter » (⌘⇧M / Ctrl⇧M).'; panel.append(empty); }
    for (const item of items) {
      const row = document.createElement('button'); row.type = 'button'; row.setAttribute('data-inline-comment-list-item', item.id);
      const quote = document.createElement('small'); quote.textContent = item.data.anchor ? quoteText(item.data.anchor) : 'Page entière';
      const text = document.createElement('span'); text.textContent = item.data.text;
      const meta = document.createElement('small'); meta.textContent = `${(own(item) ? options.author().authorName : item.data.authorName) ?? 'Anonyme'} · ${item.replies.length} réponse${item.replies.length === 1 ? '' : 's'}`;
      row.append(quote, text, meta);
      if (item.data.anchor && !resolveCommentAnchor(holder, item.data.anchor)) { const detached = document.createElement('small'); detached.textContent = 'Passage introuvable'; row.append(detached); }
      row.addEventListener('click', () => openThread(item.id)); panel.append(row);
    }
  }
  function renderDiscussion(panel: HTMLElement, thread: StoredThread | undefined): void {
    const anchor = state.pending ?? thread?.data.anchor;
    if (anchor) {
      const quote = document.createElement('button'); quote.type = 'button'; quote.setAttribute('data-inline-comment-quote', ''); quote.textContent = quoteText(anchor);
      quote.title = 'Aller au passage'; quote.addEventListener('click', () => locate(anchor)); panel.append(quote);
      const detached = document.createElement('p'); detached.setAttribute('data-inline-comment-detached', '');
      detached.textContent = 'Passage introuvable ou modifié. Le texte cité est conservé.'; detached.hidden = !!resolveCommentAnchor(holder, anchor); panel.append(detached);
    }
    state.discussion = createCommentsPanel({ i18n: editor.i18n, locale: 'fr-FR', canComment: writable() && !thread?.data.resolved,
      threads: () => threads().filter(item => item.id === state.selected),
      nameOf: item => (own(item) ? options.author().authorName : item.data.authorName) ?? 'Anonyme',
      avatarOf: item => own(item) ? options.author().avatarUrl : undefined, viewerAvatar: () => options.author().avatarUrl, isOwn: own, viewerName: () => options.author().authorName ?? 'Anonyme',
      onAdd: text => mutate(() => {
        if (!state.pending) return;
        const id = store.add(null, text, undefined, state.pending);
        if (id) { drafts.delete(draftKey()); state.selected = id; state.pending = null; renderPanel(); }
      }),
      onReply: (id, text) => mutate(() => { if (threads().some(item => item.id === id && !item.data.resolved)) store.reply(id, text); }),
      onEdit: (id, text) => mutate(() => { const item = find(id); if (item && own(item)) store.edit(id, text); }),
      onResolve: id => mutate(() => { if (threads().some(item => item.id === id)) store.resolve(id, true); }),
      onDelete: async id => {
        const item = find(id); if (!writable() || !item || !own(item)) return;
        if (await openDatabaseConfirm({ title: 'Supprimer ce commentaire ?', confirmLabel: 'Supprimer', cancelLabel: 'Annuler', destructive: true, directionSource: state.panel })) {
          mutate(() => { const current = find(id); if (current && own(current)) store.remove(id); });
        }
      },
    });
    panel.append(state.discussion.element);
    const input = state.discussion.element.querySelector<HTMLTextAreaElement>(':scope > [data-blok-database-comment-composer] textarea');
    if (input) { input.value = drafts.get(draftKey()) ?? ''; input.dispatchEvent(new Event('input')); }
    if (thread?.data.resolved) {
      const status = document.createElement('p'); status.textContent = 'Discussion résolue'; panel.append(status);
      if (writable()) {
        const reopen = document.createElement('button'); reopen.type = 'button'; reopen.textContent = 'Rouvrir'; reopen.setAttribute('data-inline-comment-reopen', '');
        reopen.addEventListener('click', () => mutate(() => store.resolve(thread.id, false))); panel.append(reopen);
      }
    }
  }
  function refresh(): void {
    if (state.destroyed) return;
    const thread = threads().find(item => item.id === state.selected);
    if (!state.panel) { schedule(); return; }
    if ((!state.selected && !state.pending) || !thread && state.selected || state.panelSignature !== `${state.selected}:${thread?.data.resolved}:${writable()}`) { saveDraft(); renderPanel(); }
    else {
      state.discussion?.refresh();
      const anchor = state.pending ?? thread?.data.anchor;
      const detached = state.panel.querySelector<HTMLElement>('[data-inline-comment-detached]');
      if (anchor && detached) detached.hidden = !!resolveCommentAnchor(holder, anchor);
    }
    schedule();
  }
  function positionPanel(): void {
    if (!state.panel) return;
    const anchor = state.pending ?? threads().find(item => item.id === state.selected)?.data.anchor;
    const rect = anchor && resolveCommentAnchor(holder, anchor)?.[0]?.getBoundingClientRect?.();
    const top = rect ? Math.max(64, Math.min(rect.top - 12, innerHeight - state.panel.offsetHeight - 20)) : 90;
    state.panel.style.top = `${top}px`;
  }
  function drawHighlights(id: string, ranges: Range[]): void {
    const rects = ranges.flatMap(range => Array.from(range.getClientRects?.() ?? []));
    for (const rect of rects) {
      if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) continue;
      const mark = document.createElement('span'); mark.setAttribute('data-inline-comment-highlight', id);
      mark.dataset.active = String(id === state.selected || id === 'draft');
      Object.assign(mark.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }); paint.append(mark);
    }
  }
  function draw(): void {
    state.frame = 0; if (state.destroyed) return;
    positionCodeAction();
    positionPanel();
    paint.replaceChildren();
    const all = threads(); const open = all.filter(item => !item.data.resolved);
    element.title = `Tous les commentaires (${open.length} ouverts)`;
    element.setAttribute('aria-label', element.title);
    const badges = new Map<string, { ids: string[]; rect: DOMRect; right: number }>();
    const targets = state.pending ? [...open, { id: 'draft', data: { anchor: state.pending } }] : open;
    for (const item of targets) {
      const anchor = item.data.anchor; if (!anchor) continue;
      const ranges = resolveCommentAnchor(holder, anchor); if (!ranges) continue;
      drawHighlights(item.id, ranges);
      if (item.id === 'draft') continue;
      const rect = ranges[0].getBoundingClientRect?.(); if (!rect || !rect.height || rect.bottom < 0 || rect.top > innerHeight) continue;
      const first = anchor.segments[0].blockId;
      const node = ranges[0].startContainer;
      const block = (node instanceof Element ? node : node.parentElement)?.closest('[data-blok-id]');
      const existing = badges.get(first);
      if (existing) existing.ids.push(item.id);
      else badges.set(first, { ids: [item.id], rect, right: block?.getBoundingClientRect().right ?? rect.right });
    }
    for (const { ids, rect, right } of badges.values()) {
      const badge = button(`${ids.length} discussion${ids.length > 1 ? 's' : ''}`, MessageSquare);
      badge.setAttribute('data-inline-comment-badge', ''); badge.append(document.createTextNode(String(ids.length)));
      Object.assign(badge.style, { left: `${Math.min(innerWidth - 58, right + 8)}px`, top: `${rect.top}px` });
      badge.addEventListener('click', () => {
        // Repeated clicks cycle discussions attached to this block.
        openThread(ids[(ids.indexOf(state.selected ?? '') + 1) % ids.length]);
      }); paint.append(badge);
    }
  }
  function schedule(): void { if (!state.destroyed && !state.frame) state.frame = requestAnimationFrame(draw); }
  const start = (range: Range) => {
    if (!writable()) return;
    const anchor = captureCommentAnchor(holder, range); if (!anchor) return;
    clearCodeAction();
    saveDraft(); state.selected = null; state.pending = anchor; renderPanel(); schedule();
  };
  function clearCodeAction(): void {
    state.codeAction?.remove(); state.codeAction = null; state.codeSelection = null;
  }
  function positionCodeAction(): void {
    if (!state.codeAction || !state.codeSelection) return;
    const rect = state.codeSelection.getBoundingClientRect?.();
    if (!rect) return;
    state.codeAction.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - state.codeAction.offsetWidth - 8))}px`;
    state.codeAction.style.top = `${Math.max(8, rect.top - state.codeAction.offsetHeight - 8)}px`;
  }
  // Code keeps the core formatting toolbar disabled. This host action only
  // captures a quote; it never inserts markup into the Prism/plain-text field.
  const codeSelectionChanged = () => {
    const selection = window.getSelection();
    if (!writable() || state.pending || !selection?.rangeCount || selection.isCollapsed) { clearCodeAction(); return; }
    const range = selection.getRangeAt(0);
    const origin = range.commonAncestorContainer;
    const target = origin instanceof Element ? origin : origin.parentElement;
    const code = target?.closest('pre > code');
    if (!code || !holder.contains(code) || !captureCommentAnchor(holder, range)) { clearCodeAction(); return; }
    state.codeSelection = range.cloneRange();
    if (!state.codeAction) {
      state.codeAction = button('Commenter', MessageSquare);
      state.codeAction.append(document.createTextNode('Commenter'));
      state.codeAction.setAttribute('data-inline-comment-code-action', '');
      state.codeAction.addEventListener('mousedown', event => event.preventDefault());
      state.codeAction.addEventListener('click', () => { if (state.codeSelection) start(state.codeSelection); });
      layer.append(state.codeAction);
    }
    positionCodeAction();
  };
  const request = (event: Event) => start((event as CustomEvent<Range>).detail);
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && state.panel && !event.defaultPrevented) { event.preventDefault(); close(); return; }
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== 'm' || event.defaultPrevented || !writable()) return;
    if (event.target instanceof Element && event.target.closest('[data-blok-keyboard-owner], input, textarea')) return;
    const selection = window.getSelection(); if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0); if (!captureCommentAnchor(holder, range)) return;
    event.preventDefault(); start(range);
  };
  const clickPassage = (event: MouseEvent) => {
    if (layer.contains(event.target as Node) || window.getSelection()?.toString()) return;
    for (const thread of threads()) {
      if (!thread.data.anchor || thread.data.resolved) continue;
      const ranges = resolveCommentAnchor(holder, thread.data.anchor);
      if (ranges?.some(range => Array.from(range.getClientRects?.() ?? []).some(rect => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom))) {
        openThread(thread.id); break;
      }
    }
  };
  element.addEventListener('click', () => { if (state.panel) close(); else { state.selected = null; state.pending = null; renderPanel(); } });
  holder.addEventListener(REQUEST, request);
  holder.addEventListener('click', clickPassage);
  document.addEventListener('keydown', keydown);
  document.addEventListener('selectionchange', codeSelectionChanged);
  document.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule);
  const profileChanged = (): void => { if (state.panel) { saveDraft(); renderPanel(); } };
  const stopProfile = watchLocalProfile(profileChanged);
  editor.events.on('block changed', refresh);
  const observer = new MutationObserver(records => {
    if (records.some(record => !layer.contains(record.target) && !element.contains(record.target) && !(record.target instanceof Element && record.target.closest('[data-desktop-page-comments]')))) schedule();
  });
  observer.observe(holder, { subtree: true, childList: true, characterData: true });
  schedule();
  return { element, destroy() {
    if (state.destroyed) return; state.destroyed = true;
    clearCodeAction();
    cancelAnimationFrame(state.frame); observer.disconnect(); state.discussion?.destroy(); layer.remove(); element.remove();
    holder.removeEventListener(REQUEST, request); holder.removeEventListener('click', clickPassage);
    document.removeEventListener('keydown', keydown); document.removeEventListener('selectionchange', codeSelectionChanged); document.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule);
    stopProfile();
    editor.events.off('block changed', refresh); drafts.clear();
  } };
}

function button(label: string, icon: typeof MessageSquare): HTMLButtonElement {
  const element = document.createElement('button'); element.type = 'button'; element.title = label; element.setAttribute('aria-label', label);
  element.append(createElement(icon, { width: '18', height: '18', 'aria-hidden': 'true' }));
  return element;
}
