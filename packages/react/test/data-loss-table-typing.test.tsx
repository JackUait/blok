/**
 * Data-loss probes: typing into a table cell through the React adapter,
 * real core, then host-side transitions (controlled echo, unmount).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { BlokEditor } from '../src';
import type { UseBlokConfig } from '../src';
import type { Blok, OutputData } from '@/types';
import { Paragraph } from '../../../src/tools/paragraph';
import { Table } from '../../../src/tools/table/index';

const TOOLS: UseBlokConfig['tools'] = {
  paragraph: { class: Paragraph },
  table: { class: Table },
};

const DOC: OutputData = {
  blocks: [
    {
      id: 'tbl',
      type: 'table',
      data: { withHeadings: false, content: [[{ blocks: ['c00'] }, { blocks: ['c01'] }], [{ blocks: ['c10'] }, { blocks: ['c11'] }]] },
    },
    { id: 'c00', type: 'paragraph', data: { text: 'a' }, parent: 'tbl' },
    { id: 'c01', type: 'paragraph', data: { text: 'b' }, parent: 'tbl' },
    { id: 'c10', type: 'paragraph', data: { text: 'c' }, parent: 'tbl' },
    { id: 'c11', type: 'paragraph', data: { text: 'd' }, parent: 'tbl' },
  ],
};

const cellText = (doc: OutputData, id: string): unknown =>
  (doc.blocks.find((b) => b.id === id)?.data as { text?: string } | undefined)?.text;

const typeInto = (root: HTMLElement, blockId: string, text: string): void => {
  const editable = root.querySelector<HTMLElement>(`[data-blok-id="${blockId}"] [data-blok-tool="paragraph"]`);

  if (editable === null) {
    throw new Error(`no editable for ${blockId}`);
  }
  editable.textContent = text;
  editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text.slice(-1) }));
};

const flush = async (ms: number): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};

describe('typing in a table cell through the React adapter (real core)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await flush(0);
    vi.restoreAllMocks();
  });

  it('a cell edit reaches onSave after the batch window', async () => {
    const onSave = vi.fn();
    let instance: Blok | null = null;
    const { getByTestId } = render(
      <BlokEditor data-testid="ed" tools={TOOLS} data={DOC} onSave={onSave} onReady={(e) => { instance = e; }} />
    );

    await waitFor(() => expect(instance).not.toBeNull(), { timeout: 5000 });
    await flush(500);
    onSave.mockClear();
    act(() => typeInto(getByTestId('ed'), 'c11', 'd-edited'));
    await flush(900);

    expect(onSave).toHaveBeenCalled();
    expect(cellText(onSave.mock.calls.at(-1)?.[0] as OutputData, 'c11')).toBe('d-edited');
  });

  it('a cell edit made right before unmount still reaches onSave', async () => {
    const onSave = vi.fn();
    let instance: Blok | null = null;
    const { getByTestId, unmount } = render(
      <BlokEditor data-testid="ed" tools={TOOLS} data={DOC} onSave={onSave} onReady={(e) => { instance = e; }} />
    );

    await waitFor(() => expect(instance).not.toBeNull(), { timeout: 5000 });
    await flush(500);
    onSave.mockClear();
    act(() => typeInto(getByTestId('ed'), 'c11', 'd-last-words'));
    // let the MutationObserver record the change, but stay inside the 400ms window
    await flush(50);
    unmount();
    await flush(1000);

    const texts = onSave.mock.calls.map((c) => cellText(c[0] as OutputData, 'c11'));

    expect(texts).toContain('d-last-words');
  });

  it('a plain top-level paragraph edit right before unmount still reaches onSave', async () => {
    const onSave = vi.fn();
    let instance: Blok | null = null;
    const plain: OutputData = { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'x' } }] };
    const { getByTestId, unmount } = render(
      <BlokEditor data-testid="ed" tools={TOOLS} data={plain} onSave={onSave} onReady={(e) => { instance = e; }} />
    );

    await waitFor(() => expect(instance).not.toBeNull(), { timeout: 5000 });
    await flush(500);
    act(() => typeInto(getByTestId('ed'), 'p1', 'x-last'));
    await flush(50);
    unmount();
    await flush(1000);

    expect(onSave.mock.calls.map((c) => cellText(c[0] as OutputData, 'p1'))).toContain('x-last');
  });

  it('control: same edit with the batch window closed before unmount reaches onSave', async () => {
    const onSave = vi.fn();
    let instance: Blok | null = null;
    const { getByTestId, unmount } = render(
      <BlokEditor data-testid="ed" tools={TOOLS} data={DOC} onSave={onSave} onReady={(e) => { instance = e; }} />
    );

    await waitFor(() => expect(instance).not.toBeNull(), { timeout: 5000 });
    await flush(500);
    onSave.mockClear();
    act(() => typeInto(getByTestId('ed'), 'c11', 'd-last-words'));
    await flush(450);
    unmount();
    await flush(1000);

    expect(onSave.mock.calls.map((c) => cellText(c[0] as OutputData, 'c11'))).toContain('d-last-words');
  });

  it('controlled round-trip: edit, echo, edit again keeps both edits', async () => {
    let instance: Blok | null = null;
    const saves: OutputData[] = [];
    const Host = (): React.ReactElement => {
      const [data, set] = useState<OutputData>(DOC);

      return (
        <BlokEditor
          data-testid="ed"
          tools={TOOLS}
          data={data}
          onSave={(d) => { saves.push(d); set(d); }}
          onReady={(e) => { instance = e; }}
        />
      );
    };
    const { getByTestId } = render(<Host />);

    await waitFor(() => expect(instance).not.toBeNull(), { timeout: 5000 });
    await flush(500);
    act(() => typeInto(getByTestId('ed'), 'c00', 'first'));
    await flush(900);
    act(() => typeInto(getByTestId('ed'), 'c11', 'second'));
    await flush(900);

    const saved = await (instance as unknown as Blok).save();

    expect([cellText(saved, 'c00'), cellText(saved, 'c11')]).toStrictEqual(['first', 'second']);
    expect([cellText(saves.at(-1) as OutputData, 'c00'), cellText(saves.at(-1) as OutputData, 'c11')]).toStrictEqual(['first', 'second']);
  });
});
