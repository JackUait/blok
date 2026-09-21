import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  gotoCollabPage,
  holdCollabDocFrames,
  mountCollabEditor,
  releaseCollabDocFrames,
  savedBlocks,
} from '../helpers/collab';

/**
 * Real-Chromium checks for two data-loss claims that were only ever proved in
 * jsdom. Nothing here fixes anything: each test records what a real browser,
 * with real keystrokes, actually does.
 *
 * Claim 1 — `ModificationsObserver.disable()` disconnects the MutationObserver
 * without draining `takeRecords()`, so a record queued by a keystroke is
 * discarded when a host takes the DOM mutex in the same task, and the typed
 * character never reaches the CRDT.
 *
 * Claim 2 — the text diff atomizes to code points, so an edit boundary can
 * land inside a grapheme cluster and two peers merge into a character neither
 * typed.
 */

declare global {
  interface Window {
    /** What the read-only mutex test observed, in order. */
    __mutexLog?: string[];
    /** Records a mirror observer received across the editor's own mutex. */
    __mirrorRecords?: string[];
  }
}

const PARAGRAPH = '[data-blok-component="paragraph"]';

/** A fresh room per test: the relay is keyed by doc id and lives in the browser. */
const newDoc = (): string => `loss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The paragraphs of one editor, in document order.
 * @param page - the page the editor is on
 * @param name - the editor's harness name
 */
const paragraphs = (page: Page, name: string): Locator => page.getByTestId(name).locator(PARAGRAPH);

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
 * The saved text of one editor's first block, tags stripped.
 * @param page - the page the editor is on
 * @param name - the editor's harness name
 */
const firstText = async (page: Page, name: string): Promise<string> =>
  ((await savedBlocks(page, name))[0]?.text ?? '').replace(/<[^>]*>/g, '');

/**
 * Waits `ms` inside the page. A fixed wait, deliberately: these tests are
 * waiting for everything to settle so they can look at what did NOT arrive,
 * and there is no condition to poll for the absence of a character.
 * @param page - the page to wait on
 * @param ms - how long to wait
 */
const settle = (page: Page, ms: number): Promise<void> =>
  page.evaluate((delay: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, delay);
  }), ms);

/**
 * Every code point of a string as hex, so an assertion failure names the
 * character instead of showing two flags that look alike.
 * @param text - the string to describe
 */
const codePoints = (text: string): string[] =>
  [ ...text ].map((character) => character.codePointAt(0)?.toString(16) ?? '');

test.describe('claim 1: a queued MutationRecord dies with the DOM mutex', () => {
  /**
   * The browser primitive the claim rests on: a record queued and then
   * disconnected in the same synchronous run is never delivered. True — the
   * claim's mechanism is real in isolation.
   */
  test('Chromium discards records queued before disconnect()', async ({ page }) => {
    await gotoCollabPage(page);

    const observed = await page.evaluate(async () => {
      const host = document.createElement('div');

      document.body.appendChild(host);

      const seen: number[] = [];
      const observer = new MutationObserver((records) => {
        seen.push(records.length);
      });

      observer.observe(host, { childList: true,
        subtree: true,
        characterData: true });

      host.appendChild(document.createTextNode('queued'));

      // Same task as the mutation, exactly as `disable()` runs inside an input
      // handler: the record is on the queue and has not been delivered yet.
      observer.disconnect();
      observer.observe(host, { childList: true,
        subtree: true,
        characterData: true });

      await new Promise((resolve) => setTimeout(resolve, 50));

      observer.disconnect();
      host.remove();

      return seen;
    });

    expect(observed).toEqual([]);
  });

  /**
   * WHEN a real keystroke's MutationRecord is delivered, relative to the
   * `input` event a host would hook. jsdom has no editing pipeline, so the
   * ordering the claim depends on can only be established here.
   */
  test('a real keystroke delivers its MutationRecord after the input event', async ({ page }) => {
    await gotoCollabPage(page);

    await page.evaluate(() => {
      const host = document.createElement('div');

      host.setAttribute('contenteditable', 'true');
      host.textContent = 'ab';
      document.body.appendChild(host);

      const seen: string[] = [];

      window.__mutexLog = seen;

      new MutationObserver(() => seen.push('mutation')).observe(host, { childList: true,
        subtree: true,
        characterData: true });

      host.addEventListener('beforeinput', () => seen.push('beforeinput'));
      host.addEventListener('input', () => seen.push('input'));
    });

    await page.locator('[contenteditable="true"]').last().click();
    await page.keyboard.press('End');
    await page.keyboard.type('Z');
    await settle(page, 200);

    const seen = await page.evaluate(() => window.__mutexLog ?? []);

    // The host's `input` handler runs BEFORE the record is delivered, so a
    // mutex taken there really is taken while the record is still queued.
    expect(seen).toEqual([ 'beforeinput', 'input', 'mutation' ]);
  });

  /**
   * One person typing, no peer racing them. The host freezes the document from
   * its own `input` handler — an autosave lock, a permission flip — in the same
   * task as the keystroke, which is when the record is still on the queue.
   *
   * MEASURED, and it refutes the claim: a mirror observer running the same
   * disconnect/reconnect against the same redactor node still receives the
   * keystroke's `characterData` record, and receives it BEFORE the host
   * handler runs. In a live Blok editor the record is already delivered by the
   * time any host code — even a `document` capture listener — can take the
   * mutex, so the mutex has nothing left to discard.
   *
   * A bare contenteditable behaves differently, which is why this has to be
   * measured in the editor: with the mutex-taker as the ONLY input listener,
   * the record IS discarded. One unrelated listener ahead of it is enough to
   * flush the queue at the microtask checkpoint after that listener returns.
   */
  test('the keystroke record is delivered before any host handler can take the mutex', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);

    await paragraphs(pageA, 'alpha').nth(0).click();
    await pageA.keyboard.press('End');
    await pageA.keyboard.type('hello', { delay: 30 });

    await open(pageB, doc, 'beta', false);

    // The pipeline works before any mutex is involved: without this, a peer
    // that never syncs at all would look like a lost character.
    await expect.poll(async () => firstText(pageB, 'beta')).toBe('hello');

    await pageA.evaluate(() => {
      const editor = window.__collabEditors?.alpha;
      const holder = document.getElementById('alpha');
      const redactor = holder?.querySelector('[data-blok-redactor]') ?? holder;

      if (editor === undefined || holder === null || redactor === null) {
        throw new Error('alpha is not mounted');
      }

      const log: string[] = [];
      const mirrored: string[] = [];

      window.__mutexLog = log;
      window.__mirrorRecords = mirrored;

      // Same node, same options, same disconnect/reconnect pair the module
      // runs — so whatever happens to ITS record happened to the real one.
      const describe = (record: MutationRecord): string =>
        record.type === 'characterData'
          ? `characterData old=${JSON.stringify(record.oldValue)} now=${JSON.stringify(record.target.nodeValue)}`
          : `${record.type}(${record.attributeName ?? ''})`;

      const mirror = new MutationObserver((records) => {
        mirrored.push(...records.map(describe));
      });

      mirror.observe(redactor, { childList: true,
        subtree: true,
        characterData: true,
        characterDataOldValue: true,
        attributes: true });

      let taken = false;

      // `document` in CAPTURE: the earliest a host can possibly see the event,
      // before any listener Blok itself installs.
      document.addEventListener('input', () => {
        if (taken) {
          return;
        }
        taken = true;
        log.push('input handler ran');
        mirrored.push('--- input handler ran ---');

        mirror.disconnect();
        mirror.observe(redactor, { childList: true,
          subtree: true,
          characterData: true,
          characterDataOldValue: true,
          attributes: true });

        void editor.readOnly.toggle(true).then(() => log.push('read-only on'));
      }, true);
    });

    await pageA.keyboard.type('X');
    await settle(pageA, 1500);

    const state = await pageA.evaluate(() => ({
      log: window.__mutexLog ?? [],
      mirrored: window.__mirrorRecords ?? [],
      readOnly: window.__collabEditors?.alpha?.readOnly.isEnabled ?? null,
    }));

    const betaWhileFrozen = await firstText(pageB, 'beta');

    console.log('MUTEX log=%j mirrored=%j readOnly=%s beta=%j',
      state.log, state.mirrored, state.readOnly, betaWhileFrozen);

    const keystrokeRecord = state.mirrored.findIndex((entry) => entry.startsWith('characterData'));
    const hostHandler = state.mirrored.indexOf('--- input handler ran ---');

    // The mutex is never taken in time: the record is already delivered when
    // the earliest possible host handler runs.
    expect({ keystrokeRecordDelivered: keystrokeRecord >= 0,
      deliveredBeforeHostHandler: keystrokeRecord >= 0 && keystrokeRecord < hostHandler,
      readOnly: state.readOnly })
      .toEqual({ keystrokeRecordDelivered: true,
        deliveredBeforeHostHandler: true,
        readOnly: true });

    // And the character reaches the peer anyway. Alpha is read to off the DOM:
    // a read-only editor refuses to save.
    expect({ alpha: await paragraphs(pageA, 'alpha').nth(0).innerText(),
      beta: betaWhileFrozen })
      .toEqual({ alpha: 'helloX',
        beta: 'helloX' });
  });
});

test.describe('claim 2: the diff splits grapheme clusters', () => {
  /**
   * Two people replace the same flag. A flag is two regional indicators, and
   * the claim is that a minimal code-point diff touches only the indicator the
   * other peer left alone, welding 🇺🇦 and 🇬🇸 into 🇬🇦.
   *
   * MEASURED, 5 runs, no space in the way to widen the edit region: the weld
   * does NOT happen. Each peer's Backspace-and-retype is carried as a whole
   * two-indicator replacement, so the merge keeps BOTH flags side by side
   * (`go🇺🇦🇬🇸`, order varying). Wrong, and nothing either person typed, but
   * not a phantom character.
   */
  test('two people replacing the same flag', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);

    await paragraphs(pageA, 'alpha').nth(0).click();
    await pageA.keyboard.press('End');
    await pageA.keyboard.type('go🇺🇸');

    await open(pageB, doc, 'beta', false);
    await expect.poll(async () => firstText(pageB, 'beta')).toBe('go🇺🇸');

    await Promise.all([ holdCollabDocFrames(pageA), holdCollabDocFrames(pageB) ]);

    /**
     * Backspace over a flag removes the whole cluster in Chromium, so this is
     * the replacement a person performs — not a hand-built string.
     * @param page - the page to edit on
     * @param name - the editor's harness name
     * @param flag - the flag to type in its place
     */
    const replaceFlag = async (page: Page, name: string, flag: string): Promise<string> => {
      await paragraphs(page, name).nth(0).click();
      await page.keyboard.press('End');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(flag);

      return paragraphs(page, name).nth(0).innerText();
    };

    const seen = await Promise.all([
      replaceFlag(pageA, 'alpha', '🇺🇦'),
      replaceFlag(pageB, 'beta', '🇬🇸'),
    ]);

    // Neither saw the other's flag while it typed its own.
    expect({ alphaSawBeta: (seen[0] ?? '').includes('🇬🇸'),
      betaSawAlpha: (seen[1] ?? '').includes('🇺🇦') })
      .toEqual({ alphaSawBeta: false,
        betaSawAlpha: false });

    const apart = { alpha: await firstText(pageA, 'alpha'),
      beta: await firstText(pageB, 'beta') };

    await Promise.all([ releaseCollabDocFrames(pageA), releaseCollabDocFrames(pageB) ]);
    await settle(pageA, 1500);

    const merged = await firstText(pageA, 'alpha');

    console.log('MERGED-FLAG apartAlpha=%j apartBeta=%j merged=%j codepoints=%j peerAgrees=%s',
      codePoints(apart.alpha), codePoints(apart.beta), merged, codePoints(merged),
      await firstText(pageB, 'beta') === merged);

    // The Gabon case the claim names: one indicator from each peer, welded.
    expect(merged).not.toContain('🇬🇦');
  });

  /**
   * A combining accent against a character typed at the same spot. The accent
   * is its own code point and its own atom, so nothing ties it to the letter
   * it was typed against.
   *
   * PINNED DEFECT, and it is intermittent by nature: which of the two
   * same-position inserts wins is decided by Yjs client id, so it reproduces
   * on some runs and not others (measured: 3 of 8). When it does, the merge is
   * `cafe!` with the acute on the `!` — the `e` loses its accent and a
   * character neither person typed appears.
   */
  // Parked, not disarmed: the defect is real (confirmed in this browser) but
  // which insert wins is a Yjs client-id coin flip, so armed it flakes the
  // gate. The deterministic pin lives in
  // test/unit/components/modules/yjs/concurrent-text-diff-loss.test.ts.
  test.fixme('a combining accent typed while the peer appends', async ({ context }) => {
    const doc = newDoc();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    await open(pageA, doc, 'alpha', true);

    await paragraphs(pageA, 'alpha').nth(0).click();
    await pageA.keyboard.press('End');
    await pageA.keyboard.type('cafe', { delay: 30 });

    await open(pageB, doc, 'beta', false);
    await expect.poll(async () => firstText(pageB, 'beta')).toBe('cafe');

    await Promise.all([ holdCollabDocFrames(pageA), holdCollabDocFrames(pageB) ]);

    await paragraphs(pageA, 'alpha').nth(0).click();
    await pageA.keyboard.press('End');
    await pageA.keyboard.type('́');

    await paragraphs(pageB, 'beta').nth(0).click();
    await pageB.keyboard.press('End');
    await pageB.keyboard.type('!');

    await Promise.all([ releaseCollabDocFrames(pageA), releaseCollabDocFrames(pageB) ]);
    await settle(pageA, 1500);

    const merged = await firstText(pageA, 'alpha');

    console.log('MERGED-ACCENT merged=%j codepoints=%j', merged, codePoints(merged));

    // Decomposed: the editor stores what was typed, so the accent must still
    // sit on the `e` it was typed against.
    expect(merged).toContain('é');
  });
});
