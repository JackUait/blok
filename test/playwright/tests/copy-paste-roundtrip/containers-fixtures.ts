import type { Page } from '@playwright/test';

import { expect } from '../helpers/shared-page';
import type { Blocks, Flavor, Node } from './containers-helpers';
import {
  childIds,
  clipboardEvent,
  createBlok,
  degrade,
  domIntegrity,
  editable,
  integrity,
  layout,
  pasteInto,
  save,
  selectByTitle,
  selectRange,
  tree,
} from './containers-helpers';

/**
 * Copy a container (or part of one) inside Blok and paste it back.
 * Each case checks save and DOM integrity, lost text and strays, and for a
 * full clipboard that the pasted forest equals the copied one.
 */

export const SOURCES: Record<string, { blocks: Blocks; root: string; select: 'title' | 'range' }> = {
  toggleOpen: {
    root: 'tog',
    select: 'title',
    blocks: [
      { id: 'tog', type: 'toggle', data: { text: 'Toggle T', isOpen: true }, content: ['tc1', 'tc2', 'tin'] },
      { id: 'tc1', type: 'paragraph', data: { text: 'T child <b>bold</b> 1' }, parent: 'tog' },
      { id: 'tc2', type: 'paragraph', data: { text: 'T child 2' }, parent: 'tog' },
      { id: 'tin', type: 'toggle', data: { text: 'Inner toggle', isOpen: true }, parent: 'tog', content: ['tg1'] },
      { id: 'tg1', type: 'paragraph', data: { text: 'Grandchild' }, parent: 'tin' },
    ],
  },
  toggleClosed: {
    root: 'tog',
    select: 'title',
    blocks: [
      { id: 'tog', type: 'toggle', data: { text: 'Closed T' }, content: ['tc1', 'tin'] },
      { id: 'tc1', type: 'paragraph', data: { text: 'Hidden child' }, parent: 'tog' },
      { id: 'tin', type: 'toggle', data: { text: 'Hidden inner' }, parent: 'tog', content: ['tg1'] },
      { id: 'tg1', type: 'paragraph', data: { text: 'Hidden grandchild' }, parent: 'tin' },
    ],
  },
  toggleHeading: {
    root: 'th',
    select: 'title',
    blocks: [
      { id: 'th', type: 'header', data: { text: 'Toggle heading', level: 2, isToggleable: true, isOpen: true }, content: ['thc'] },
      { id: 'thc', type: 'paragraph', data: { text: 'TH child' }, parent: 'th' },
    ],
  },
  callout: {
    root: 'cal',
    select: 'range',
    blocks: [
      { id: 'cal', type: 'callout', data: { emoji: '🔥', backgroundColor: 'red' }, content: ['cc1', 'cc2'] },
      { id: 'cc1', type: 'paragraph', data: { text: 'C child 1' }, parent: 'cal' },
      { id: 'cc2', type: 'list', data: { text: 'C item', style: 'unordered' }, parent: 'cal' },
    ],
  },
  quote: {
    root: 'q',
    select: 'title',
    blocks: [
      { id: 'q', type: 'quote', data: { text: 'Quote text' }, content: ['qc1'] },
      { id: 'qc1', type: 'paragraph', data: { text: 'Q child' }, parent: 'q' },
    ],
  },
  columns: {
    root: 'cl',
    select: 'range',
    blocks: [
      { id: 'cl', type: 'column_list', data: {}, content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', data: { widthRatio: 2 }, parent: 'cl', content: ['c1p'] },
      { id: 'c1p', type: 'paragraph', data: { text: 'Left col' }, parent: 'c1' },
      { id: 'c2', type: 'column', data: { widthRatio: 1 }, parent: 'cl', content: ['c2p'] },
      { id: 'c2p', type: 'paragraph', data: { text: 'Right col' }, parent: 'c2' },
    ],
  },
  toggleWithTable: {
    root: 'tog',
    select: 'title',
    blocks: [
      { id: 'tog', type: 'toggle', data: { text: 'Toggle with table', isOpen: true }, content: ['ttable'] },
      { id: 'ttable', type: 'table', data: { withHeadings: false, withHeadingColumn: false, content: [['Cell A', 'Cell B']] }, parent: 'tog' },
    ],
  },
  tabs: {
    root: 'tb',
    select: 'range',
    blocks: [
      { id: 'tb', type: 'tabs', data: {}, content: ['t1', 't2'] },
      { id: 't1', type: 'tab', data: { title: 'Alpha' }, parent: 'tb', content: ['t1p'] },
      { id: 't1p', type: 'paragraph', data: { text: 'Alpha body' }, parent: 't1' },
      { id: 't2', type: 'tab', data: { title: 'Beta', icon: '🍎' }, parent: 'tb', content: ['t2p'] },
      { id: 't2p', type: 'paragraph', data: { text: 'Beta body' }, parent: 't2' },
    ],
  },
  nested: {
    root: 'nc',
    select: 'range',
    blocks: [
      { id: 'nc', type: 'callout', data: { emoji: '💡' }, content: ['ntog'] },
      { id: 'ntog', type: 'toggle', data: { text: 'Toggle in callout', isOpen: true }, parent: 'nc', content: ['nchild'] },
      { id: 'nchild', type: 'paragraph', data: { text: 'Deep child' }, parent: 'ntog' },
    ],
  },
};

export const TARGETS: Blocks = [
  { id: 'tgt-top', type: 'paragraph', data: { text: '' } },
  { id: 'tgt-cal', type: 'callout', data: { emoji: '💡' }, content: ['tgt-in-cal'] },
  { id: 'tgt-in-cal', type: 'paragraph', data: { text: '' }, parent: 'tgt-cal' },
  { id: 'tgt-tog', type: 'toggle', data: { text: 'Target toggle', isOpen: true }, content: ['tgt-in-tog'] },
  { id: 'tgt-in-tog', type: 'paragraph', data: { text: '' }, parent: 'tgt-tog' },
  { id: 'tgt-cl', type: 'column_list', data: {}, content: ['tgt-col1', 'tgt-col2'] },
  { id: 'tgt-col1', type: 'column', data: {}, parent: 'tgt-cl', content: ['tgt-in-col'] },
  { id: 'tgt-in-col', type: 'paragraph', data: { text: '' }, parent: 'tgt-col1' },
  { id: 'tgt-col2', type: 'column', data: {}, parent: 'tgt-cl', content: ['tgt-col2p'] },
  { id: 'tgt-col2p', type: 'paragraph', data: { text: 'Other column' }, parent: 'tgt-col2' },
  { id: 'tgt-tabs', type: 'tabs', data: {}, content: ['tgt-tab1'] },
  { id: 'tgt-tab1', type: 'tab', data: { title: 'Dest' }, parent: 'tgt-tabs', content: ['tgt-in-tab'] },
  { id: 'tgt-in-tab', type: 'paragraph', data: { text: '' }, parent: 'tgt-tab1' },
  { id: 'tgt-table', type: 'table', data: { withHeadings: false, withHeadingColumn: false, content: [['', 'B1'], ['A2', 'B2']] } },
  { id: 'tail', type: 'paragraph', data: { text: 'Tail' } },
];

export const TARGET_IDS = ['tgt-top', 'tgt-in-cal', 'tgt-in-tog', 'tgt-in-col', 'tgt-in-tab', 'table-cell'] as const;

export type TargetId = typeof TARGET_IDS[number];

export const docFor = (source: Blocks): Blocks => [
  { id: 'pre', type: 'paragraph', data: { text: 'Before' } },
  ...source,
  { id: 'post', type: 'paragraph', data: { text: 'After' } },
  ...TARGETS,
];

const targetLocator = (page: Page, target: TargetId): ReturnType<Page['locator']> =>
  target === 'table-cell'
    ? page.locator('[data-blok-id="tgt-table"] [data-blok-table-cell]').first().locator('[contenteditable="true"]').first()
    : editable(page, target);

const targetParent = (blocks: Blocks, target: TargetId): string | null =>
  target === 'table-cell' ? 'tgt-table' : (blocks.find((b) => b.id === target)?.parent ?? null);

const textsOf = (node: Node): string[] => {
  const data = node.data as Record<string, unknown> | null;
  const own = data !== null && typeof data === 'object'
    ? [data.text, data.title].filter((v): v is string => typeof v === 'string').map(plain)
    : [];

  return [...own, ...node.children.flatMap(textsOf)];
};

const plain = (v: string): string => v.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

const allTexts = (blocks: Blocks): string =>
  blocks.map((b) => {
    const d = b.data;

    return [d.text, d.title].filter((v): v is string => typeof v === 'string').map(plain).join(' ');
  }).join(' | ') + ' | ' + JSON.stringify(blocks.map((b) => b.data));

const sorted = (v: unknown): unknown => {
  if (Array.isArray(v)) {
    return v.map(sorted);
  }
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]));
  }

  return v;
};

const key = (v: unknown): string => JSON.stringify(sorted(v));

const shape = (n: Node): unknown => ({ t: n.type, c: n.children.map(shape) });

/** Per-node data differences between two forests walked side by side. */
const dataDiffs = (a: Node[], b: Node[], path = ''): string[] =>
  a.flatMap((na, i) => {
    const nb = b[i];

    if (nb === undefined) {
      return [`${path}${i}:${na.type} missing`];
    }
    const da = (na.data ?? {}) as Record<string, unknown>;
    const db = (nb.data ?? {}) as Record<string, unknown>;
    const keys = Array.from(new Set([...Object.keys(da), ...Object.keys(db)]));
    // A table's cell refs name its cell blocks, which get fresh ids; integrity() checks them.
    const own = keys.filter((k) => !(na.type === 'table' && k === 'content') && key(da[k]) !== key(db[k])).map((k) => `${path}${i}:${na.type}.${k}: ${JSON.stringify(da[k])} -> ${JSON.stringify(db[k])}`);

    return [...own, ...dataDiffs(na.children, nb.children, `${path}${i}/`)];
  });

/** Tools a table cell never holds; a paste carrying one leaves the table. */
const TABLE_RESTRICTED = new Set(['header', 'table', 'column_list', 'tabs']);

export type RoundTrip = {
  name: string;
  doc: Blocks;
  select: (page: Page) => Promise<void>;
  /** Roots the user means to copy, in order. */
  expectRoots: string[];
  target: TargetId;
  flavor: Flavor;
  cut?: boolean;
  /** Runs after load, before selecting (e.g. switch the active tab). */
  prepare?: (page: Page) => Promise<void>;
};

export const runRoundTrip = async (page: Page, rt: RoundTrip): Promise<void> => {
  await createBlok(page, rt.doc);
  await rt.prepare?.(page);
  const before = await save(page);
  const expected = rt.expectRoots.map((id) => tree(before, id));

  await rt.select(page);
  const layoutBefore = await Promise.all(rt.expectRoots.map((id) => layout(page, id)));
  const clip = await clipboardEvent(page, rt.cut === true ? 'cut' : 'copy');

  // eslint-disable-next-line playwright/no-wait-for-timeout -- cut deletes asynchronously
  await page.waitForTimeout(rt.cut === true ? 400 : 50);
  const beforePaste = await save(page);
  const restrictedInCell = rt.target === 'table-cell'
    && expected.some(function walk(n: Node): boolean { return TABLE_RESTRICTED.has(n.type) || n.children.some(walk); });
  // A tab denies a tabs child, so a paste holding one goes after the target tabs, at the root.
  const tabsInTab = rt.target === 'tgt-in-tab' && expected.some((n) => n.type === 'tabs');
  const parent = restrictedInCell || tabsInTab ? null : targetParent(beforePaste, rt.target);
  const existing = new Set(childIds(beforePaste, parent));
  const allBefore = new Set(beforePaste.map((b) => b.id));

  await pasteInto(page, targetLocator(page, rt.target), degrade(clip, rt.flavor));
  const after = await save(page);
  const newKids = childIds(after, parent).filter((id) => !existing.has(id));
  const got = newKids.map((id) => tree(after, id));
  const strays = after.filter((b) => !allBefore.has(b.id) && !newKids.some((k) => k === b.id || isUnder(after, b.id ?? '', k)));
  const structural = integrity(after);
  const dom = await domIntegrity(page, after);
  const layoutAfter = await Promise.all(newKids.map((id) => layout(page, id)));
  const afterText = allTexts(after.filter((b) => !allBefore.has(b.id) || rt.cut === true || b.id === rt.target));
  const lostTexts = expected.flatMap(textsOf).filter((t) => t !== '' && !afterText.includes(t));
  const sourceIntact = rt.cut === true || rt.expectRoots.every((id, i) => id === rt.target || key(tree(after, id)) === key(expected[i]));
  const diffs = dataDiffs(expected, got);

  expect.soft(structural, 'save integrity').toEqual([]);
  expect.soft(dom, 'DOM integrity').toEqual([]);
  expect.soft(lostTexts, 'lost text').toEqual([]);
  expect.soft(sourceIntact, 'source intact after copy').toBe(true);
  expect.soft(strays, 'blocks pasted outside the target').toEqual([]);
  if (rt.flavor === 'full') {
    expect.soft(got.map(shape), 'pasted structure').toEqual(expected.map(shape));
    expect.soft(diffs, 'pasted data').toEqual([]);
    expect.soft(layoutAfter, 'layout').toEqual(layoutBefore);
  }
};

const isUnder = (blocks: Blocks, id: string, ancestor: string): boolean => {
  const parent = blocks.find((b) => b.id === id)?.parent;

  if (parent === undefined || parent === null) {
    return false;
  }

  return parent === ancestor || isUnder(blocks, parent, ancestor);
};

export const sourceSelect = (name: string): ((page: Page) => Promise<void>) => {
  const source = SOURCES[name];

  return source.select === 'title'
    ? (page) => selectByTitle(page, source.root)
    : (page) => selectRange(page, 'pre', 'post');
};

export const sourceRoots = (name: string): string[] =>
  SOURCES[name].select === 'title' ? [SOURCES[name].root] : ['pre', SOURCES[name].root, 'post'];

