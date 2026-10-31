import { expect, test } from '../../tests/helpers/shared-page';

import { contextByFile } from './contexts';

// The tests live in this file on purpose: the shared page keys on testInfo.file,
// which is the file that declares the test.
test('first test gets a context no other spec file had', async ({ page }, testInfo) => {
  const context = page.context();

  for (const [file, other] of contextByFile) {
    expect(other, `context reused from ${file}`).not.toBe(context);
  }
  contextByFile.set(testInfo.file, context);
});

test('second test in the same file keeps that context', async ({ page }, testInfo) => {
  expect(page.context()).toBe(contextByFile.get(testInfo.file));
});
