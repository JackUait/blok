import type { CommentAnchor } from '../../types/tools/database-comment';

function fields(holder: HTMLElement): HTMLElement[] {
  return [...holder.querySelectorAll<HTMLElement>('[contenteditable]')]
    .filter(field => !!field.closest('[data-blok-id]') && !field.parentElement?.closest('[contenteditable]'));
}

/** Text-node offsets make formatting changes irrelevant to the saved quote. */
function rangeAt(field: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0; let started = false;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const length = node.textContent?.length ?? 0;
    if (!started && start <= offset + length) { range.setStart(node, start - offset); started = true; }
    if (started && end <= offset + length) { range.setEnd(node, end - offset); return range; }
    offset += length;
  }
  return null;
}

export function captureCommentAnchor(holder: HTMLElement, selection: Range): CommentAnchor | null {
  if (selection.collapsed || !holder.contains(selection.commonAncestorContainer)) return null;
  const segments: CommentAnchor['segments'] = [];
  const editable = fields(holder);
  for (const field of editable) {
    if (!selection.intersectsNode(field)) continue;
    const range = document.createRange(); range.selectNodeContents(field);
    if (field.contains(selection.startContainer)) range.setStart(selection.startContainer, selection.startOffset);
    if (field.contains(selection.endContainer)) range.setEnd(selection.endContainer, selection.endOffset);
    const quote = range.toString(); if (!quote) continue;
    const before = document.createRange(); before.selectNodeContents(field); before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const block = field.closest<HTMLElement>('[data-blok-id]')!;
    const siblings = editable.filter(item => item.closest('[data-blok-id]') === block);
    const text = field.textContent ?? '';
    segments.push({ blockId: block.getAttribute('data-blok-id')!, field: siblings.indexOf(field), start, quote,
      prefix: text.slice(Math.max(0, start - 32), start), suffix: text.slice(start + quote.length, start + quote.length + 32) });
  }
  return segments.length ? { segments } : null;
}

/** Never guess among duplicate quotes. A missing/ambiguous target stays detached. */
export function resolveCommentAnchor(holder: HTMLElement, anchor: CommentAnchor): Range[] | null {
  const editable = fields(holder); const result: Range[] = [];
  for (const segment of anchor.segments) {
    const field = editable.filter(item => item.closest('[data-blok-id]')?.getAttribute('data-blok-id') === segment.blockId)[segment.field];
    if (!field) return null;
    const text = field.textContent ?? '';
    const candidates: number[] = [];
    let offset = text.indexOf(segment.quote);
    while (offset >= 0) { candidates.push(offset); offset = text.indexOf(segment.quote, offset + 1); }
    const contextual = candidates.filter(at => text.slice(0, at).endsWith(segment.prefix) && text.slice(at + segment.quote.length).startsWith(segment.suffix));
    const nearby = candidates.filter(at => (segment.prefix.length > 0 && text.slice(0, at).endsWith(segment.prefix))
      || (segment.suffix.length > 0 && text.slice(at + segment.quote.length).startsWith(segment.suffix)));
    const matches = contextual.length ? contextual : nearby;
    if (matches.length !== 1) return null;
    const range = rangeAt(field, matches[0], matches[0] + segment.quote.length);
    if (!range) return null;
    result.push(range);
  }
  return result.length ? result : null;
}
