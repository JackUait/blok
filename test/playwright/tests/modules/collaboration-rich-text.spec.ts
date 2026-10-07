import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

import type { RichText } from '../../../../types/rich-text';

import {
  collabClientId,
  collabUpdateClients,
  gotoCollabPage,
  holdCollabDocFrames,
  mountCollabEditor,
  releaseCollabDocFrames,
  savedBlocks,
  seedDocument,
  unmountCollabEditor,
  waitForHeldDocFramesToSettle,
} from '../helpers/collab';

/**
 * Marks while two people write in one block: rich text is a formatted
 * `Y.XmlText`, so marks merge per character and a peer's insert carries its
 * own marks explicitly.
 *
 * Every test holds doc frames on BOTH pages while the peers write, and waits
 * until each page holds the other's whole burst before releasing. So each
 * write was computed against a document that did not hold the peer's text.
 * Without that, the near-instant relay lets the peers take turns and the test
 * proves nothing (see collaboration-same-block.spec.ts).
 *
 * Yjs orders two inserts at the same spot by client id, lower id first. Each
 * test runs once with alpha holding the lower id and once with beta holding
 * it, and asserts the exact merged text for that order.
 */

const PARAGRAPH = '[data-blok-component="paragraph"]';

const SEEDED = 'p1';

type LowerId = 'alpha' | 'beta';

interface Room {
  doc: string;
  pageA: Page;
  pageB: Page;
}

const newDoc = (): string => `rich-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The seeded paragraph. The empty room also starts with an empty paragraph of its own. */
const paragraph = (page: Page, name: string): Locator =>
  page.getByTestId(name).locator(`[data-blok-id="${SEEDED}"]${PARAGRAPH} [contenteditable="true"]`);

/**
 * The saved segments of the seeded paragraph.
 * @param page - the page the editor is on
 * @param name - the editor's harness name
 */
const seededSegments = async (page: Page, name: string): Promise<RichText> =>
  (await savedBlocks(page, name)).find((block) => block.id === SEEDED)?.data.text as RichText;

/**
 * Opens a room: alpha seeds one paragraph, beta joins and shows it. Remounts
 * on a new doc until the client ids come out in the wanted order (Yjs picks
 * them at random).
 * @param context - the browser context
 * @param html - the seeded paragraph
 * @param lower - which editor must hold the lower client id
 */
const openRoom = async (context: BrowserContext, html: string, lower: LowerId): Promise<Room> => {
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await gotoCollabPage(pageA);
  await gotoCollabPage(pageB);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const doc = newDoc();

    await mountCollabEditor(pageA, { doc,
      name: 'alpha',
      seedsEmptyRoom: true });
    await seedDocument(pageA, 'alpha', [{ id: SEEDED,
      data: { text: html } }]);
    await mountCollabEditor(pageB, { doc,
      name: 'beta',
      seedsEmptyRoom: false });
    await expect(paragraph(pageA, 'alpha')).not.toHaveText('');
    await expect(paragraph(pageB, 'beta')).toHaveText(await paragraph(pageA, 'alpha').innerText());

    const [alphaId, betaId] = [await collabClientId(pageA, doc), await collabClientId(pageB, doc)];

    if ((alphaId < betaId) === (lower === 'alpha')) {
      return { doc,
        pageA,
        pageB };
    }

    await unmountCollabEditor(pageB, 'beta');
    await unmountCollabEditor(pageA, 'alpha');
  }

  throw new Error(`no room gave ${lower} the lower client id in 12 tries`);
};

/**
 * Puts a real caret `offset` characters into one editor's first paragraph.
 * @param page - the page the editor is on
 * @param name - the editor's harness name
 * @param offset - how many characters in
 */
const putCaretAt = async (page: Page, name: string, offset: number): Promise<void> => {
  await paragraph(page, name).click();
  await page.keyboard.press('Home');

  for (let step = 0; step < offset; step += 1) {
    await page.keyboard.press('ArrowRight');
  }
};

/**
 * Holds doc frames on both pages, runs the writes, then waits until each page
 * holds everything the other published. Only then are the writes known to be
 * blind to each other.
 * @param room - the room
 * @param writes - the two peers' writes
 */
const writeApart = async (room: Room, writes: () => Promise<unknown>): Promise<void> => {
  await Promise.all([holdCollabDocFrames(room.pageA), holdCollabDocFrames(room.pageB)]);
  await writes();
  await Promise.all([waitForHeldDocFramesToSettle(room.pageA), waitForHeldDocFramesToSettle(room.pageB)]);
};

const reunite = async (room: Room): Promise<void> => {
  await Promise.all([releaseCollabDocFrames(room.pageA), releaseCollabDocFrames(room.pageB)]);
};

/**
 * The client id order the room was opened with really is the one each editor
 * wrote with: the update frames each page sent came from its announced id.
 * @param room - the room
 */
const expectWritersMatchAwareness = async (room: Room): Promise<void> => {
  const [alphaId, betaId] = [await collabClientId(room.pageA, room.doc), await collabClientId(room.pageB, room.doc)];

  expect({ alpha: [...new Set(await collabUpdateClients(room.pageA, room.doc))],
    beta: [...new Set(await collabUpdateClients(room.pageB, room.doc))] })
    .toEqual({ alpha: [alphaId],
      beta: [betaId] });
};

for (const lower of ['alpha', 'beta'] as const) {
  test.describe(`rich text marks under concurrent writes (${lower} has the lower client id)`, () => {
    test('two people typing at one spot in a bold paragraph keep both words bold', async ({ context }) => {
      const room = await openRoom(context, '<b>hello world</b>', lower);

      await putCaretAt(room.pageA, 'alpha', 8);
      await putCaretAt(room.pageB, 'beta', 8);

      await writeApart(room, () => Promise.all([
        room.pageA.keyboard.type('AAAAA', { delay: 30 }),
        room.pageB.keyboard.type('BBBBB', { delay: 30 }),
      ]));

      // Apart, and each typed into the bold run on its own screen.
      expect({ alpha: await seededSegments(room.pageA, 'alpha'),
        beta: await seededSegments(room.pageB, 'beta') })
        .toEqual({ alpha: [{ text: 'hello woAAAAArld',
          marks: { bold: true } }],
        beta: [{ text: 'hello woBBBBBrld',
          marks: { bold: true } }] });

      await reunite(room);

      const merged = lower === 'alpha' ? 'hello woAAAAABBBBBrld' : 'hello woBBBBBAAAAArld';
      const expected: RichText = [{ text: merged,
        marks: { bold: true } }];

      await expect.poll(() => seededSegments(room.pageA, 'alpha')).toEqual(expected);
      await expect.poll(() => seededSegments(room.pageB, 'beta')).toEqual(expected);

      for (const [page, name] of [[room.pageA, 'alpha'], [room.pageB, 'beta']] as const) {
        await expect(paragraph(page, name)).toHaveText(merged);
        await expect(paragraph(page, name).getByRole('strong')).toHaveText([merged]);
      }

      await expectWritersMatchAwareness(room);
    });

    test('text typed right after a link is not linked for the other person', async ({ context }) => {
      const room = await openRoom(context, 'see <a href="https://example.com">docs</a> now', lower);

      await putCaretAt(room.pageA, 'alpha', 8);
      await putCaretAt(room.pageB, 'beta', 8);

      await writeApart(room, () => Promise.all([
        room.pageA.keyboard.type('AAAAA', { delay: 30 }),
        room.pageB.keyboard.type('BBBBB', { delay: 30 }),
      ]));

      const link = { link: { href: 'https://example.com' } };

      // Apart, and on its own screen each typed outside the link.
      expect({ alpha: await seededSegments(room.pageA, 'alpha'),
        beta: await seededSegments(room.pageB, 'beta') })
        .toEqual({ alpha: [{ text: 'see ' }, { text: 'docs',
          marks: link }, { text: 'AAAAA now' }],
        beta: [{ text: 'see ' }, { text: 'docs',
          marks: link }, { text: 'BBBBB now' }] });

      await reunite(room);

      const typed = lower === 'alpha' ? 'AAAAABBBBB' : 'BBBBBAAAAA';
      const expected: RichText = [{ text: 'see ' }, { text: 'docs',
        marks: link }, { text: `${typed} now` }];

      await expect.poll(() => seededSegments(room.pageA, 'alpha')).toEqual(expected);
      await expect.poll(() => seededSegments(room.pageB, 'beta')).toEqual(expected);

      for (const [page, name] of [[room.pageA, 'alpha'], [room.pageB, 'beta']] as const) {
        await expect(paragraph(page, name)).toHaveText(`see docs${typed} now`);
        await expect(paragraph(page, name).getByRole('link')).toHaveText(['docs']);
      }

      await expectWritersMatchAwareness(room);
    });

    test('a character typed inside a word the other person bolds ends up bold', async ({ context }) => {
      const room = await openRoom(context, 'the quick fox', lower);

      await putCaretAt(room.pageA, 'alpha', 6);
      await putCaretAt(room.pageB, 'beta', 4);
      for (let step = 0; step < 5; step += 1) {
        await room.pageB.keyboard.press('Shift+ArrowRight');
      }

      await writeApart(room, () => Promise.all([
        room.pageA.keyboard.type('X'),
        room.pageB.keyboard.press('ControlOrMeta+b'),
      ]));

      // Apart: alpha typed into a plain word, beta bolded a word with no X.
      expect({ alpha: await seededSegments(room.pageA, 'alpha'),
        beta: await seededSegments(room.pageB, 'beta') })
        .toEqual({ alpha: [{ text: 'the quXick fox' }],
          beta: [{ text: 'the ' }, { text: 'quick',
            marks: { bold: true } }, { text: ' fox' }] });

      await reunite(room);

      const expected: RichText = [{ text: 'the ' }, { text: 'quXick',
        marks: { bold: true } }, { text: ' fox' }];

      await expect.poll(() => seededSegments(room.pageA, 'alpha')).toEqual(expected);
      await expect.poll(() => seededSegments(room.pageB, 'beta')).toEqual(expected);

      for (const [page, name] of [[room.pageA, 'alpha'], [room.pageB, 'beta']] as const) {
        await expect(paragraph(page, name)).toHaveText('the quXick fox');
        await expect(paragraph(page, name).getByRole('strong')).toHaveText(['quXick']);
      }

      await expectWritersMatchAwareness(room);
    });
  });
}
