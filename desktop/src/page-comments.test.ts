import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Blok } from '../../types';
import type { StoredThread } from '../../src/tools/database/database-comments-store';
import { mountPageComments, placePageComments } from './page-comments';

const state = vi.hoisted(() => ({ threads: [] as StoredThread[], add: vi.fn(), reply: vi.fn(), edit: vi.fn(), resolve: vi.fn(), remove: vi.fn() }));
vi.mock('../../src/tools/database/database-comments-store', () => ({ BuiltInComments: class {
  available = () => true;
  threads = () => state.threads;
  add = state.add; reply = state.reply; edit = state.edit; resolve = state.resolve; remove = state.remove;
} }));
const handles: Array<{ destroy(): void }> = [];
function mount(writable = { value: true }) {
  const events = { on: vi.fn(), off: vi.fn() };
  const editor = { blocks: {}, tools: {}, events, i18n: { t: (key: string) => key } } as unknown as Pick<Blok, 'blocks' | 'tools' | 'events' | 'i18n'>;
  const panel = mountPageComments({ editor, author: () => ({ authorId: 'me', authorName: 'Moi' }), canComment: () => writable.value });
  document.body.append(panel.action, panel.element); handles.push(panel);
  return { ...panel, events };
}
function send(text: string): void {
  document.querySelector<HTMLButtonElement>('[data-page-comments-toggle][aria-expanded=false]')?.click();
  const input = document.querySelector('textarea');
  if (!input) throw new Error('Missing composer');
  input.value = text; input.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector<HTMLButtonElement>('[data-blok-database-comment-send]')?.click();
}
beforeEach(() => { vi.clearAllMocks(); state.threads = []; });
afterEach(() => { handles.splice(0).forEach(handle => handle.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });
describe('page comment controls', () => {
  it('keeps an empty discussion collapsed until requested and focuses its composer', () => {
    const panel = mount();
    const toggle = panel.action;
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(panel.element.querySelector<HTMLElement>('[data-page-comments-content]')?.hidden).toBe(true);
    toggle.click();
    expect(document.activeElement).toBe(panel.element.querySelector('textarea'));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
  it('marks only the empty collapsed entry as a contextual header action', () => {
    const panel = mount();
    const toggle = panel.action;
    expect(toggle.hasAttribute('data-page-comments-empty')).toBe(true);
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    state.threads = [{ id: 'thread', data: { text: 'Already discussed', createdAt: 1 }, replies: [] }];
    const populated = mount();
    expect(populated.action.hasAttribute('data-page-comments-empty')).toBe(false);
  });
  it('places discussion after title properties and before the document body', () => {
    const holder = document.createElement('div');
    holder.innerHTML = '<header data-blok-page-header><div data-blok-page-icon-row><button>Add icon</button><button>Add cover</button></div><h1 data-blok-page-title>Title</h1><div data-desktop-page-created>Date</div></header><div data-blok-redactor>Body</div>';
    const panel = mount(); placePageComments(holder, panel.element, panel.action);
    expect(holder.querySelector('[data-blok-page-header]')?.lastElementChild).toBe(panel.element);
    expect(holder.querySelector('[data-blok-page-icon-row]')?.lastElementChild).toBe(panel.action);
    expect(panel.element.contains(panel.action)).toBe(false);
    panel.action.click();
    expect(panel.action.hidden).toBe(true);
    expect(panel.element.hidden).toBe(false);
    expect(holder.querySelector('[data-blok-redactor]')?.contains(panel.element)).toBe(false);
  });
  it('restores the header action after an icon-row redraw and removes it on destruction', async () => {
    const holder = document.createElement('div');
    holder.innerHTML = '<header data-blok-page-header><div data-blok-page-icon-row></div><h1>Title</h1></header>';
    document.body.append(holder);
    const editor = { blocks: {}, tools: {}, events: { on: vi.fn(), off: vi.fn() }, i18n: { t: (key: string) => key } } as never;
    const panel = mountPageComments({ holder, editor, author: () => ({ authorId: 'me' }), canComment: () => true });
    handles.push(panel);
    const row = holder.querySelector('[data-blok-page-icon-row]')!;
    row.replaceChildren(document.createElement('button'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(row.lastElementChild).toBe(panel.action);
    panel.destroy();
    expect(holder.querySelector('[data-page-comments-toggle]')).toBeNull();
  });
  it('adds a page thread and checks current permission again when sending', () => {
    const permission = { value: true }; mount(permission);
    send('Hello'); expect(state.add).toHaveBeenCalledWith(null, 'Hello');
    permission.value = false; send('No longer allowed'); expect(state.add).toHaveBeenCalledTimes(1);
  });
  it('shows threads without a composer or editing controls to a viewer', () => {
    state.threads = [{ id: 'thread', data: { text: 'Visible', authorId: 'me', createdAt: 1 }, replies: [] }];
    mount({ value: false });
    expect(document.body.textContent).toContain('Visible');
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.querySelector('[data-blok-database-comment-actions]')).toBeNull();
  });
  it('does not offer edit/delete for another author with the same display name', () => {
    state.threads = [{ id: 'thread', data: { text: 'Their words', authorId: 'other', authorName: 'Moi', createdAt: 1 }, replies: [] }];
    mount();
    expect(document.querySelector('[data-blok-database-comment-actions]')).toBeNull();
  });
  it('shows resolved threads and reopens one using the existing store', () => {
    state.threads = [{ id: 'thread', data: { text: 'Resolved words', resolved: true, authorId: 'me', createdAt: 1 }, replies: [] }];
    mount();
    [...document.querySelectorAll('button')].find(button => button.textContent === 'Résolus')?.click();
    expect(document.body.textContent).toContain('Resolved words');
    [...document.querySelectorAll('button')].find(button => button.textContent === 'Rouvrir')?.click();
    expect(state.resolve).toHaveBeenCalledWith('thread', false);
  });
  it('preserves an unsent draft when switching thread filters', () => {
    mount();
    const input = document.querySelector('textarea');
    if (!input) throw new Error('Missing composer');
    input.value = 'Unsent correction';
    [...document.querySelectorAll('button')].find(button => button.textContent === 'Résolus')?.click();
    [...document.querySelectorAll('button')].find(button => button.textContent === 'Ouverts')?.click();
    expect(document.querySelector('textarea')?.value).toBe('Unsent correction');
  });
  it('unsubscribes on destruction', () => {
    const panel = mount(); panel.destroy();
    expect(panel.events.off).toHaveBeenCalledWith('block changed', expect.any(Function));
  });
});
