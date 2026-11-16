import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredThread } from '../../src/tools/database/database-comments-store';
import { mountInlineComments, CommentInlineTool } from './inline-comments';

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing test fixture value');
  return value;
}

const state = vi.hoisted(() => ({ threads: [] as StoredThread[], add: vi.fn(), reply: vi.fn(), resolve: vi.fn() }));
vi.mock('../../src/tools/database/database-comments-store', () => ({ BuiltInComments: class {
  available = () => true; threads = () => state.threads; add = state.add; reply = state.reply; resolve = state.resolve;
} }));
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });
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
  const range = document.createRange(); range.selectNodeContents(required(holder.querySelector('p')));
  const selection = required(window.getSelection()); selection.removeAllRanges(); selection.addRange(range);
  return { holder, controller, events, range };
}
function send(text: string) {
  const input = required(document.querySelector<HTMLTextAreaElement>('[data-inline-comment-panel] textarea'));
  input.value = text; input.dispatchEvent(new Event('input'));
  required(document.querySelector<HTMLButtonElement>('[data-inline-comment-panel] [data-blok-database-comment-send]')).click();
}
describe('selected-passage discussions', () => {
  it('offers only Commenter for a backward multiline code selection and preserves Prism markup', () => {
    const { holder } = mount();
    const block = holder.querySelector('[data-blok-id="p"]');
    if (!block) throw new Error('Missing code block');
    block.innerHTML = '<pre><code contenteditable="plaintext-only"><span class="token keyword">const</span> a = 1;\nconst b = 2;</code></pre>';
    const code = block.querySelector('code');
    if (!code) throw new Error('Missing code field');
    const html = code.innerHTML;
    const selection = window.getSelection();
    if (!selection) throw new Error('Missing selection');
    selection.setBaseAndExtent(code, code.childNodes.length, code, 0);
    document.dispatchEvent(new Event('selectionchange'));
    const action = holder.querySelector<HTMLButtonElement>('[data-inline-comment-code-action]');
    expect(action?.textContent).toContain('Commenter');
    if (!action) throw new Error('Missing Commenter action');
    action.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    action.click();
    expect(document.querySelector('[data-inline-comment-quote]')?.textContent).toBe('const a = 1;\nconst b = 2;');
    expect(code.innerHTML).toBe(html);
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
    send('Explain this code');
    expect(state.add).toHaveBeenCalledWith(null, 'Explain this code', undefined, expect.objectContaining({ segments: [expect.objectContaining({ blockId: 'p', quote: 'const a = 1;\nconst b = 2;' })] }));
    expect(code.innerHTML).toBe(html);
  });
  it('hides the code selection action when the selection collapses or permission is absent', () => {
    const permission = { value: true };
    const { holder } = mount(permission);
    const block = holder.querySelector('[data-blok-id="p"]');
    if (!block) throw new Error('Missing code block');
    block.innerHTML = '<pre><code contenteditable="plaintext-only">const x = 1;</code></pre>';
    const code = holder.querySelector('code');
    if (!code) throw new Error('Missing code field');
    const range = document.createRange(); range.selectNodeContents(code);
    const selection = window.getSelection();
    if (!selection) throw new Error('Missing selection');
    selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    expect(holder.querySelector('[data-inline-comment-code-action]')).not.toBeNull();
    permission.value = false;
    document.dispatchEvent(new Event('selectionchange'));
    expect(holder.querySelector('[data-inline-comment-code-action]')).toBeNull();
    permission.value = true; selection.collapse(code, 0);
    document.dispatchEvent(new Event('selectionchange'));
    expect(holder.querySelector('[data-inline-comment-code-action]')).toBeNull();
  });

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
    required(document.querySelector<HTMLButtonElement>('[data-inline-comment-list-item]')).click();
    expect(document.querySelector('[data-inline-comment-quote]')?.textContent).toContain('Original passage');
    expect(document.body.textContent).toContain('Please clarify');
  });
  it('shows resolved threads and lets an editor reopen them', () => {
    state.threads = [{id: 't', data: {text: 'Done', createdAt: 1, resolved: true}, replies: []}];
    const { controller } = mount(); controller.element.click();
    required(document.querySelector<HTMLButtonElement>('[data-inline-comment-filter="resolved"]')).click();
    required(document.querySelector<HTMLButtonElement>('[data-inline-comment-list-item]')).click();
    required(document.querySelector<HTMLButtonElement>('[data-inline-comment-reopen]')).click();
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
