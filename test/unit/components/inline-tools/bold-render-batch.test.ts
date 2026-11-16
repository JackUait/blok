import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BoldInlineTool } from '../../../../src/components/inline-tools/inline-tool-bold';
import { BoldNormalizationPass } from '../../../../src/components/inline-tools/services/bold-normalization-pass';

beforeEach(() => { vi.clearAllMocks(); });

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it('normalizes an inserted database subtree once when the batch also contains its descendants', () => {
  const editor = document.createElement('div');

  editor.setAttribute('data-blok-editor', '');
  document.body.append(editor);
  const observer = new MutationObserver(() => undefined);

  observer.observe(editor, { childList: true, subtree: true });
  const table = document.createElement('div');

  editor.append(table);
  for (let index = 0; index < 100; index++) {
    const row = document.createElement('div');
    const cell = document.createElement('div');
    const text = document.createElement('b');

    table.append(row);
    row.append(cell);
    text.textContent = `Task ${index}`;
    cell.append(text);
  }
  const records = observer.takeRecords();

  observer.disconnect();
  const pass = vi.spyOn(BoldNormalizationPass.prototype, 'run');
  const internals = BoldInlineTool as unknown as { normalizeChanged(records: MutationRecord[]): void };

  internals.normalizeChanged(records);

  expect(table.querySelectorAll('b')).toHaveLength(0);
  expect(table.querySelectorAll('strong')).toHaveLength(100);
  expect(pass).toHaveBeenCalledTimes(1);
});


it('normalizes each disjoint subtree without touching an unchanged sibling', () => {
  const editor = document.createElement('div');

  editor.setAttribute('data-blok-editor', '');
  editor.innerHTML = '<p><b>Unchanged</b></p>';
  document.body.append(editor);
  const observer = new MutationObserver(() => undefined);

  observer.observe(editor, { childList: true, subtree: true });
  for (const name of ['First', 'Second']) {
    const subtree = document.createElement('section');

    editor.append(subtree);
    subtree.innerHTML = `<p><b>${name}</b></p>`;
  }
  const records = observer.takeRecords();

  observer.disconnect();
  const pass = vi.spyOn(BoldNormalizationPass.prototype, 'run');
  const internals = BoldInlineTool as unknown as { normalizeChanged(records: MutationRecord[]): void };

  internals.normalizeChanged(records);

  expect(editor.querySelectorAll('strong')).toHaveLength(2);
  expect(editor.querySelector('b')?.textContent).toBe('Unchanged');
  expect(pass).toHaveBeenCalledTimes(2);
});

it('preserves a caret inside an overlapping bold subtree and revisits it after the caret leaves', () => {
  const editor = document.createElement('div');

  editor.setAttribute('data-blok-editor', '');
  document.body.append(editor);
  const observer = new MutationObserver(() => undefined);

  observer.observe(editor, { childList: true, subtree: true });
  const subtree = document.createElement('section');

  editor.append(subtree);
  subtree.innerHTML = '<p><b>Typing</b></p><p><b>Other</b></p>';
  const caretText = subtree.querySelector('b')?.firstChild;
  const selection = window.getSelection();

  if (caretText === undefined || caretText === null || selection === null) throw new Error('Missing caret fixture');
  selection.collapse(caretText, 3);
  const records = observer.takeRecords();

  observer.disconnect();
  const pass = vi.spyOn(BoldNormalizationPass.prototype, 'run');
  const internals = BoldInlineTool as unknown as { normalizeChanged(records: MutationRecord[]): void };

  internals.normalizeChanged(records);

  expect(selection.anchorNode).toBe(caretText);
  expect(selection.anchorOffset).toBe(3);
  expect(subtree.querySelector('b')?.textContent).toBe('Typing');
  expect(subtree.querySelector('strong')?.textContent).toBe('Other');
  expect(pass).toHaveBeenCalledTimes(1);
  selection.collapse(editor, 1);
  internals.normalizeChanged([]);
  expect(subtree.querySelector('b')).toBeNull();
  expect(subtree.querySelectorAll('strong')).toHaveLength(2);
});
