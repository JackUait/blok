import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  gotoCollabPage,
  holdCollabDocFrames,
  mountCollabEditor,
  releaseCollabDocFrames,
  savedBlocks,
  seedDocument,
} from '../helpers/collab';

/**
 * Two people writing into THE SAME BLOCK at the same instant.
 *
 * `collaboration.spec.ts` proves two editors converge when they work on
 * DIFFERENT blocks. This file is only about the same block: opposite ends of
 * one paragraph, text against formatting, an emoji against adjacent typing, one
 * table cell, and typing into a block the other person is deleting.
 *
 * WHY EVERY TEST HERE HOLDS DOC FRAMES — read this before adding another.
 *
 * The relay (helpers/collab.ts) is a BroadcastChannel with two `setTimeout(0)`
 * hops, so a peer's characters come back in well under a frame. Measured, with
 * both peers typing ten characters over ~300ms straight at each other: by the
 * moment alpha stopped typing it had already rendered NINE of beta's ten. So
 * two bursts inside one `Promise.all` overlap far less than they appear to.
 *
 * That is NOT the same as saying such a test proves nothing, and an earlier
 * draft of this comment said so wrongly. Emptying `DIFFABLE_TEXT_KEYS` at HEAD
 * and re-running the `Promise.all`-shaped test in `collaboration.spec.ts` FAILS
 * it — `b: 1` against an expected `b: 10`, nine characters gone. Even a sliver
 * of divergence loses a burst under whole-value last-writer-wins, and that test
 * catches it.
 *
 * Holding frames buys determinism, not sensitivity. `holdCollabDocFrames` stops
 * BOTH pages receiving document frames for the length of the bursts, so the
 * size of the divergence is set by the test instead of by how fast the machine
 * happened to deliver a frame. Each test then asserts the divergence really
 * happened before asserting anything about the outcome — without that guard a
 * green cannot be told from two peers that quietly took turns.
 */

const PARAGRAPH = '[data-blok-component="paragraph"]';

/** A fresh room per test: the relay is keyed by doc id and lives in the browser. */
const newDoc = (): string => `same-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The paragraphs of one editor, in document order.
 * @param page - the page the editor is on
 * @param name - the editor's harness name
 */
const paragraphs = (page: Page, name: string): Locator => page.getByTestId(name).locator(PARAGRAPH);

/**
 * Text inside ONE editor, never anywhere else on the page.
 * @param page - the page the editor is on
 * @param name - the editor's harness name
 * @param text - the text to look for
 */
const textIn = (page: Page, name: string, text: string): Locator =>
  page.getByTestId(name).getByText(text);

/**
 * Opens a page and mounts one editor into the room.
 * @param page - the page to mount into
 * @param doc - the room
 * @param name - the editor's harness name
 * @param seedsEmptyRoom - whether this editor opens the room
 */
const open = async (page: Page, doc: string, name: string, seedsEmptyRoom: boolean): Promise<void> => {
  await gotoCollabPage(page);
  await mountCollabEditor(page, { doc,
    name,
    seedsEmptyRoom });
};

/**
 * Puts a real caret `offset` characters into one editor's first paragraph.
 * @param page - the page the editor is on
 * @param name - the editor's harness name
 * @param offset - how many characters in
 */
const putCaretAt = async (page: Page, name: string, offset: number): Promise<void> => {
  await paragraphs(page, name).nth(0).click();
  await page.keyboard.press('Home');

  for (let step = 0; step < offset; step += 1) {
    await page.keyboard.press('ArrowRight');
  }
};

/**
 * The saved text of one editor's first block, tags and all.
 * @param page - the page the editor is on
 * @param name - the editor's harness name
 */
const firstText = async (page: Page, name: string): Promise<string> =>
  (await savedBlocks(page, name))[0]?.text ?? '';

/** Saved text with every tag removed, so word counts can be read off it. */
const stripTags = (html: string): string => html.replace(/<[^>]*>/g, '');

/** Whether saved text carries a bold tag, whichever element the tool emitted. */
const hasBold = (html: string): boolean => /<(b|strong)[\s>]/.test(html);

/** How many times `needle` occurs in `haystack`. */
const countOf = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/**
 * Cuts both pages off from each other's document frames. Awareness keeps
 * flowing, so this is latency, not a disconnect.
 * @param pages - the pages to isolate
 */
const isolate = async (pages: Page[]): Promise<void> => {
  await Promise.all(pages.map((page) => holdCollabDocFrames(page)));
};

/**
 * Delivers everything both pages missed, in arrival order.
 * @param pages - the pages to reconnect
 */
const reunite = async (pages: Page[]): Promise<void> => {
  await Promise.all(pages.map((page) => releaseCollabDocFrames(page)));
};

/**
 * Types a burst into one editor's first paragraph, at the start or the end, and
 * reports what that editor was showing the instant the burst ended.
 *
 * The 30ms per-key delay is load-bearing: it spreads the burst over ~300ms so
 * the whole of it sits inside ONE 400ms coalescing window
 * (`modificationsObserverBatchTimeout`) and is published as a single write.
 * @param page - the page the editor is on
 * @param name - the editor's harness name
 * @param where - which end of the paragraph to type at
 * @param text - what to type
 */
const burstInto = async (
  page: Page,
  name: string,
  where: 'Home' | 'End',
  text: string
): Promise<string> => {
  await paragraphs(page, name).nth(0).click();
  await page.keyboard.press(where);
  await page.keyboard.type(text, { delay: 30 });

  return paragraphs(page, name).nth(0).innerText();
};

/**
 * Asserts the two editors really were apart while they wrote: neither had seen
 * any of the other's burst. Without this a passing test cannot be told from a
 * test whose peers quietly took turns.
 * @param seen - what each editor displayed when its own burst ended
 * @param peerMarks - the character each editor must NOT have seen from the other
 */
const expectApart = (seen: string[], peerMarks: [string, string]): void => {
  expect({ alphaSawPeer: countOf(seen[0] ?? '', peerMarks[0]),
    betaSawPeer: countOf(seen[1] ?? '', peerMarks[1]) })
    .toEqual({ alphaSawPeer: 0,
      betaSawPeer: 0 });
};

test.describe('two people writing in the same block', () => {
  /**
   * The two ends of one paragraph, at once, on documents that know nothing of
   * each other until both bursts are done.
   *
   * Counted rather than matched against a fixed string: which burst lands first
   * in the merged text is not a property anyone can pin, and asserting on it
   * would make the test flaky without testing anything more.
   */
  test('bursts at opposite ends of one paragraph both survive', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await burstInto(pageA, 'alpha', 'End', 'middle');

    await open(pageB, doc, 'beta', false);
    await expect(textIn(pageB, 'beta', 'middle')).toBeVisible();

    await isolate([pageA, pageB]);

    const seen = await Promise.all([
      burstInto(pageA, 'alpha', 'Home', 'AAAAAAAAAA'),
      burstInto(pageB, 'beta', 'End', 'BBBBBBBBBB'),
    ]);

    expectApart(seen, ['B', 'A']);

    await reunite([pageA, pageB]);

    // Nothing lost FIRST: a burst vanishing whole is the defect, and a
    // convergence check alone passes with both editors equally wrong.
    await expect
      .poll(async () => {
        const text = stripTags(await firstText(pageA, 'alpha'));

        return { a: countOf(text, 'A'),
          b: countOf(text, 'B'),
          middle: countOf(text, 'middle') };
      })
      .toEqual({ a: 10,
        b: 10,
        middle: 1 });

    await expect.poll(async () => firstText(pageB, 'beta')).toBe(await firstText(pageA, 'alpha'));
  });

  /**
   * Typing against formatting in one block. B wraps "quick brown" in bold while
   * A appends at the end, neither seeing the other.
   *
   * This is the case a single-region prefix/suffix diff gets wrong: bolding is
   * described as "delete the phrase, insert the tagged phrase", so the two
   * writes each delete what the other re-inserts and a word lands twice. The
   * assertion is therefore on word COUNTS in the plain text, not on the markup.
   */
  test('typing while the other person bolds an overlapping phrase duplicates nothing', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await burstInto(pageA, 'alpha', 'End', 'the quick brown fox');

    await open(pageB, doc, 'beta', false);
    await expect(textIn(pageB, 'beta', 'the quick brown fox')).toBeVisible();

    // B selects "quick brown" while both sides still agree; only the writes race.
    await putCaretAt(pageB, 'beta', 4);
    for (let step = 0; step < 11; step += 1) {
      await pageB.keyboard.press('Shift+ArrowRight');
    }

    await isolate([pageA, pageB]);

    const [alphaSaw] = await Promise.all([
      burstInto(pageA, 'alpha', 'End', ' jumped'),
      pageB.keyboard.press('ControlOrMeta+b'),
    ]);

    // Only alpha's side is checkable this way: bold adds no character for beta
    // to have-not-seen. Alpha typed, and alpha never saw beta's markup.
    expect({ typed: countOf(alphaSaw ?? '', 'jumped'),
      bold: hasBold(await firstText(pageA, 'alpha')) })
      .toEqual({ typed: 1,
        bold: false });

    await reunite([pageA, pageB]);

    // Every word exactly once FIRST: duplication and loss are the defect, and
    // both leave the two peers perfectly converged on a wrong document.
    await expect
      .poll(async () => {
        const text = stripTags(await firstText(pageA, 'alpha'));

        return ['the', 'quick', 'brown', 'fox', 'jumped'].map((word) => countOf(text, word));
      })
      .toEqual([1, 1, 1, 1, 1]);

    // Beta's formatting survived the merge at all — without this the test
    // passes on a document where the bold was simply dropped.
    await expect.poll(async () => hasBold(await firstText(pageA, 'alpha'))).toBe(true);

    await expect.poll(async () => firstText(pageB, 'beta')).toBe(await firstText(pageA, 'alpha'));
  });

  /**
   * An emoji typed while the other person edits next to it.
   *
   * An emoji is two UTF-16 units. A diff that walks code UNITS can put an edit
   * boundary between the halves, which lands them in separate CRDT items; yjs
   * then replaces both with U+FFFD, permanently, for the writer as well as the
   * peer. So the assertion is the absence of the replacement character, in both
   * pages — a text comparison alone would pass with both showing mojibake.
   */
  test('an emoji typed beside the other person\'s edit does not become U+FFFD', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await burstInto(pageA, 'alpha', 'End', 'party time');

    await open(pageB, doc, 'beta', false);
    await expect(textIn(pageB, 'beta', 'party time')).toBeVisible();

    await isolate([pageA, pageB]);

    const seen = await Promise.all([
      burstInto(pageA, 'alpha', 'End', ' 🎉🎈🎊'),
      burstInto(pageB, 'beta', 'Home', 'wowwowwow '),
    ]);

    expectApart(seen, ['w', '🎉']);

    await reunite([pageA, pageB]);

    // No mojibake FIRST, on both sides.
    await expect
      .poll(async () => {
        const [alpha, beta] = [await firstText(pageA, 'alpha'), await firstText(pageB, 'beta')];

        return { alphaBroken: countOf(alpha, '�'),
          betaBroken: countOf(beta, '�') };
      })
      .toEqual({ alphaBroken: 0,
        betaBroken: 0 });

    await expect
      .poll(async () => {
        const text = stripTags(await firstText(pageA, 'alpha'));

        return { emoji: countOf(text, '🎉🎈🎊'),
          wow: countOf(text, 'wowwowwow'),
          party: countOf(text, 'party time') };
      })
      .toEqual({ emoji: 1,
        wow: 1,
        party: 1 });

    await expect.poll(async () => firstText(pageB, 'beta')).toBe(await firstText(pageA, 'alpha'));
  });

  /**
   * Two people in ONE table cell.
   *
   * This looked like a guaranteed loss and is not, which is worth writing down:
   * only a TOP-LEVEL `text` key is stored as a `Y.Text` (`DIFFABLE_TEXT_KEYS`,
   * src/components/modules/yjs/serializer.ts), and a cell's content is nested
   * inside the table block's data. But what the cell nests is only a LIST OF
   * BLOCK IDS — `data.content[row][col].blocks` — and the text itself lives on
   * an ordinary paragraph block with its own top-level `text`. Verified by
   * reading the saved table back. So a cell merges per character like any other
   * paragraph, and what the two peers write concurrently is two different keys
   * of the same nested list, never one string.
   */
  test('two people typing in one table cell keep both of their words', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await pageA.evaluate(() => {
      window.__collabEditors?.alpha.blocks.insert('table', {}, undefined, undefined, false, false, 'grid');
    });

    const cellsA = pageA.getByTestId('alpha').getByRole('cell');

    await expect(cellsA).toHaveCount(9);
    await cellsA.nth(0).click();
    await pageA.keyboard.type('seed');

    await open(pageB, doc, 'beta', false);

    const cellsB = pageB.getByTestId('beta').getByRole('cell');

    await expect(cellsB).toHaveCount(9);
    await expect(cellsB.nth(0)).toHaveText('seed');

    const cellBurst = async (page: Page, cell: Locator, text: string): Promise<string> => {
      await cell.click();
      await page.keyboard.press('End');
      await page.keyboard.type(text, { delay: 30 });

      return cell.innerText();
    };

    await isolate([pageA, pageB]);

    const seen = await Promise.all([
      cellBurst(pageA, cellsA.nth(0), 'AAAAAAAAAA'),
      cellBurst(pageB, cellsB.nth(0), 'BBBBBBBBBB'),
    ]);

    expectApart(seen, ['B', 'A']);

    await reunite([pageA, pageB]);

    // Both bursts FIRST: a whole burst disappearing is the defect here, and
    // the two peers agreeing on the survivor is not a consolation.
    await expect
      .poll(async () => {
        const text = await cellsA.nth(0).innerText();

        return { a: countOf(text, 'A'),
          b: countOf(text, 'B') };
      })
      .toEqual({ a: 10,
        b: 10 });

    await expect.poll(async () => cellsB.nth(0).innerText()).toBe(await cellsA.nth(0).innerText());
  });

  /**
   * Typing into a block the other person is deleting.
   *
   * Either outcome is defensible — the block goes, or it stays with the typing
   * in it — but the two peers must not end up holding different documents, and
   * neither may be left with a block the other does not have. Convergence is
   * the property; which side wins is not.
   */
  test('typing into a block the other person deletes leaves both peers agreeing', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await seedDocument(pageA, 'alpha', [
      { id: 'keeper',
        data: { text: 'keeper' } },
      { id: 'doomed',
        data: { text: 'doomed' } },
    ]);

    await open(pageB, doc, 'beta', false);
    await expect(textIn(pageB, 'beta', 'doomed')).toBeVisible();

    await isolate([pageA, pageB]);

    const typeIntoDoomed = async (): Promise<void> => {
      const target = paragraphs(pageA, 'alpha').filter({ hasText: 'doomed' });

      await target.click();
      await pageA.keyboard.press('End');
      await pageA.keyboard.type('XXXXXXXXXX', { delay: 30 });
    };

    const deleteDoomed = async (): Promise<void> => {
      await pageB.evaluate(async () => {
        const editor = window.__collabEditors?.beta;
        const index = editor?.blocks.getBlockIndex('doomed') ?? -1;

        if (index >= 0) {
          await editor?.blocks.delete(index, false);
        }
      });
    };

    await Promise.all([typeIntoDoomed(), deleteDoomed()]);

    // Both really did act on a document that still held the block: alpha typed
    // into it, and beta found it to delete.
    expect(await paragraphs(pageA, 'alpha').filter({ hasText: 'doomedXXXXXXXXXX' }).count()).toBe(1);
    expect(await paragraphs(pageB, 'beta').filter({ hasText: 'doomed' }).count()).toBe(0);

    await reunite([pageA, pageB]);

    // Same document on both sides FIRST: a block that exists for one peer and
    // not the other is the corruption this guards, and it survives any number
    // of later edits.
    await expect
      .poll(async () => (await savedBlocks(pageB, 'beta')).map((block) => block.id))
      .toEqual((await savedBlocks(pageA, 'alpha')).map((block) => block.id));

    const converged = await savedBlocks(pageA, 'alpha');

    expect(await savedBlocks(pageB, 'beta')).toEqual(converged);

    // The floor under the convergence: two peers agreeing on a document that
    // lost the untouched block, or kept the typed-into block with the typing
    // stripped out of it, agree just as neatly as two correct ones.
    const keeper = converged.find((block) => block.id === 'keeper');

    expect(keeper?.text).toBe('keeper');

    // Which side wins is not the property; a surviving block that lost the
    // characters typed into it is. Either the block is gone, or it still
    // holds them — anything else lands in this list.
    expect(converged.filter((block) => block.id === 'doomed' && block.text !== 'doomedXXXXXXXXXX')).toEqual([]);
  });
});
