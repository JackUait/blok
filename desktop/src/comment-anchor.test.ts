import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureCommentAnchor, resolveCommentAnchor } from './comment-anchor';

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing test fixture value');
  return value;
}

function fixture(html = 'Hello <b>world</b> today') {
  const holder = document.createElement('div');
  holder.innerHTML = `<div data-blok-id="p"><div contenteditable="true">${html}</div></div>`;
  document.body.append(holder);
  const field = required(holder.querySelector<HTMLElement>('[contenteditable]'));
  const range = document.createRange();
  range.selectNodeContents(required(field.querySelector('b')));
  return { holder, field, range };
}
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });
afterEach(() => document.body.replaceChildren());
describe('comment passage anchors', () => {
  it('resolves multiline code after Prism rebuilds the DOM and in a read-only renderer', () => {
    const holder = document.createElement('div'); document.body.append(holder);
    holder.innerHTML = '<div data-blok-id="code"><pre><code contenteditable="plaintext-only"><span>const x = 1;</span>\nconst y = 2;</code></pre></div>';
    const code = holder.querySelector('code');
    if (!code) throw new Error('Missing code field');
    const range = document.createRange(); range.selectNodeContents(code);
    const anchor = captureCommentAnchor(holder, range);
    if (!anchor) throw new Error('Missing code anchor');
    code.innerHTML = 'const <span>x = 1;\nconst y</span> = 2;';
    expect(resolveCommentAnchor(holder, anchor)?.[0].toString()).toBe('const x = 1;\nconst y = 2;');
    code.removeAttribute('contenteditable');
    expect(resolveCommentAnchor(holder, anchor)?.[0].toString()).toBe('const x = 1;\nconst y = 2;');
  });
  it('captures the selected text without including adjacent words or markup', () => {
    const { holder, range } = fixture();
    const anchor = required(captureCommentAnchor(holder, range));
    expect(anchor.segments[0]).toMatchObject({ blockId: 'p', quote: 'world', start: 6, prefix: 'Hello ', suffix: ' today' });
    expect(resolveCommentAnchor(holder, anchor)?.[0].toString()).toBe('world');
  });
  it('finds the same passage after text is inserted before it and the DOM is rebuilt', () => {
    const { holder, field, range } = fixture();
    const anchor = required(captureCommentAnchor(holder, range));
    field.innerHTML = 'A new introduction. Hello <em>world</em> today';
    expect(resolveCommentAnchor(holder, anchor)?.[0].toString()).toBe('world');
  });
  it('detaches a deleted or ambiguous passage instead of choosing another occurrence', () => {
    const { holder, field, range } = fixture();
    const anchor = required(captureCommentAnchor(holder, range));
    field.textContent = 'Hello today';
    expect(resolveCommentAnchor(holder, anchor)).toBeNull();
    field.textContent = 'Hello world today / Hello world today';
    expect(resolveCommentAnchor(holder, anchor)).toBeNull();
  });
  it('keeps separate segments for a selection across blocks', () => {
    const { holder, field } = fixture();
    holder.insertAdjacentHTML('beforeend', '<div data-blok-id="q"><div contenteditable="true">Second paragraph</div></div>');
    const end = required(holder.querySelector('[data-blok-id="q"] [contenteditable]'));
    const range = document.createRange();
    range.setStart(required(field.firstChild), 3); range.setEnd(required(end.firstChild), 6);
    const anchor = required(captureCommentAnchor(holder, range));
    expect(anchor.segments.map(s => s.blockId)).toEqual(['p', 'q']);
    expect(resolveCommentAnchor(holder, anchor)?.map(r => r.toString())).toEqual(['lo world today', 'Second']);
    required(end.parentElement).remove();
    expect(resolveCommentAnchor(holder, anchor)).toBeNull();
  });
  it('ignores selections outside the editor and empty selections', () => {
    const { holder, range } = fixture();
    range.collapse(); expect(captureCommentAnchor(holder, range)).toBeNull();
    const outside = document.createElement('p'); outside.textContent = 'outside'; document.body.append(outside);
    range.selectNodeContents(outside); expect(captureCommentAnchor(holder, range)).toBeNull();
  });
});
