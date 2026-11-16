import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoredThread } from '../../src/tools/database/database-comments-store';
import { mountInlineComments, CommentInlineTool } from './inline-comments';

const state = vi.hoisted(() => ({ threads: [] as StoredThread[], add: vi.fn(), reply: vi.fn(), resolve: vi.fn() }));
vi.mock('../../src/tools/database/database-comments-store', () => ({ BuiltInComments: class {
  available = () => true; threads = () => state.threads; add = state.add; reply = state.reply; resolve = state.resolve;
} }));
const handles: Array<{destroy(): void}> = [];
afterEach(() => { handles.splice(0).forEach(h => h.destroy()); document.body.replaceChildren(); state.threads = []; vi.clearAllMocks(); });
function mount(permission = { value: true }) {
  const holder = document.createElement('div');
  holder.innerHTML = '<div data-blok-id="p"><p contenteditable="true">Explain this passage</p></div>';
  document.body.append(holder);
  const events = { on: vi.fn(), off: vi.fn() };
  const editor = { blocks: {}, tools: {}, events, i18n: { t: (s: string) => s } };
  const controller = mountInlineComments({ holder, editor: editor as never, author: () => ({ authorId: 'me', authorName: 'Moi' }), canComment: () => permission.value });
  holder.append(controller.element); handles.push(controller);
  const range = document.createRange(); range.selectNodeContents(holder.querySelector('p')!);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  return { holder, controller, events, range };
}
function send(text: string) {
  const input = document.querySelector<HTMLTextAreaElement>('[data-inline-comment-panel] textarea')!;
  input.value = text; input.dispatchEvent(new Event('input'));
  document.querySelector<HTMLButtonElement>('[data-inline-comment-panel] [data-blok-database-comment-send]')!.click();
}
describe('selected-passage discussions', () => {
  it('opens from the inline toolbar and persists the selected quote when sent', () => {
    const { holder } = mount();
    const close = vi.fn();
    const tool = new CommentInlineTool({ api: { inlineToolbar: { close } } } as never);
    const menu = tool.render(); (menu as {onActivate(): void}).onActivate();
    expect(document.querySelector('[data-inline-comment-quote]')?.textContent).toBe('Explain this passage');
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
    send('What does it mean?');
    expect(state.add).toHaveBeenCalledWith(null, 'What does it mean?', undefined, expect.objectContaining({segments: [expect.objectContaining({blockId: 'p', quote: 'Explain this passage'})]}));
    expect(holder.querySelector('p')?.innerHTML).toBe('Explain this passage');
    expect(close).toHaveBeenCalled();
  });
  it('opens with Cmd+Shift+M and rechecks permission before writing', () => {
    const permission = {value: true}; mount(permission);
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'M', metaKey: true, shiftKey: true, bubbles: true, cancelable: true}));
    expect(document.querySelector('[data-inline-comment-panel] textarea')).not.toBeNull();
    permission.value = false; send('Not allowed'); expect(state.add).not.toHaveBeenCalled();
  });
  it('keeps a detached thread accessible, with its original quote, after target deletion', () => {
    state.threads = [{id: 't', data: {text: 'Please clarify', createdAt: 1, anchor: {segments: [{blockId: 'missing', field: 0, start: 0, quote: 'Original passage', prefix: '', suffix: ''}]}}, replies: []}];
    const { controller } = mount(); controller.element.click();
    expect(document.body.textContent).toContain('Passage introuvable');
    document.querySelector<HTMLButtonElement>('[data-inline-comment-list-item]')!.click();
    expect(document.querySelector('[data-inline-comment-quote]')?.textContent).toContain('Original passage');
    expect(document.body.textContent).toContain('Please clarify');
  });
  it('shows resolved threads and lets an editor reopen them', () => {
    state.threads = [{id: 't', data: {text: 'Done', createdAt: 1, resolved: true}, replies: []}];
    const { controller } = mount(); controller.element.click();
    document.querySelector<HTMLButtonElement>('[data-inline-comment-filter="resolved"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-inline-comment-list-item]')!.click();
    document.querySelector<HTMLButtonElement>('[data-inline-comment-reopen]')!.click();
    expect(state.resolve).toHaveBeenCalledWith('t', false);
  });
  it('does not open a new composer for a viewer and cleans up its listeners and layer', () => {
    const { controller, events } = mount({value: false});
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'M', ctrlKey: true, shiftKey: true, bubbles: true}));
    expect(document.querySelector('[data-inline-comment-panel]')).toBeNull();
    controller.destroy();
    expect(document.querySelector('[data-inline-comments-layer]')).toBeNull();
    expect(events.off).toHaveBeenCalledWith('block changed', expect.any(Function));
  });
});
