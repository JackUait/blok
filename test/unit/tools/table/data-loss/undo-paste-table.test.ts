/**
 * Undoing the paste of an HTML table must take the table AND its cell blocks
 * out of the document. When the paste's Yjs writes are spread over more than
 * the undo capture window (500 ms — a slow device or a big table), the paste
 * becomes several undo steps, the first undo removes only the table block,
 * and its cells stay in the Yjs doc as orphans that save() emits as loose
 * top-level paragraphs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OutputData } from '../../../../../types';
import { CAPTURE, boot, editableOf, pasteHtml, setup, sleep, teardown, yjsDoc, type TestEditor } from './undo-harness';

const DOC: OutputData = {
  blocks: [
    { id: 'keep', type: 'paragraph', data: { text: 'keep' } },
    { id: 'p', type: 'paragraph', data: { text: '' } },
    { id: 'after', type: 'paragraph', data: { text: 'after' } },
  ],
};

const TABLE_HTML = '<table><tr><td>X1</td><td>X2</td></tr><tr><td>X3</td><td>X4</td></tr></table>';

/** "id:type:parent:text", sorted; generated ids masked. */
const facts = (out: OutputData): string[] => out.blocks.map(b =>
  `${['keep', 'p', 'after'].includes(b.id ?? '') ? b.id : 'NEW'}:${b.type}:${b.parent === undefined || b.parent === null ? '' : 'PARENT'}:${String((b.data as { text?: string }).text ?? '')}`
).sort();

/**
 * Simulate a slow device: every block the paste writes to the Yjs doc lands
 * 600 ms after the one before (Yjs' capture window reads Date.now()).
 */
const slowDownDocWrites = (editor: TestEditor): void => {
  const yjs = (editor as unknown as { module: { yjsManager: { addBlockAt: (...args: unknown[]) => unknown } } }).module.yjsManager;
  const original = yjs.addBlockAt.bind(yjs);
  const realNow = Date.now.bind(Date);
  let offset = 0;

  vi.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
  yjs.addBlockAt = (...args: unknown[]): unknown => {
    offset += 600;

    return original(...args);
  };
};

describe('undo of a pasted table', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('one undo after a slow table paste leaves no pasted cell in the Yjs doc or in save()', async () => {
    const editor = await boot(DOC);
    const before = facts({ blocks: (await yjsDoc(editor)).blocks });

    slowDownDocWrites(editor);
    pasteHtml(editableOf('p'), TABLE_HTML);
    await sleep(CAPTURE);
    expect((await editor.save()).blocks.filter(b => b.type === 'table')).toHaveLength(1);

    editor.history.undo();
    await sleep(1000);

    expect(facts(await yjsDoc(editor))).toEqual(before);
    expect(facts(await editor.save())).toEqual(facts(await editor.save()).filter(f => !f.startsWith('NEW')));
  }, 90_000);
});
