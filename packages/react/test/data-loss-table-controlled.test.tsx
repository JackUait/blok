/**
 * Data-loss probes: a table driven through the React adapter's controlled
 * `data` / `onSave` channel, booting the REAL core.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React, { StrictMode, useState } from 'react';
import { BlokEditor } from '../src';
import type { UseBlokConfig } from '../src';
import type { Blok, OutputData } from '@/types';
import { Paragraph } from '../../../src/tools/paragraph';
import { Table } from '../../../src/tools/table/index';

const TOOLS: UseBlokConfig['tools'] = {
  paragraph: { class: Paragraph },
  table: { class: Table },
};

const makeDoc = (texts: string[][], tableId = 'tbl'): OutputData => {
  const ids = texts.map((row, r) => row.map((_, c) => `${tableId}-c${r}-${c}`));

  return {
    blocks: [
      {
        id: tableId,
        type: 'table',
        data: {
          withHeadings: true,
          withHeadingColumn: false,
          content: ids.map((row) => row.map((id) => ({ blocks: [id] }))),
        },
      },
      ...texts.flatMap((row, r) =>
        row.map((text, c) => ({
          id: ids[r][c],
          type: 'paragraph',
          data: { text },
          parent: tableId,
        }))
      ),
    ],
  };
};

const readGrid = (root: HTMLElement): string[][] => {
  const rows: string[][] = [];

  root.querySelectorAll<HTMLElement>('[data-blok-table-cell]').forEach((cell) => {
    const r = Number(cell.getAttribute('data-blok-table-cell-row'));
    const c = Number(cell.getAttribute('data-blok-table-cell-col'));

    rows[r] = rows[r] ?? [];
    rows[r][c] = (cell.textContent ?? '').trim();
  });

  return rows;
};

/** Cell texts as the saved document describes them. */
const savedGrid = (doc: OutputData): string[][] => {
  const table = doc.blocks.find((b) => b.type === 'table');
  const byId = new Map(doc.blocks.map((b) => [b.id, b]));
  const content = (table?.data as { content: Array<Array<{ blocks: string[] }>> }).content;

  return content.map((row) =>
    row.map((cell) => cell.blocks.map((id) => String((byId.get(id)?.data as { text?: string })?.text ?? `<missing ${id}>`)).join('|'))
  );
};

const flush = async (ms: number): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};

describe('table through the React adapter — controlled data (real core)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await flush(0);
    vi.restoreAllMocks();
  });

  it('boot does not emit an onSave that drops cell content', async () => {
    const doc = makeDoc([['H1', 'H2'], ['a', 'b']]);
    const onSave = vi.fn();
    const { getByTestId } = render(<BlokEditor data-testid="ed" tools={TOOLS} data={doc} onSave={onSave} />);

    await waitFor(() => expect(getByTestId('ed').querySelectorAll('[data-blok-table-cell]')).toHaveLength(4), { timeout: 5000 });
    await flush(900);

    // Boot is not an edit: no serialization may reach the host at all.
    expect(onSave.mock.calls.map((call) => savedGrid(call[0] as OutputData))).toStrictEqual([]);
    expect(readGrid(getByTestId('ed'))).toStrictEqual([['H1', 'H2'], ['a', 'b']]);
  });

  it('StrictMode double mount keeps every cell', async () => {
    const doc = makeDoc([['H1', 'H2'], ['a', 'b']]);
    let instance: Blok | null = null;
    const { getByTestId } = render(
      <StrictMode>
        <BlokEditor data-testid="ed" tools={TOOLS} data={doc} onReady={(e) => { instance = e; }} />
      </StrictMode>
    );

    await waitFor(() => expect(instance).not.toBeNull(), { timeout: 5000 });
    await waitFor(() => expect(getByTestId('ed').querySelectorAll('[data-blok-table-cell]')).toHaveLength(4), { timeout: 5000 });
    await flush(300);

    expect(readGrid(getByTestId('ed'))).toStrictEqual([['H1', 'H2'], ['a', 'b']]);
    const saved = await (instance as unknown as Blok).save();

    expect(savedGrid(saved)).toStrictEqual([['H1', 'H2'], ['a', 'b']]);
  });

  it('data loaded after mount (undefined -> table doc) renders every cell', async () => {
    let setData: (d: OutputData | undefined) => void = () => undefined;
    let instance: Blok | null = null;
    const Host = (): React.ReactElement => {
      const [data, set] = useState<OutputData | undefined>(undefined);

      setData = set;

      return <BlokEditor data-testid="ed" tools={TOOLS} data={data} onReady={(e) => { instance = e; }} />;
    };
    const { getByTestId } = render(<Host />);

    await waitFor(() => expect(instance).not.toBeNull(), { timeout: 5000 });
    act(() => setData(makeDoc([['H1', 'H2'], ['a', 'b']])));
    await waitFor(() => expect(getByTestId('ed').querySelectorAll('[data-blok-table-cell]')).toHaveLength(4), { timeout: 5000 });
    await flush(300);

    expect(readGrid(getByTestId('ed'))).toStrictEqual([['H1', 'H2'], ['a', 'b']]);
    expect(savedGrid(await (instance as unknown as Blok).save())).toStrictEqual([['H1', 'H2'], ['a', 'b']]);
  });

  it('switching data to another table doc with the SAME ids shows the new content', async () => {
    let setData: (d: OutputData) => void = () => undefined;
    let instance: Blok | null = null;
    const Host = (): React.ReactElement => {
      const [data, set] = useState<OutputData>(makeDoc([['H1', 'H2'], ['a', 'b']]));

      setData = set;

      return <BlokEditor data-testid="ed" tools={TOOLS} data={data} onReady={(e) => { instance = e; }} />;
    };
    const { getByTestId } = render(<Host />);

    await waitFor(() => expect(instance).not.toBeNull(), { timeout: 5000 });
    await waitFor(() => expect(getByTestId('ed').querySelectorAll('[data-blok-table-cell]')).toHaveLength(4), { timeout: 5000 });
    act(() => setData(makeDoc([['X1', 'X2'], ['x', 'y'], ['p', 'q']])));
    await waitFor(() => expect(getByTestId('ed').querySelectorAll('[data-blok-table-cell]')).toHaveLength(6), { timeout: 5000 });
    await flush(300);

    expect(readGrid(getByTestId('ed'))).toStrictEqual([['X1', 'X2'], ['x', 'y'], ['p', 'q']]);
    expect(savedGrid(await (instance as unknown as Blok).save())).toStrictEqual([['X1', 'X2'], ['x', 'y'], ['p', 'q']]);
  });

  it('rapid data switches (A -> B -> C) settle on C with every cell', async () => {
    let setData: (d: OutputData) => void = () => undefined;
    let instance: Blok | null = null;
    const Host = (): React.ReactElement => {
      const [data, set] = useState<OutputData>(makeDoc([['A1', 'A2'], ['a', 'b']], 'ta'));

      setData = set;

      return <BlokEditor data-testid="ed" tools={TOOLS} data={data} onReady={(e) => { instance = e; }} />;
    };
    const { getByTestId } = render(<Host />);

    await waitFor(() => expect(instance).not.toBeNull(), { timeout: 5000 });
    act(() => setData(makeDoc([['B1', 'B2'], ['c', 'd']], 'tb')));
    act(() => setData(makeDoc([['C1', 'C2'], ['e', 'f']], 'tc')));
    await flush(1500);

    expect(readGrid(getByTestId('ed'))).toStrictEqual([['C1', 'C2'], ['e', 'f']]);
    expect(savedGrid(await (instance as unknown as Blok).save())).toStrictEqual([['C1', 'C2'], ['e', 'f']]);
  });

  it('legacy string cells: controlled onSave round-trip keeps content', async () => {
    const legacy: OutputData = {
      blocks: [{ id: 'leg', type: 'table', data: { withHeadings: false, content: [['one', 'two'], ['three', 'four']] } }],
    };
    let latest: OutputData | null = null;
    let instance: Blok | null = null;
    const Host = (): React.ReactElement => {
      const [data, set] = useState<OutputData>(legacy);

      return (
        <BlokEditor
          data-testid="ed"
          tools={TOOLS}
          data={data}
          onSave={(d) => { latest = d; set(d); }}
          onReady={(e) => { instance = e; }}
        />
      );
    };
    const { getByTestId } = render(<Host />);

    await waitFor(() => expect(instance).not.toBeNull(), { timeout: 5000 });
    await flush(1000);

    expect(readGrid(getByTestId('ed'))).toStrictEqual([['one', 'two'], ['three', 'four']]);
    const saved = await (instance as unknown as Blok).save();

    expect(savedGrid(saved)).toStrictEqual([['one', 'two'], ['three', 'four']]);
    // The legacy -> block-cell migration happens at render; it must not echo a save.
    expect(latest).toBeNull();
  });
});
