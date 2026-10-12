import type { OutputBlockData, OutputData } from '../../../../types';
import { diffOutputData } from '../../../../src/view/diff-output-data';
import type { Grader, Verdict } from '../types';
import type { BlockRef } from './text';
import { childrenOf, inOrder, plainText, resolveBlock, rootsOf, segmentsOf } from './text';

export interface ShapeQuery {
  type: string;
  id?: string;
  data?: Record<string, unknown>;
  children?: ShapeQuery[];
  count?: number;
}

const ok = (detail: string): Verdict => ({ pass: true, detail });
const no = (detail: string): Verdict => ({ pass: false, detail });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const includesDeep = (actual: unknown, expected: unknown): boolean => {
  if (isRecord(expected)) {
    return isRecord(actual) && Object.entries(expected).every(([k, v]) => includesDeep(actual[k], v));
  }

  return JSON.stringify(actual) === JSON.stringify(expected);
};

const matches = (doc: OutputData, block: OutputBlockData, q: ShapeQuery): boolean => {
  if (block.type !== q.type || (q.id !== undefined && block.id !== q.id) || (q.data !== undefined && !includesDeep(block.data, q.data))) {
    return false;
  }

  if (q.children === undefined) {
    return true;
  }

  const kids = childrenOf(doc, block);
  // `count` repeats one query over a run of consecutive children.
  const wanted = q.children.flatMap((child) => new Array<ShapeQuery>(child.count ?? 1).fill({ ...child, count: 1 }));

  return wanted.length === kids.length && wanted.every((child, i) => matches(doc, kids[i], child));
};

export const shape = (name: string, query: ShapeQuery): Grader => ({
  name: `shape:${name}`,
  check: ({ final }) => (inOrder(final).some((b) => matches(final, b, query)) ? ok(name) : no(`no block matches ${JSON.stringify(query)}`)),
});

export const sequence = (name: string, types: string[], parentId: string | null = null): Grader => ({
  name: `sequence:${name}`,
  check: ({ final }) => {
    const parent = parentId === null ? undefined : final.blocks.find((b) => b.id === parentId);
    const list = (parent === undefined ? rootsOf(final) : childrenOf(final, parent)).map((b) => b.type);

    for (let i = 0; i + types.length <= list.length; i++) {
      if (types.every((t, j) => list[i + j] === t)) {
        return ok(name);
      }
    }

    return no(`expected ${types.join(' → ')} in ${list.join(', ')}`);
  },
});

export const text = (name: string, ref: BlockRef, expected: string | RegExp): Grader => ({
  name: `text:${name}`,
  check: ({ final }) => {
    const block = resolveBlock(final, ref);
    const actual = block === undefined ? '' : plainText(block).replace(/\s+/g, ' ').trim();
    const pass = typeof expected === 'string' ? actual === expected : expected.test(actual);

    return pass ? ok(name) : no(`text was "${actual}"`);
  },
});

export const marks = (name: string, ref: BlockRef, substring: string, expected: Record<string, unknown>): Grader => ({
  name: `marks:${name}`,
  check: ({ final }) => {
    const block = resolveBlock(final, ref);

    if (block === undefined) {
      return no('block not found');
    }

    // One entry per character of plainText, so indexes line up with indexOf.
    const chars: unknown[] = segmentsOf(block).flatMap((s) =>
      new Array<unknown>('text' in s ? s.text.length : 1).fill(s.marks ?? {})
    );

    const start = plainText(block).indexOf(substring);

    if (start < 0) {
      return no(`"${substring}" not in the block`);
    }

    const all = chars.slice(start, start + substring.length).every((m) => includesDeep(m, expected));

    return all ? ok(name) : no(`"${substring}" lacks ${JSON.stringify(expected)}`);
  },
});

export const untouched = (allowed: string[]): Grader => ({
  name: 'untouched',
  check: ({ seed, final }) => {
    const diff = diffOutputData(seed, final);
    const touched = [...diff.changed, ...diff.moved, ...diff.removed]
      .map((x) => x.id)
      .filter((id): id is string => id !== undefined && !allowed.includes(id));

    return touched.length === 0 ? ok('only allowed blocks changed') : no(`also changed: ${[...new Set(touched)].join(', ')}`);
  },
});

export const unchanged = (): Grader => ({
  name: 'unchanged',
  check: ({ seed, final }) => {
    const diff = diffOutputData(seed, final);
    const count = diff.added.length + diff.removed.length + diff.changed.length + diff.moved.length;

    return count === 0 ? ok('document unchanged') : no(`${count} block change(s)`);
  },
});

export const schemaValid = (validate: (doc: OutputData) => string[]): Grader => ({
  name: 'schemaValid',
  check: ({ final }) => {
    const errors = validate(final);

    return errors.length === 0 ? ok('valid saved document') : no(errors.join('; '));
  },
});

export const dataCheck = (name: string, type: string, test: (data: Record<string, unknown>) => boolean, detail: string): Grader => ({
  name: `data:${name}`,
  check: ({ final }) => {
    const blocks = final.blocks.filter((b) => b.type === type);

    return blocks.length > 0 && blocks.every((b) => test(b.data)) ? ok(detail) : no(`not every ${type}: ${detail}`);
  },
});
