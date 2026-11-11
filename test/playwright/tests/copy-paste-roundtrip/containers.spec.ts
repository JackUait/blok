/* eslint-disable playwright/expect-expect -- assertions live in the round-trip helpers */
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { gotoTestPage, test } from '../helpers/shared-page';
import { docFor, runRoundTrip, sourceRoots, sourceSelect, SOURCES, TARGET_IDS } from './containers-fixtures';

/**
 * Copy a whole container inside Blok and paste it back, at every target.
 */

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
});

test.describe('containers: whole container copy -> paste (full clipboard)', () => {
  for (const name of Object.keys(SOURCES)) {
    for (const target of TARGET_IDS) {
      test(`${name} -> ${target}`, async ({ page }) => {
        await runRoundTrip(page, {
          name: `${name} -> ${target}`,
          doc: docFor(SOURCES[name].blocks),
          select: sourceSelect(name),
          expectRoots: sourceRoots(name),
          target,
          flavor: 'full',
        });
      });
    }
  }
});

test.describe('containers: degraded clipboards to top level', () => {
  for (const flavor of ['html', 'plain'] as const) {
    for (const name of Object.keys(SOURCES)) {
      test(`${flavor}: ${name} -> tgt-top`, async ({ page }) => {
        await runRoundTrip(page, {
          name: `${flavor}: ${name} -> tgt-top`,
          doc: docFor(SOURCES[name].blocks),
          select: sourceSelect(name),
          expectRoots: sourceRoots(name),
          target: 'tgt-top',
          flavor,
        });
      });
    }
  }
});

test.describe('containers: cut -> paste', () => {
  for (const name of Object.keys(SOURCES)) {
    test(`cut: ${name} -> tgt-top`, async ({ page }) => {
      await runRoundTrip(page, {
        name: `cut: ${name} -> tgt-top`,
        doc: docFor(SOURCES[name].blocks),
        select: sourceSelect(name),
        expectRoots: sourceRoots(name),
        target: 'tgt-top',
        flavor: 'full',
        cut: true,
      });
    });
  }
});
