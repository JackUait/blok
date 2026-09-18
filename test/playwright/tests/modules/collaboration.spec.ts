import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  gotoCollabPage,
  holdCollabDocFrames,
  mountCollabEditor,
  pauseCollabInbound,
  releaseCollabDocFrames,
  savedBlocks,
  seedDocument,
  type SavedBlock,
} from '../helpers/collab';

/**
 * Two REAL Blok editors, each in its own page with its own DOM and its own
 * tools, converging against each other in a real browser.
 *
 * What already existed covered neither half of this: the server-conformance
 * tier runs real clients against the real C# server but in a node environment
 * with no editor mounted, and `sync-first-load.test.ts` mounts a real Core but
 * as a SINGLE jsdom client against a mock socket. The editor-side corruption
 * bugs — a root block landing inside a nested predecessor when a batch arrives,
 * a container re-seeding a child on replay, cell blocks collapsing into one
 * cell when a second client joins — are invisible to both.
 *
 * Transport: an in-page BroadcastChannel relay through the collaboration
 * module's `socketFactory` seam (test/playwright/tests/helpers/collab.ts). No
 * server, no .NET build, and the editors are genuinely independent — separate
 * pages, separate JS realms.
 */

const PARAGRAPH = '[data-blok-component="paragraph"]';

/** A fresh room per test: the relay is keyed by doc id and lives in the browser. */
const newDoc = (): string => `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The paragraphs of one editor, in document order.
 * @param page - the page the editor is on
 * @param name - the editor's harness name
 */
const paragraphs = (page: Page, name: string): Locator => page.getByTestId(name).locator(PARAGRAPH);

/**
 * Text inside ONE editor, not anywhere on the page: the harness can mount two
 * editors into a single page, and a page-wide `getByText` would then read the
 * peer's copy and pass with the editor under test still empty.
 * @param page - the page the editor is on
 * @param name - the editor's harness name
 * @param text - the text to look for
 */
const textIn = (page: Page, name: string, text: string): Locator =>
  page.getByTestId(name).getByText(text);

/**
 * Types into one block. The click alone lands the caret at the element CENTRE,
 * which is only past the last character while the text is short — `End` makes
 * "append" true at any length.
 * @param page - the page the editor is on
 * @param name - the editor's harness name
 * @param index - which paragraph to type into
 * @param text - what to type
 */
const typeInto = async (page: Page, name: string, index: number, text: string): Promise<void> => {
  const target = paragraphs(page, name).nth(index);

  await target.click();
  await page.keyboard.press('End');
  await page.keyboard.type(text);
};

/**
 * Opens a page and mounts one editor into the room.
 * @param page - the page to mount into
 * @param doc - the room
 * @param name - the editor's harness name
 * @param seedsEmptyRoom - whether this editor opens the room (answers its own first sync)
 */
const open = async (page: Page, doc: string, name: string, seedsEmptyRoom: boolean): Promise<void> => {
  await gotoCollabPage(page);
  await mountCollabEditor(page, { doc,
    name,
    seedsEmptyRoom });
};

/**
 * The live caret in one editor's first paragraph, read in the page.
 * @param page - the page the editor is on
 * @param name - the editor's harness name
 */
const readCaret = (page: Page, name: string): Promise<unknown> => page.evaluate((harness) => {
  const selection = document.getSelection();
  const block = document.querySelector(`[data-blok-testid="${harness}"] [data-blok-component="paragraph"]`);

  if (selection === null || selection.rangeCount === 0 || block === null) {
    return { rangeCount: selection?.rangeCount ?? 0,
      insideBlock: false,
      anchorNode: null,
      anchorText: null,
      offset: null,
      anchorAttached: false };
  }

  return {
    rangeCount: selection.rangeCount,
    insideBlock: block.contains(selection.anchorNode),
    anchorNode: selection.anchorNode?.nodeName ?? null,
    anchorText: selection.anchorNode?.textContent ?? null,
    offset: selection.anchorOffset,
    anchorAttached: selection.anchorNode?.isConnected ?? false,
  };
}, name);

/**
 * Puts a real caret `offset` characters into one editor's first paragraph, the
 * way a user would: click, Home, then step right.
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


/** What one editor drew for the only remote caret on its screen. */
interface DrawnCaret {
  /** The presence caret's own `left`, holder-relative, as the layer wrote it. */
  drawnLeft: number;
  /** Where `offset` characters into the live text actually sits, same origin. */
  expectedLeft: number;
  text: string;
}

/**
 * Reads the remote caret drawn on one editor's first paragraph and, in the same
 * pass, measures where `offset` characters into that paragraph's CURRENT text
 * would be. Both numbers are holder-relative, so they are directly comparable
 * and the caller asserts on the distance between them.
 * @param page - the page the editor is on
 * @param name - the editor's harness name
 * @param offset - the offset the peer's caret is really at, in the live text
 */
const drawnRemoteCaret = (page: Page, name: string, offset: number): Promise<DrawnCaret | null> =>
  page.evaluate(({ harness, at }) => {
    const holder = document.querySelector(`[data-blok-testid="${harness}"] [data-blok-element]`);
    const input = holder?.querySelector('[contenteditable="true"]') ?? null;
    const caret = holder?.querySelector<HTMLElement>('[data-blok-presence-caret]') ?? null;
    const textNode = input?.firstChild ?? null;

    if (holder === null || input === null || caret === null || textNode === null) {
      return null;
    }

    const range = document.createRange();

    range.setStart(textNode, at);
    range.collapse(true);

    return {
      drawnLeft: Math.round(parseFloat(caret.style.left)),
      expectedLeft: Math.round(range.getBoundingClientRect().left - holder.getBoundingClientRect().left),
      text: input.textContent ?? '',
    };
  }, { harness: name,
    at: offset });

test.describe('collaboration between two editors', () => {
  test('text typed on either side reaches the other', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await typeInto(pageA, 'alpha', 0, 'written by alpha');

    await open(pageB, doc, 'beta', false);
    await expect(textIn(pageB, 'beta', 'written by alpha')).toBeVisible();

    await typeInto(pageB, 'beta', 0, ' and by beta');
    await expect(textIn(pageA, 'alpha', 'written by alpha and by beta')).toBeVisible();

    // Spelled out, not only compared side to side: two editors that both saved
    // nothing would satisfy a bare `toEqual`.
    const alphaSaved = await savedBlocks(pageA, 'alpha');

    expect(alphaSaved.map((block) => block.text)).toEqual(['written by alpha and by beta']);
    expect(await savedBlocks(pageB, 'beta')).toEqual(alphaSaved);
  });

  test('a client that joins later renders the document already in the room', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await seedDocument(pageA, 'alpha', [
      { id: 'flat-one',
        data: { text: 'first' } },
      { id: 'flat-two',
        type: 'header',
        data: { text: 'second',
          level: 2 } },
      { id: 'flat-three',
        data: { text: 'third' } },
    ]);

    const alphaTree = await savedBlocks(pageA, 'alpha');

    await open(pageB, doc, 'beta', false);
    await expect(textIn(pageB, 'beta', 'third')).toBeVisible();

    const betaTree = await savedBlocks(pageB, 'beta');

    // Order and level FIRST: the defect this retires is a block arriving at the
    // wrong place in the batch, which a bare count would not see. The level
    // rides along because a peer materialising the header at another level is
    // the same class of bug and reads better here than in a whole-block diff.
    const shape = (tree: SavedBlock[]): unknown[] =>
      tree.map((block) => [block.id, block.type, block.parent, (block.data as { level?: number }).level]);

    expect(shape(betaTree)).toEqual(shape(alphaTree));
    expect(betaTree).toEqual(alphaTree);
  });

  test('a container keeps its children when a second client joins', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await seedDocument(pageA, 'alpha', [
      { id: 'above',
        data: { text: 'above the toggle' } },
      { id: 'box',
        type: 'toggle',
        data: { text: 'the toggle' } },
      { id: 'inside-one',
        data: { text: 'inside one' },
        parent: 'box' },
      { id: 'inside-two',
        data: { text: 'inside two' },
        parent: 'box' },
      { id: 'below',
        data: { text: 'below the toggle' } },
    ]);

    const alphaTree = await savedBlocks(pageA, 'alpha');

    await open(pageB, doc, 'beta', false);
    await expect(textIn(pageB, 'beta', 'below the toggle')).toBeVisible();

    const betaTree = await savedBlocks(pageB, 'beta');

    // Parentage FIRST: a container that re-seeds a child on replay, or children
    // that land at root level, is what this test exists for. A count alone
    // passes while the children hang off the wrong block.
    expect(betaTree.filter((block) => block.parent === 'box').map((block) => block.id))
      .toEqual(['inside-one', 'inside-two']);
    expect(betaTree.map((block) => block.id)).toEqual(alphaTree.map((block) => block.id));
    expect(betaTree).toEqual(alphaTree);
  });

  test('a container edited by one client updates in the other', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await seedDocument(pageA, 'alpha', [
      { id: 'box',
        type: 'toggle',
        data: { text: 'the toggle' } },
      { id: 'inside-one',
        data: { text: 'inside one' },
        parent: 'box' },
    ]);

    await open(pageB, doc, 'beta', false);
    await expect(textIn(pageB, 'beta', 'inside one')).toBeVisible();

    // A child added on B must arrive on A INSIDE the container, not beside it.
    await pageB.evaluate(() => {
      window.__collabEditors?.beta.blocks.getById('box')?.insertChild(
        { text: 'added by beta' },
        'end',
        'paragraph',
        { id: 'inside-three' }
      );
    });

    await expect(textIn(pageA, 'alpha', 'added by beta')).toBeVisible();

    const alphaTree = await savedBlocks(pageA, 'alpha');

    expect(alphaTree.filter((block) => block.parent === 'box').map((block) => block.id))
      .toEqual(['inside-one', 'inside-three']);
    expect(await savedBlocks(pageB, 'beta')).toEqual(alphaTree);
  });

  test('a reloaded client comes back to the document the room still holds', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await typeInto(pageA, 'alpha', 0, 'survives a reload');

    // B holds the room open across A's reload, exactly as a second tab would.
    await open(pageB, doc, 'beta', false);
    await expect(textIn(pageB, 'beta', 'survives a reload')).toBeVisible();

    const before = await savedBlocks(pageB, 'beta');

    // A comes back with an empty document and NO right to seed one: everything
    // it renders has to arrive from the room.
    await open(pageA, doc, 'alpha', false);

    await expect(textIn(pageA, 'alpha', 'survives a reload')).toBeVisible();
    expect(await savedBlocks(pageA, 'alpha')).toEqual(before);
  });

  test('table cell blocks stay in their own cells for a client that joins', async ({ context }) => {
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
    await pageA.keyboard.type('one-one');
    await cellsA.nth(5).click();
    await pageA.keyboard.type('two-three');

    await open(pageB, doc, 'beta', false);

    const cellsB = pageB.getByTestId('beta').getByRole('cell');

    await expect(cellsB).toHaveCount(9);

    // Per-cell placement FIRST: every cell block collapsing into cell (0,0) is
    // the documented failure this retires, and it leaves the block COUNT and
    // the parentage intact — only which cell holds which text changes.
    const placement = ['one-one', '', '', '', '', 'two-three', '', '', ''];

    await expect(cellsB).toHaveText(placement);
    await expect(cellsA).toHaveText(placement);
  });


  /**
   * KNOWN DEFECT, not a flake — `test.fixme` so it documents the bug without
   * reddening a release gate. Found by this harness.
   *
   * A callout seeds a default first child when it is created. The joining
   * client materialises that SAME child (same id, so it is replayed, not
   * re-created) but SAVES the container's children in a different order: the
   * author's `save()` reports [seeded, 'inside one'] and the peer's reports
   * ['inside one', seeded], and neither converges afterwards. Rendered text
   * order looked the same in both, so what diverges is the saved document —
   * a host persisting the peer's output would move the empty seeded paragraph
   * to the end of the callout. The toggle above, which seeds no child, is
   * identical on both sides, so this is about where a replayed container puts
   * a child it already had, not about nesting in general.
   *
   * The divergence is entirely editor-side. Yjs is a CRDT and both clients
   * apply the same updates, so the shared array cannot itself diverge — what
   * differs is the order a peer's block store gives a replayed container's
   * children when `save()` walks them.
   */
  test.fixme('a callout orders its children the same way on both clients', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await seedDocument(pageA, 'alpha', [
      { id: 'box',
        type: 'callout',
        data: {} },
      { id: 'inside-one',
        data: { text: 'inside one' },
        parent: 'box' },
    ]);

    const alphaTree = await savedBlocks(pageA, 'alpha');

    await open(pageB, doc, 'beta', false);
    await expect(textIn(pageB, 'beta', 'inside one')).toBeVisible();

    expect((await savedBlocks(pageB, 'beta')).map((block) => block.id))
      .toEqual(alphaTree.map((block) => block.id));
  });

  /**
   * Regression. A peer's edit to the block the local user is typing in used to
   * throw that user's caret to the start of the block: `handleYjsUpdate` hands
   * every remote update to `block.setData`, which rewrites the tool's content
   * wholesale and detaches the text node the selection anchored into.
   *
   * The caret is now read as a character offset before the rewrite and put
   * back after it, adjusted by what the peer's edit did to the text before it.
   * An update carrying data the block already holds is skipped entirely — it
   * used to fire for a peer changing only `textColor` and move the caret just
   * the same.
   */
  test('a peer editing the same paragraph leaves the local caret where it was', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await typeInto(pageA, 'alpha', 0, 'hello world');

    await open(pageB, doc, 'beta', false);
    await expect(textIn(pageB, 'beta', 'hello world')).toBeVisible();

    // A real caret, put where a user would put it: five characters in.
    await putCaretAt(pageA, 'alpha', 5);

    const before = await readCaret(pageA, 'alpha');

    expect(before).toEqual({ rangeCount: 1,
      insideBlock: true,
      anchorNode: '#text',
      anchorText: 'hello world',
      offset: 5,
      anchorAttached: true });

    // B edits the SAME paragraph.
    await typeInto(pageB, 'beta', 0, '!!!');
    await expect(textIn(pageA, 'alpha', 'hello world!!!')).toBeVisible();

    const after = await readCaret(pageA, 'alpha');

    expect(after).toEqual({ rangeCount: 1,
      insideBlock: true,
      anchorNode: '#text',
      anchorText: 'hello world!!!',
      offset: 5,
      anchorAttached: true });
  });

  /**
   * The other half of the offset rule, and the only branch a real browser was
   * not exercising: when the peer types BEFORE the local caret, keeping the
   * number would leave the caret a word behind — it has to move by what the
   * peer inserted.
   */
  test('a peer typing before the local caret pushes it along', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await typeInto(pageA, 'alpha', 0, 'hello world');

    await open(pageB, doc, 'beta', false);
    await expect(textIn(pageB, 'beta', 'hello world')).toBeVisible();

    await putCaretAt(pageA, 'alpha', 5);

    // B types at the very START of the same paragraph.
    await putCaretAt(pageB, 'beta', 0);
    await pageB.keyboard.type('say ');
    await expect(textIn(pageA, 'alpha', 'say hello world')).toBeVisible();

    expect(await readCaret(pageA, 'alpha')).toEqual({ rangeCount: 1,
      insideBlock: true,
      anchorNode: '#text',
      anchorText: 'say hello world',
      offset: 9,
      anchorAttached: true });
  });

  /**
   * `api.blocks.insertMany` ADDS its batch to the document (`yjsSync: 'add'`).
   * The default 'replace' hands `YjsManager.fromJSON` only the batch, and
   * `fromJSON` replaces the whole document — while the in-memory store merely
   * appends, so the author's own screen (and `save()`) still looked right while
   * every other block was gone from the doc, from every peer and from the
   * author's next reload.
   */

  /**
   * The user's report: "when I type fast, the other user's caret drifts away
   * and then comes back to its position with a delay".
   *
   * A peer publishes a plain character offset. Local typing in the same block
   * reflows the line under it, and the re-measure that rides the local caret
   * re-measures the SAME offset — which is now that many characters too far
   * left. The correction costs a round trip, which is the lag on screen.
   *
   * Beta is cut off inbound before alpha types, so beta never learns of the
   * edit and never republishes. That freezes the window the user sees as a
   * flicker into a state the test can assert on without racing it.
   */
  test('a peer caret keeps its place while the local user types in front of it', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await typeInto(pageA, 'alpha', 0, 'hello world Title');

    await open(pageB, doc, 'beta', false);
    await expect(textIn(pageB, 'beta', 'hello world Title')).toBeVisible();

    // Beta parks just before "Title" — 12 characters in. `putCaretAt` steps
    // right one key at a time and each step publishes through the 100ms
    // throttle, so the gate has to be the position itself: waiting for a caret
    // to merely EXIST resolves on the first intermediate offset.
    await putCaretAt(pageB, 'beta', 12);
    await expect
      .poll(async () => {
        const parked = await drawnRemoteCaret(pageA, 'alpha', 12);

        return parked === null ? null : parked.drawnLeft - parked.expectedLeft;
      })
      .toBeCloseTo(0, 0);

    await pauseCollabInbound(pageB);

    // Alpha types ten characters at the very start of the same paragraph.
    await putCaretAt(pageA, 'alpha', 0);
    await pageA.keyboard.type('asdasdasda');
    await expect(textIn(pageA, 'alpha', 'asdasdasdahello world Title')).toBeVisible();

    // Beta has not moved, so their caret is still before "Title" — now 22
    // characters into alpha's text.
    await expect
      .poll(async () => {
        const drawn = await drawnRemoteCaret(pageA, 'alpha', 22);

        return drawn === null ? null : drawn.drawnLeft - drawn.expectedLeft;
      })
      .toBeCloseTo(0, 0);
  });


  /**
   * The other half of the same problem, and the direction that made the first
   * fix WORSE than no fix at all.
   *
   * The two channels do not run in step: carets publish on a 100ms throttle
   * while block data is coalesced on the 400ms mutation window, so for most of
   * every window a peer's published offset counts into text this editor has
   * not received. When that text finally lands it is a change this editor did
   * not author — and shifting the peer's offset by it counts their own typing
   * a second time, on top of the shift their publish already included.
   *
   * Here the skew is made total: beta's document frames are held while its
   * awareness keeps arriving, then released in one go.
   */
  test('a peer caret is not shifted by the peer\'s own edit arriving late', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await typeInto(pageA, 'alpha', 0, 'hello world Title');

    await open(pageB, doc, 'beta', false);
    await expect(textIn(pageB, 'beta', 'hello world Title')).toBeVisible();

    await holdCollabDocFrames(pageA);

    // Beta types two characters at the very start. Their caret reaches alpha
    // immediately; their text is held back.
    await putCaretAt(pageB, 'beta', 0);
    await pageB.keyboard.type('XY');
    await expect
      .poll(async () => {
        const drawn = await drawnRemoteCaret(pageA, 'alpha', 2);

        return drawn === null ? null : drawn.drawnLeft - drawn.expectedLeft;
      })
      .toBeCloseTo(0, 0);

    await releaseCollabDocFrames(pageA);
    await expect(textIn(pageA, 'alpha', 'XYhello world Title')).toBeVisible();

    // Alpha clicks its own block, which is what drives a re-measure pass.
    await paragraphs(pageA, 'alpha').nth(0).click();

    // Beta has not moved and has not republished: they are still two
    // characters in, and those two characters are their own.
    await expect
      .poll(async () => {
        const drawn = await drawnRemoteCaret(pageA, 'alpha', 2);

        return drawn === null ? null : drawn.drawnLeft - drawn.expectedLeft;
      })
      .toBeCloseTo(0, 0);
  });

  test('a bulk insert keeps the blocks already in the document', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await typeInto(pageA, 'alpha', 0, 'keep me');

    await open(pageB, doc, 'beta', false);
    await expect(textIn(pageB, 'beta', 'keep me')).toBeVisible();

    await pageA.evaluate(() => {
      window.__collabEditors?.alpha.blocks.insertMany([
        { id: 'bulk-one',
          type: 'paragraph',
          data: { text: 'bulk one' } },
      ] as never);
    });

    await expect(textIn(pageB, 'beta', 'bulk one')).toBeVisible();
    await expect(textIn(pageB, 'beta', 'keep me')).toBeVisible();

    expect((await savedBlocks(pageB, 'beta')).map((block) => block.text))
      .toEqual(['keep me', 'bulk one']);
  });

  /**
   * Two people typing into ONE paragraph at the same instant. Their saves land
   * in the same 400ms coalescing window (`modificationsObserverBatchTimeout`),
   * which is the only interval in which their writes can collide — with a
   * larger gap between them nothing was ever lost. Block text is stored as a
   * Y.Text and each save is applied as a diff, so both bursts survive; written
   * whole, the later save took the paragraph and the other person watched
   * their own characters disappear.
   */
  test('two people typing in one paragraph keep both of their words', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);
    await typeInto(pageA, 'alpha', 0, 'seed ');

    await open(pageB, doc, 'beta', false);
    await expect(textIn(pageB, 'beta', 'seed')).toBeVisible();

    const burst = async (page: Page, name: string, char: string): Promise<void> => {
      const target = paragraphs(page, name).nth(0);

      await target.click();
      await page.keyboard.press('End');
      // Spread over ~300ms so the two bursts genuinely overlap inside one
      // coalescing window rather than landing in consecutive ones.
      await page.keyboard.type(char.repeat(10), { delay: 30 });
    };

    await Promise.all([burst(pageA, 'alpha', 'A'), burst(pageB, 'beta', 'B')]);

    // Both peers converge, and neither burst is missing a character. Counted,
    // not compared to a fixed string: the two bursts interleave in an order
    // the test cannot pin, and only the counts are the property under test.
    await expect
      .poll(async () => {
        const text = (await savedBlocks(pageA, 'alpha'))[0]?.text ?? '';

        return { a: (text.match(/A/g) ?? []).length,
          b: (text.match(/B/g) ?? []).length };
      })
      .toEqual({ a: 10,
        b: 10 });

    const alphaSaved = await savedBlocks(pageA, 'alpha');

    await expect.poll(async () => (await savedBlocks(pageB, 'beta'))[0]?.text)
      .toBe(alphaSaved[0]?.text);
  });
});
