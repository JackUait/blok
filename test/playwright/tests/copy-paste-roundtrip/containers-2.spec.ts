/* eslint-disable playwright/expect-expect -- assertions live in the round-trip helpers */
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { gotoTestPage, test } from '../helpers/shared-page';
import type { Flavor } from './containers-helpers';
import { selectAll, selectByTitle, selectRange } from './containers-helpers';
import type { TargetId } from './containers-fixtures';
import { docFor, runRoundTrip, SOURCES, TARGET_IDS } from './containers-fixtures';

/**
 * Copy only some children of a container (or a container nested in one) and
 * paste them in the same or another container.
 */

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
});

const PARTIALS: Array<{ name: string; source: string; select: Parameters<typeof runRoundTrip>[1]['select']; roots: string[] }> = [
  { name: 'toggle children tc1..tc2', source: 'toggleOpen', select: (page) => selectRange(page, 'tc1', 'tc2'), roots: ['tc1', 'tc2'] },
  { name: 'toggle child tc2 alone', source: 'toggleOpen', select: (page) => selectByTitle(page, 'tc2'), roots: ['tc2'] },
  { name: 'inner toggle tin with its child', source: 'toggleOpen', select: (page) => selectByTitle(page, 'tin'), roots: ['tin'] },
  { name: 'grandchild tg1', source: 'toggleOpen', select: (page) => selectByTitle(page, 'tg1'), roots: ['tg1'] },
  { name: 'toggle children tc2..tin (child + nested toggle)', source: 'toggleOpen', select: (page) => selectRange(page, 'tc2', 'tin'), roots: ['tc2', 'tin'] },
  { name: 'callout children cc1..cc2', source: 'callout', select: (page) => selectRange(page, 'cc1', 'cc2'), roots: ['cc1', 'cc2'] },
  { name: 'column paragraph c1p', source: 'columns', select: (page) => selectByTitle(page, 'c1p'), roots: ['c1p'] },
  // A range that fills every column copies the whole column layout.
  { name: 'across columns c1p..c2p', source: 'columns', select: (page) => selectRange(page, 'c1p', 'c2p'), roots: ['cl'] },
  { name: 'tab body t1p', source: 'tabs', select: (page) => selectByTitle(page, 't1p'), roots: ['t1p'] },
  { name: 'toggle in callout ntog', source: 'nested', select: (page) => selectByTitle(page, 'ntog'), roots: ['ntog'] },
  { name: 'toggle heading child thc', source: 'toggleHeading', select: (page) => selectByTitle(page, 'thc'), roots: ['thc'] },
  { name: 'quote child qc1', source: 'quote', select: (page) => selectByTitle(page, 'qc1'), roots: ['qc1'] },
];

test.describe('containers: partial children copy -> paste (full clipboard)', () => {
  for (const partial of PARTIALS) {
    for (const target of TARGET_IDS) {
      test(`${partial.name} -> ${target}`, async ({ page }) => {
        await runRoundTrip(page, {
          name: `${partial.name} -> ${target}`,
          doc: docFor(SOURCES[partial.source].blocks),
          select: partial.select,
          expectRoots: partial.roots,
          target,
          flavor: 'full',
        });
      });
    }
  }
});

test.describe('containers: partial children, degraded clipboards', () => {
  const targets: TargetId[] = ['tgt-top', 'tgt-in-cal'];

  for (const flavor of ['html', 'plain'] as Flavor[]) {
    for (const partial of PARTIALS.slice(0, 3)) {
      // eslint-disable-next-line max-depth -- in-page DOM walk
      for (const target of targets) {
        test(`${flavor}: ${partial.name} -> ${target}`, async ({ page }) => {
          await runRoundTrip(page, {
            name: `${flavor}: ${partial.name} -> ${target}`,
            doc: docFor(SOURCES[partial.source].blocks),
            select: partial.select,
            expectRoots: partial.roots,
            target,
            flavor,
          });
        });
      }
    }
  }
});

test.describe('containers: whole containers inside a container', () => {
  for (const name of ['toggleOpen', 'callout', 'columns', 'tabs']) {
    for (const target of ['tgt-in-cal', 'tgt-in-col'] as TargetId[]) {
      test(`container-in-callout: ${name} -> ${target}`, async ({ page }) => {
        const inner = SOURCES[name].blocks.map((b) => (b.id === SOURCES[name].root ? { ...b, parent: 'outer' } : b));

        await runRoundTrip(page, {
          name: `container-in-callout: ${name} -> ${target}`,
          doc: docFor([
            { id: 'outer', type: 'callout', data: { emoji: '📦' }, content: [SOURCES[name].root] },
            ...inner,
          ]),
          select: (page) => selectRange(page, 'pre', 'post'),
          expectRoots: ['pre', 'outer', 'post'],
          target,
          flavor: 'full',
        });
      });
    }
  }
});

test.describe('containers: select all -> paste', () => {
  test('select all (toggle, callout, columns, tabs) -> tgt-top', async ({ page }) => {
    const doc = [
      { id: 'pre', type: 'paragraph', data: { text: 'Before' } },
      ...SOURCES.toggleOpen.blocks,
      ...SOURCES.callout.blocks,
      ...SOURCES.columns.blocks,
      ...SOURCES.tabs.blocks,
      { id: 'tgt-top', type: 'paragraph', data: { text: '' } },
    ];

    await runRoundTrip(page, {
      name: 'select all -> tgt-top',
      doc,
      select: (p) => selectAll(p, 'pre'),
      expectRoots: ['pre', 'tog', 'cal', 'cl', 'tb', 'tgt-top'],
      target: 'tgt-top',
      flavor: 'full',
    });
  });
});

test.describe('containers: tabs with a non-default active tab', () => {
  for (const target of ['tgt-top', 'tgt-in-cal'] as TargetId[]) {
    test(`tabs Beta active -> ${target}`, async ({ page }) => {
      test.fixme(true, 'containers-tabs-active-tab-resets: the open tab is view state, which a load does not keep either');
      await runRoundTrip(page, {
        name: `tabs Beta active -> ${target}`,
        doc: docFor(SOURCES.tabs.blocks),
        prepare: async (p) => {
          await p.getByRole('tab', { name: 'Beta', exact: true }).click();
        },
        select: (p) => selectRange(p, 'pre', 'post'),
        expectRoots: ['pre', 'tb', 'post'],
        target,
        flavor: 'full',
      });
    });
  }
});
