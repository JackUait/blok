// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILT_IN_TOOL_RUNTIMES } from '../../../../src/shared/tool-actions';
import { normalizeTable } from '../../../../src/shared/tool-actions/table';

import type { CellContent, LegacyCellContent } from '../../../../src/shared/table/types';

const counter = (): (() => string) => {
  let n = 0;

  return () => `m${++n}`;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('normalizeTable', () => {
  it('fills column ids before row ids and shares them across their slots', () => {
    const mint = vi.fn(counter());
    const out = normalizeTable({
      withHeadings: false,
      content: [
        [{ blocks: ['a'] }, { blocks: ['b'] }],
        [{ blocks: ['c'] }, { blocks: ['d'] }],
      ],
    }, mint);

    expect(out.content).toEqual([
      [{ blocks: ['a'], id: 'm1', rowId: 'm3' }, { blocks: ['b'], id: 'm2', rowId: 'm3' }],
      [{ blocks: ['c'], id: 'm1', rowId: 'm4' }, { blocks: ['d'], id: 'm2', rowId: 'm4' }],
    ]);
    expect(out.withHeadings).toBe(false);
    expect(mint).toHaveBeenCalledTimes(4);
  });

  it('uses the shared minter for default ten-character ids', () => {
    let request = 0;
    const getRandomValues = vi.fn((bytes: Uint8Array): Uint8Array => bytes.fill(request++));

    vi.stubGlobal('crypto', { getRandomValues });

    expect(normalizeTable({ content: [[{ blocks: [] }]] }).content).toEqual([
      [{ blocks: [], id: 'uuuuuuuuuu', rowId: 'ssssssssss' }],
    ]);
    expect(getRandomValues.mock.calls.map(([bytes]) => bytes?.length)).toEqual([10, 10]);
  });

  it('aligns missing and moved columns before minting row ids', () => {
    const mint = vi.fn(counter());
    const data = {
      content: [
        [{ blocks: ['left'], id: 'c0' }, { blocks: ['right'], id: 'c1' }],
        [
          { blocks: ['a'], id: 'c0', rowId: 'r1' },
          { blocks: ['inserted'], id: 'cN', rowId: 'r1' },
          { blocks: ['b'], id: 'c1', rowId: 'r1' },
        ],
        [
          { blocks: ['last'], id: 'c1', rowId: 'r2' },
          { blocks: ['middle'], id: 'cN', rowId: 'r2' },
          { blocks: ['first'], id: 'c0', rowId: 'r2' },
        ],
      ],
    };
    const before = structuredClone(data);
    const out = normalizeTable(data, mint);

    expect(out.content).toEqual([
      [
        { blocks: ['left'], id: 'c0', rowId: 'm1' },
        { blocks: [], id: 'cN', rowId: 'm1' },
        { blocks: ['right'], id: 'c1', rowId: 'm1' },
      ],
      [
        { blocks: ['a'], id: 'c0', rowId: 'r1' },
        { blocks: ['inserted'], id: 'cN', rowId: 'r1' },
        { blocks: ['b'], id: 'c1', rowId: 'r1' },
      ],
      [
        { blocks: ['first'], id: 'c0', rowId: 'r2' },
        { blocks: ['middle'], id: 'cN', rowId: 'r2' },
        { blocks: ['last'], id: 'c1', rowId: 'r2' },
      ],
    ]);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(data).toEqual(before);
  });

  it('leaves legacy and mixed rows in place without taking their ids', () => {
    const mint = vi.fn(counter());
    const legacy = ['plain', 'text'];
    const mixedCell: CellContent = { blocks: ['legacy-object'], id: 'legacy-column', rowId: 'legacy-row' };
    const mixed: LegacyCellContent[] = [mixedCell, 'still legacy'];
    const out = normalizeTable({
      content: [legacy, [{ blocks: ['a'] }, { blocks: ['b'] }], mixed, [{ blocks: ['c'] }]],
    }, mint);

    expect(out.content).toEqual([
      legacy,
      [{ blocks: ['a'], id: 'm1', rowId: 'm3' }, { blocks: ['b'], id: 'm2', rowId: 'm3' }],
      mixed,
      [{ blocks: ['c'], id: 'm1', rowId: 'm4' }],
    ]);
    const rows: unknown[] | undefined = Array.isArray(out.content) ? out.content : undefined;

    expect(rows?.[0]).toBe(legacy);
    expect(rows?.[2]).toBe(mixed);
    expect(mixed[0]).toBe(mixedCell);
    expect(mixedCell).toEqual({ blocks: ['legacy-object'], id: 'legacy-column', rowId: 'legacy-row' });
    expect(mint).toHaveBeenCalledTimes(4);
  });

  it('keeps existing unique row and column ids without minting', () => {
    const mint = vi.fn(counter());
    const data = {
      content: [
        [{ blocks: ['a'], id: 'c0', rowId: 'r0' }, { blocks: ['b'], id: 'c1', rowId: 'r0' }],
        [{ blocks: ['c'], id: 'c0', rowId: 'r1' }, { blocks: ['d'], id: 'c1', rowId: 'r1' }],
      ],
    };

    expect(normalizeTable(data, mint)).toEqual(data);
    expect(mint).not.toHaveBeenCalled();
  });

  it('repairs duplicated row and column ids after their first slots', () => {
    const mint = vi.fn(counter());
    const out = normalizeTable({
      content: [
        [{ blocks: ['a'], id: 'column', rowId: 'row' }, { blocks: ['b'], id: 'column', rowId: 'row' }],
        [{ blocks: ['c'], id: 'column', rowId: 'row' }, { blocks: ['d'], id: 'column', rowId: 'row' }],
      ],
    }, mint);

    expect(out.content).toEqual([
      [{ blocks: ['a'], id: 'column', rowId: 'row' }, { blocks: ['b'], id: 'm1', rowId: 'row' }],
      [{ blocks: ['c'], id: 'column', rowId: 'm2' }, { blocks: ['d'], id: 'm1', rowId: 'm2' }],
    ]);
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it('takes valid ids from later cells instead of minting for empty ids', () => {
    const mint = vi.fn(counter());
    const out = normalizeTable({
      content: [
        [{ blocks: ['a'], id: '', rowId: '' }, { blocks: ['b'], id: '', rowId: 'r0' }],
        [{ blocks: ['c'], id: 'c0', rowId: 'r0' }, { blocks: ['d'], id: 'c1', rowId: 'r1' }],
      ],
    }, mint);

    expect(out.content).toEqual([
      [{ blocks: ['a'], id: 'c0', rowId: 'r0' }, { blocks: ['b'], id: 'c1', rowId: 'r0' }],
      [{ blocks: ['c'], id: 'c0', rowId: 'r1' }, { blocks: ['d'], id: 'c1', rowId: 'r1' }],
    ]);
    expect(mint).not.toHaveBeenCalled();
  });

  it('preserves frozen input cells, their metadata and non-content data', () => {
    const mint = vi.fn(counter());
    const cell: CellContent & { extra: { note: string } } = {
      blocks: ['a'],
      color: 'red',
      textColor: 'black',
      text: '<b>A</b>',
      blockData: [{ tool: 'paragraph', data: { text: 'A' } }],
      placement: 'bottom-right',
      colspan: 2,
      rowspan: 3,
      mergedInto: [0, 1],
      extra: { note: 'keep' },
    };
    const row = [cell];
    const content = [row];
    const hostMetadata = { title: 'keep' };
    const colWidths = [240];
    const data = { content, withHeadings: false, withHeadingColumn: true, stretched: true, colWidths, textSize: 'comfortable', hostMetadata };
    const before = structuredClone(data);

    Object.freeze(cell.blocks);
    Object.freeze(cell.blockData);
    Object.freeze(cell.extra);
    Object.freeze(cell.mergedInto);
    Object.freeze(cell);
    Object.freeze(row);
    Object.freeze(content);
    Object.freeze(data);

    const out = normalizeTable(data, mint);

    expect(out.content).toEqual([[{ ...cell, id: 'm1', rowId: 'm2' }]]);
    expect(data).toEqual(before);
    expect(out).toEqual({ ...before, content: [[{ ...cell, id: 'm1', rowId: 'm2' }]] });
    expect(out).not.toBe(data);
    expect(out.content).not.toBe(content);
    expect(out.colWidths).toBe(colWidths);
    expect(out.hostMetadata).toBe(hostMetadata);
    expect(cell).not.toHaveProperty('id');
    expect(cell).not.toHaveProperty('rowId');
  });

  it('does not rectangularize positional rows, default flags or filter widths', () => {
    const mint = vi.fn(counter());
    const colWidths = [0, -1];
    const out = normalizeTable({
      content: [[{ blocks: ['short'], colspan: 3 }], [{ blocks: ['a'] }, { blocks: ['b'] }]],
      colWidths,
    }, mint);

    expect(out.content).toEqual([
      [{ blocks: ['short'], colspan: 3, id: 'm1', rowId: 'm3' }],
      [{ blocks: ['a'], id: 'm1', rowId: 'm4' }, { blocks: ['b'], id: 'm2', rowId: 'm4' }],
    ]);
    expect(out.colWidths).toBe(colWidths);
    expect(out).not.toHaveProperty('withHeadings');
    expect(out).not.toHaveProperty('withHeadingColumn');
    expect(out).not.toHaveProperty('stretched');
    expect(mint).toHaveBeenCalledTimes(4);
  });

  it('is idempotent for positional ragged rows', () => {
    const firstMint = vi.fn(counter());
    const secondMint = vi.fn(counter());
    const once = normalizeTable({
      content: [[{ blocks: ['short'], colspan: 3 }], [{ blocks: ['a'] }, { blocks: ['b'] }]],
      colWidths: [0, -1],
    }, firstMint);
    const twice = normalizeTable(once, secondMint);

    expect(twice).toEqual(once);
    expect(secondMint).not.toHaveBeenCalled();
    expect(firstMint).toHaveBeenCalledTimes(4);
  });

  it('preserves leading and interior alignment without trailing padding', () => {
    const mint = vi.fn(counter());
    const secondMint = vi.fn(counter());
    const once = normalizeTable({
      content: [
        [
          { blocks: ['a'], id: 'c0', rowId: 'r0' },
          { blocks: ['b'], id: 'c1', rowId: 'r0' },
          { blocks: ['c'], id: 'c2', rowId: 'r0' },
        ],
        [{ blocks: ['leading'], id: 'c1', rowId: 'r1' }],
        [{ blocks: ['left'], id: 'c0', rowId: 'r2' }, { blocks: ['right'], id: 'c2', rowId: 'r2' }],
      ],
    }, mint);

    expect(once.content).toEqual([
      [
        { blocks: ['a'], id: 'c0', rowId: 'r0' },
        { blocks: ['b'], id: 'c1', rowId: 'r0' },
        { blocks: ['c'], id: 'c2', rowId: 'r0' },
      ],
      [{ blocks: [], id: 'c0', rowId: 'r1' }, { blocks: ['leading'], id: 'c1', rowId: 'r1' }],
      [
        { blocks: ['left'], id: 'c0', rowId: 'r2' },
        { blocks: [], id: 'c1', rowId: 'r2' },
        { blocks: ['right'], id: 'c2', rowId: 'r2' },
      ],
    ]);
    expect(normalizeTable(once, secondMint)).toEqual(once);
    expect(mint).not.toHaveBeenCalled();
    expect(secondMint).not.toHaveBeenCalled();
  });

  it('retains both block-bearing cells when another row repeats known column ids', () => {
    const mint = vi.fn(counter());
    const data = {
      content: [
        [{ blocks: ['a'], id: 'c0', rowId: 'r0' }, { blocks: ['b'], id: 'c1', rowId: 'r0' }],
        [{ blocks: ['first'], id: 'c0', rowId: 'r1' }, { blocks: ['second'], id: 'c0', rowId: 'r1' }],
      ],
    };
    const before = structuredClone(data);
    const out = normalizeTable(data, mint);

    expect(out.content).toEqual([
      [{ blocks: ['a'], id: 'c0', rowId: 'r0' }, { blocks: ['b'], id: 'c1', rowId: 'r0' }],
      [{ blocks: ['first'], id: 'c0', rowId: 'r1' }, { blocks: ['second'], id: 'c1', rowId: 'r1' }],
    ]);
    expect(data).toEqual(before);
    expect(mint).not.toHaveBeenCalled();
  });

  it('is idempotent without calling the second minter', () => {
    const firstMint = vi.fn(counter());
    const secondMint = vi.fn(counter());
    const once = normalizeTable({ content: [[{ blocks: [] }], [{ blocks: [] }]] }, firstMint);
    const twice = normalizeTable(once, secondMint);

    expect(twice).toEqual(once);
    expect(secondMint).not.toHaveBeenCalled();
    expect(firstMint).toHaveBeenCalledTimes(3);
  });

  it.each([
    { name: 'missing content', data: { withHeadings: true } },
    { name: 'null content', data: { content: null, withHeadings: false } },
    { name: 'non-array content', data: { content: 'legacy payload', withHeadings: false } },
  ])('passes $name through without minting', ({ data }) => {
    const mint = vi.fn(counter());

    expect(normalizeTable(data, mint)).toBe(data);
    expect(mint).not.toHaveBeenCalled();
  });
});

describe('table runtime normalization', () => {
  it('completes table ids through the one-argument runtime normalizer', () => {
    let request = 0;
    const getRandomValues = vi.fn((bytes: Uint8Array): Uint8Array => bytes.fill(request++));
    const data = { withHeadings: false, content: [[{ blocks: ['a'] }]] };

    vi.stubGlobal('crypto', { getRandomValues });

    const normalize = BUILT_IN_TOOL_RUNTIMES.get('table')?.normalize;

    expect(normalize?.(data)).toEqual({
      withHeadings: false,
      content: [[{ blocks: ['a'], id: 'uuuuuuuuuu', rowId: 'ssssssssss' }]],
    });
    expect(data).toEqual({ withHeadings: false, content: [[{ blocks: ['a'] }]] });
    expect(getRandomValues.mock.calls.map(([bytes]) => bytes?.length)).toEqual([10, 10]);
  });
});
