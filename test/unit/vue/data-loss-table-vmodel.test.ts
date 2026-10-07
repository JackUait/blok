/**
 * Data-loss probes: a table driven through the Vue adapter's `v-model:data`,
 * booting the REAL core (no mock-blok).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, ref, type Ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';
import { BlokEditor } from '../../../packages/vue/src';
import type { Blok, OutputData } from '@/types';
import { Paragraph } from '../../../src/tools/paragraph';
import { Table } from '../../../src/tools/table/index';
import { htmlOf } from '../helpers/saved-as-html';

const TOOLS = { paragraph: { class: Paragraph }, table: { class: Table } };

const makeDoc = (texts: string[][], tableId = 'tbl'): OutputData => {
  const ids = texts.map((row, r) => row.map((_, c) => `${tableId}-c${r}-${c}`));

  return {
    blocks: [
      { id: tableId, type: 'table', data: { withHeadings: true, content: ids.map((row) => row.map((id) => ({ blocks: [id] }))) } },
      ...texts.flatMap((row, r) => row.map((text, c) => ({ id: ids[r][c], type: 'paragraph', data: { text }, parent: tableId }))),
    ],
  };
};

const readGrid = (root: Element): string[][] => {
  const rows: string[][] = [];

  root.querySelectorAll<HTMLElement>('[data-blok-table-cell]').forEach((cell) => {
    const r = Number(cell.getAttribute('data-blok-table-cell-row'));
    const c = Number(cell.getAttribute('data-blok-table-cell-col'));

    rows[r] = rows[r] ?? [];
    rows[r][c] = (cell.textContent ?? '').trim();
  });

  return rows;
};

const cellText = (doc: OutputData | undefined, id: string): unknown =>
  htmlOf((doc?.blocks.find((b) => b.id === id)?.data as { text?: unknown } | undefined)?.text);

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const until = async (check: () => boolean, ms = 5000): Promise<void> => {
  const start = Date.now();

  while (!check()) {
    if (Date.now() - start > ms) {
      throw new Error('timed out');
    }
    await wait(20);
  }
};

const mountHost = (initial: OutputData): {
  data: Ref<OutputData>;
  saves: OutputData[];
  editor: { current: Blok | null };
  root: () => Element;
  unmount: () => void;
} => {
  const data = ref<OutputData>(initial) as Ref<OutputData>;
  const saves: OutputData[] = [];
  const editor: { current: Blok | null } = { current: null };
  const Host = defineComponent({
    setup() {
      return () =>
        h(BlokEditor, {
          tools: TOOLS,
          data: data.value,
          'onUpdate:data': (d: OutputData) => {
            saves.push(d);
            data.value = d;
          },
          onReady: (e: unknown) => {
            editor.current = e as Blok;
          },
        });
    },
  });
  const wrapper = mount(Host, { attachTo: document.body });

  return { data, saves, editor, root: () => wrapper.element as Element, unmount: () => wrapper.unmount() };
};

const typeInto = (root: Element, blockId: string, text: string): void => {
  const editable = root.querySelector<HTMLElement>(`[data-blok-id="${blockId}"] [data-blok-tool="paragraph"]`);

  if (editable === null) {
    throw new Error(`no editable for ${blockId}`);
  }
  editable.textContent = text;
  editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text.slice(-1) }));
};

describe('table through the Vue adapter v-model:data (real core)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('boots with every cell in place and no lossy boot emit', async () => {
    const host = mountHost(makeDoc([['H1', 'H2'], ['a', 'b']]));

    await until(() => host.editor.current !== null && host.root().querySelectorAll('[data-blok-table-cell]').length === 4);
    await wait(900);
    await flushPromises();

    expect(readGrid(host.root())).toStrictEqual([['H1', 'H2'], ['a', 'b']]);
    for (const save of host.saves) {
      expect(cellText(save, 'tbl-c1-1')).toBe('b');
    }
    host.unmount();
  });

  it('v-model round-trip keeps two successive cell edits', async () => {
    const host = mountHost(makeDoc([['H1', 'H2'], ['a', 'b']]));

    await until(() => host.editor.current !== null && host.root().querySelectorAll('[data-blok-table-cell]').length === 4);
    await wait(300);
    typeInto(host.root(), 'tbl-c0-0', 'first');
    await wait(900);
    await flushPromises();
    typeInto(host.root(), 'tbl-c1-1', 'second');
    await wait(900);
    await flushPromises();

    const saved = await (host.editor.current as Blok).save();

    expect([cellText(saved, 'tbl-c0-0'), cellText(saved, 'tbl-c1-1')]).toStrictEqual(['first', 'second']);
    expect([cellText(host.data.value, 'tbl-c0-0'), cellText(host.data.value, 'tbl-c1-1')]).toStrictEqual(['first', 'second']);
    host.unmount();
  });

  it('switching v-model to another table renders every cell', async () => {
    const host = mountHost(makeDoc([['H1', 'H2'], ['a', 'b']]));

    await until(() => host.editor.current !== null && host.root().querySelectorAll('[data-blok-table-cell]').length === 4);
    host.data.value = makeDoc([['X1', 'X2'], ['x', 'y'], ['p', 'q']], 't2');
    await until(() => host.root().querySelectorAll('[data-blok-table-cell]').length === 6);
    await wait(300);

    expect(readGrid(host.root())).toStrictEqual([['X1', 'X2'], ['x', 'y'], ['p', 'q']]);
    host.unmount();
  });

  it('a cell edit made right before unmount still reaches v-model', async () => {
    const host = mountHost(makeDoc([['H1', 'H2'], ['a', 'b']]));

    await until(() => host.editor.current !== null && host.root().querySelectorAll('[data-blok-table-cell]').length === 4);
    await wait(500);
    typeInto(host.root(), 'tbl-c1-1', 'last-words');
    await wait(50);
    host.unmount();
    await wait(1000);
    await flushPromises();

    expect(cellText(host.data.value, 'tbl-c1-1')).toBe('last-words');
  });
});
