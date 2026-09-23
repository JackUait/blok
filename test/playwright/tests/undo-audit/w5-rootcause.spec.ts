/**
 * Undo/redo audit wave 5 (W5R): root causes of wave-4 defects whose losing write was not named.
 *
 * Each test instruments the live editor (Yjs doc observer, wrapped BlockManager / BlockYjsSync /
 * UndoHistory methods) and, when W5R_OUT is set, writes its trace there as JSON.
 * The in-page probes are plain JS source strings: they poke private editor internals, which have no types.
 * Line numbers in comments are from `git show HEAD:<file>` at 868a3ae9.
 */
import * as fs from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { test as isolatedTest } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const UNDO = `${MOD}+z`;
const REDO = `${MOD}+Shift+z`;
const GAP = 700;
const SAVE_SETTLE = 1500;
const OUT = process.env.W5R_OUT ?? '';

interface LogEntry {
  k: string;
  t?: number;
  path?: string;
  d?: string;
  origin?: string;
}

declare global {
  interface Window {
    blokInstance?: Blok;
    defaultBlockTools: Record<string, { class: unknown }>;
    __log?: LogEntry[];
    __w4n?: { renders: number; saves: number; ready: boolean; last?: OutputData };
  }
}

const dump = (name: string, data: unknown): void => {
  if (OUT !== '') {
    fs.writeFileSync(`${OUT}/w5r-${name}.json`, JSON.stringify(data, null, 1));
  }
};

/** Run a JS function source in the page with one JSON argument. */
const run = <T>(page: Page, source: string, arg: unknown = null): Promise<T> =>
  page.evaluate<T>(`(${source})(${JSON.stringify(arg)})`);

const mark = (page: Page, label: string): Promise<void> => run(page, 'function (l) { window.__push({ k: l }); }', `=== ${label}`);

const gap = (page: Page, ms = GAP): Promise<void> => page.evaluate((t) => new Promise<void>((r) => {
  window.setTimeout(r, t);
}), ms);

const mount = async (page: Page, blocks: OutputData['blocks'], withTools = true): Promise<void> => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ list, tools }) => {
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    document.body.appendChild(holder);
    const blok = new window.Blok({ holder: 'blok', ...(tools ? { tools: window.defaultBlockTools } : {}), data: { blocks: list } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { list: blocks, tools: withTools });
};

/*
 * Tracing on window.blokInstance; everything goes to window.__log.
 * Wrapped by instance property, so only calls made through `this.x(...)` are seen
 * (BlockManager.blockDidMutated is pre-bound in the event binder and cannot be wrapped).
 */
const INSTRUMENT = String.raw`function (watchId) {
  const w = window;
  const b = w.blokInstance;
  const ym = b.module.yjsManager;
  const bm = b.module.blockManager;
  const sync = bm.yjsSync;
  const uh = ym.undoHistory;
  const ds = ym.documentStore;
  const um = uh.undoManager;
  const log = [];
  w.__log = log;
  const t0 = performance.now();
  const st = () => (new Error().stack || '').split('\n').slice(2, 16).map((s) => s.trim().replace(/https?:\/\/localhost:4444/g, '')).join(' | ');
  const caret = () => {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return 'none';
    const r = sel.getRangeAt(0);
    const el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    const host = el && el.closest('[contenteditable="true"]');
    const holder = el && el.closest('[data-blok-id]');
    if (!host || !holder) return 'off';
    const pre = document.createRange();
    pre.selectNodeContents(host);
    pre.setEnd(r.startContainer, r.startOffset);
    return holder.getAttribute('data-blok-id') + '@' + pre.toString().length;
  };
  const S = (v, depth = 0) => {
    if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.length > 160 ? v.slice(0, 160) + '…' : v;
    if (typeof v === 'function') return 'fn';
    if (v instanceof Node) return '<' + v.nodeName + '>';
    if (typeof v === 'object' && 'id' in v && 'name' in v && 'holder' in v) return 'block:' + v.id;
    if (depth > 2) return '…';
    if (Array.isArray(v)) return v.slice(0, 8).map((x) => S(x, depth + 1));
    try {
      const o = {};
      Object.keys(v).slice(0, 12).forEach((k) => { o[k] = S(v[k], depth + 1); });
      return o;
    } catch (e) { return String(v); }
  };
  const syncState = () => 'sc=' + sync.yjsSyncCount + ' un=' + sync.unscopedSyncCount + ' aod=' + sync.activeOperationDepth + ' rb=[' + [...sync.reconcilingBlocks.keys()].join(',') + ']';
  const push = (e) => log.push(Object.assign({ t: Math.round(performance.now() - t0), c: caret() }, e));
  const originName = (o) => {
    if (o === um) return 'UNDO_MANAGER';
    if (o === null || o === undefined) return String(o);
    if (typeof o === 'object') return 'obj:' + (o.constructor && o.constructor.name) + ':' + JSON.stringify(S(o)).slice(0, 80);
    return String(o);
  };
  w.__push = push;
  w.__st = st;
  w.__S = S;
  ds.yBlocksMap.observeDeep((events, tr) => {
    for (const ev of events) {
      let d = '';
      try { if (ev.keys && ev.keys.size > 0) d += 'keys:' + JSON.stringify([...ev.keys].map(([k, v]) => [k, v.action])); } catch (e) {}
      try { const delta = ev.delta; if (Array.isArray(delta) && delta.length > 0) d += ' delta:' + JSON.stringify(S(delta)); } catch (e) {}
      const text = ev.target && ev.target.constructor && ev.target.constructor.name !== 'YMap' ? String(ev.target.toString()).slice(0, 80) : '';
      push({ k: 'Y', path: ev.path.join('/'), d, text, origin: originName(tr.origin), stack: st() });
    }
  });
  const wrap = (obj, name, label, extra) => {
    const orig = obj && obj[name];
    if (typeof orig !== 'function') { push({ k: 'NOWRAP', label }); return; }
    obj[name] = function (...args) {
      push(Object.assign({ k: label, a: S(args), s: syncState(), stack: st() }, extra ? extra(args) : {}));
      const r = orig.apply(this, args);
      if (r && typeof r.then === 'function') {
        r.then((v) => push({ k: label + ':resolved', v: S(v), s: syncState() }), (e) => push({ k: label + ':rejected', v: String(e) }));
      }
      return r;
    };
  };
  wrap(bm, 'syncBlockDataToYjs', 'bm.syncBlockDataToYjs');
  wrap(bm, 'saveAndEnqueueBlockDataWrite', 'bm.saveAndEnqueue');
  wrap(sync, 'noteSuppressedMutation', 'sync.noteSuppressedMutation', (a) => ({
    typed: sync.userTypedWhileReconciling.has(a[0] && a[0].id),
    rewritten: sync.rewrittenFromDocument.has(a[0] && a[0].id),
  }));
  wrap(sync, 'drainSuppressedMutations', 'sync.drain', () => ({ sup: [...sync.suppressedMutations], def: [...sync.deferredMutations] }));
  wrap(sync, 'withAtomicOperation', 'sync.atomic');
  wrap(sync, 'withAtomicOperationAsync', 'sync.atomicAsync');
  wrap(sync, 'replayUnlessItIsTheRewrite', 'sync.replayUnlessRewrite');
  wrap(ym, 'enqueueBlockDataWrite', 'ym.enqueue');
  wrap(ym, 'updateBlockData', 'ym.updateBlockData');
  wrap(ym, 'stopCapturing', 'ym.stopCapturing');
  wrap(uh, 'stopCapturing', 'uh.stopCapturing');
  wrap(uh, 'markBoundary', 'uh.markBoundary');
  wrap(uh, 'markCaretBeforeChange', 'uh.markBefore', (a) => ({ force: a[0], hadPending: uh.hasPendingCaret, pending: S(uh.pendingCaretBefore) }));
  wrap(uh, 'pushCaretAndRestore', 'uh.pushCaretAndRestore');
  wrap(uh, 'restoreCaretSnapshot', 'uh.restoreCaret');
  wrap(uh, 'undo', 'uh.undo');
  wrap(uh, 'redo', 'uh.redo');
  um.on('stack-item-added', (e) => push({ k: 'um.added', type: e.type, performing: uh.isPerformingUndoRedo, pending: S(uh.pendingCaretBefore), top: S(uh.caretUndoStack.at(-1)) }));
  um.on('stack-item-updated', (e) => push({ k: 'um.updated', type: e.type, pending: S(uh.pendingCaretBefore) }));
  um.on('stack-item-popped', (e) => push({ k: 'um.popped', type: e.type }));
  if (watchId !== null) {
    const yb = ym.getBlockById(watchId);
    push({ k: 'watch', text: yb && String(yb.get('data').get('text')) });
  }
}`;

const instrument = (page: Page, watchId: string | null = null): Promise<void> => run(page, INSTRUMENT, watchId);

const readLog = (page: Page): Promise<LogEntry[]> => page.evaluate(() => window.__log ?? []);

const docText = (page: Page, id: string): Promise<string | undefined> => run(page, `function (i) {
  const yb = window.blokInstance.module.yjsManager.getBlockById(i);
  const text = yb && yb.get('data') && yb.get('data').get('text');
  return text === undefined || text === null ? undefined : text.toString();
}`, id);

const savedText = (page: Page): Promise<string[]> => page.evaluate(async () => {
  const out = await window.blokInstance?.save();

  return (out?.blocks ?? []).map((b) => `${b.id}:${(b.data as { text?: string }).text ?? ''}`);
});

const editable = (page: Page, id: string): Locator => page.locator(`[data-blok-id="${id}"] [contenteditable="true"]`).first();

const paste = (page: Page, payload: Record<string, string>): Promise<void> => page.evaluate((data) => {
  const transfer = new DataTransfer();

  for (const [format, value] of Object.entries(data)) {
    transfer.setData(format, value);
  }
  (document.activeElement ?? document.body).dispatchEvent(
    new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
  );
}, payload);

const caretAfterFifthChar = async (page: Page, id: string): Promise<void> => {
  await editable(page, id).click();
  await page.keyboard.press('Home');
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('ArrowRight');
  }
};

/* A second editor fed by the first editor's Yjs updates; wraps block "a"'s save() to log what it returns. */
const PEER_SETUP = String.raw`async function () {
  const w = window;
  const h = document.createElement('div');
  h.id = 'blok2';
  document.body.appendChild(h);
  const b2 = new w.Blok({ holder: 'blok2', tools: w.defaultBlockTools, data: { blocks: [] } });
  await b2.isReady;
  w.__b2 = b2;
  const ym1 = w.blokInstance.module.yjsManager;
  const ym2 = b2.module.yjsManager;
  ym2.applyRemoteUpdate(ym1.encodeStateAsUpdate(), 'peer');
  ym1.onDocUpdate((u) => ym2.applyRemoteUpdate(u, 'peer'));
  const blockA = w.blokInstance.module.blockManager.blocks.find((x) => x.id === 'a');
  const origSave = blockA.save.bind(blockA);
  blockA.save = async (...args) => {
    const r = await origSave(...args);
    w.__push({ k: 'a.save', v: w.__S(r && r.data) });
    return r;
  };
}`;

const peerState = (page: Page): Promise<{ saved: string[]; dom: string[] }> => run(page, String.raw`async function () {
  const out = await window.__b2.save();
  return {
    saved: out.blocks.map((b) => b.id + ':' + (b.data.text || '')),
    dom: Array.from(document.querySelectorAll('#blok2 [data-blok-id]')).map((x) => x.getAttribute('data-blok-id') + ':' + x.textContent),
  };
}`);

/* Public API groups the Vue adapter drives from its watchers, Selection mutators, and DOM mutations under #root. */
const VUE_TRACE = String.raw`function () {
  const w = window;
  const push = w.__push;
  for (const group of ['blocks', 'readOnly', 'toolbar', 'theme', 'width', 'placeholder', 'tokens', 'i18n', 'tools', 'handlers', 'caret']) {
    const g = w.blokInstance[group];
    if (!g) continue;
    for (const name of Object.keys(g)) {
      const orig = g[name];
      if (typeof orig !== 'function') continue;
      g[name] = (...args) => {
        push({ k: 'api.' + group + '.' + name, a: JSON.stringify(args).slice(0, 120), stack: w.__st() });
        return orig(...args);
      };
    }
  }
  for (const name of ['focus', 'render']) {
    const orig = w.blokInstance[name];
    if (typeof orig !== 'function') continue;
    w.blokInstance[name] = (...args) => { push({ k: 'api.' + name, stack: w.__st() }); return orig(...args); };
  }
  for (const name of ['removeAllRanges', 'addRange', 'collapse', 'setBaseAndExtent', 'empty']) {
    const orig = Selection.prototype[name];
    Selection.prototype[name] = function (...args) { push({ k: 'sel.' + name, stack: w.__st() }); return orig.apply(this, args); };
  }
  new MutationObserver((records) => {
    push({
      k: 'MO',
      n: records.length,
      recs: records.slice(0, 12).map((r) => r.type + ':' + r.target.nodeName + (r.target instanceof Element ? '[' + (r.target.getAttribute('data-blok-id') || r.target.getAttribute('data-blok-testid') || '') + ']' : '') + ':' + (r.attributeName || '') + ':+' + r.addedNodes.length + '-' + r.removedNodes.length),
    });
  }).observe(document.getElementById('root') || document.body, { subtree: true, childList: true, attributes: true, characterData: true });
}`;

/* List tool + marker calculator + BlockYjsSync.handleYjsUpdate tracing (W4K-22). */
const LIST_TRACE = String.raw`function () {
  const w = window;
  const push = w.__push;
  const S = w.__S;
  const bm = w.blokInstance.module.blockManager;
  const ym = w.blokInstance.module.yjsManager;
  const inst = bm.blocks.find((x) => x.name === 'list').toolInstance;
  const proto = Object.getPrototypeOf(inst);
  const mc = Object.getPrototypeOf(inst.markerCalculator);
  const info = (self) => {
    const el = self._element;
    const holder = el && el.closest('[data-blok-id]');
    const marker = el && el.querySelector('[data-list-marker]');
    return self.blockId + '|struct=' + self.getStructuralListDepth() + '|data.depth=' + self._data.depth + '|marker=' + (marker && marker.textContent) + '|hd=' + (holder && holder.getAttribute('data-blok-depth'));
  };
  for (const name of ['updateMarkerForDepth', 'moved', 'setData', 'rendered', 'adjustDepthTo', 'updateMarker']) {
    const orig = proto[name];
    proto[name] = function (...args) {
      push({ k: 'list.' + name, a: S(args), before: info(this) });
      const r = orig.apply(this, args);
      push({ k: 'list.' + name + ':after', after: info(this) });
      return r;
    };
  }
  for (const name of ['getVisualDepth', 'getGroupBaseDepth', 'getBlockDepth']) {
    const orig = mc[name];
    mc[name] = function (...args) { const r = orig.apply(this, args); push({ k: 'mc.' + name, a: S(args), r }); return r; };
  }
  const sync = bm.yjsSync;
  const origHandle = sync.handleYjsUpdate;
  sync.handleYjsUpdate = function (blockId, origin) {
    const blk = bm.blocks.find((x) => x.id === blockId);
    const yb = ym.getBlockById(blockId);
    push({ k: 'sync.handleYjsUpdate', a: [blockId, String(origin)], preserved: S(blk && blk.preservedData), doc: S(yb ? ym.yMapToObject(yb.get('data')) : null) });
    return origHandle.call(this, blockId, origin);
  };
}`;

const CARET_STACK = String.raw`function () {
  const uh = window.blokInstance.module.yjsManager.undoHistory;
  return uh.caretUndoStack.map((e) => ({ before: window.__S(e.before), after: window.__S(e.after), kind: e.kind }));
}`;

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

test.describe('W5R root causes', () => {
  test.describe.configure({ timeout: 60_000 });

  // W4S-2 root cause. caretSplitFirstLine (paste/handlers/base.ts:111-114) edits block "a" in the DOM.
  // blockDidMutated runs with no sync window open, so syncBlockDataToYjs(a) starts; the echo guard at
  // blockManager.ts:1857 is NOT what drops it. While a.save() is in flight, BlockManager.paste opens two
  // unscoped RAF-extended windows (block-insertion.ts:762 and :794). When the save resolves (it returns
  // {text:'HelloX1'}), the re-check at blockManager.ts:2100 (isSyncingFromYjs && isReconciling, true because
  // unscopedSyncCount = 2) returns WITHOUT enqueueing and WITHOUT noteSuppressedMutation, so the deferred
  // replay (yjs-sync.ts:248-259, drained at :322) never learns about it. No ym.enqueue for "a" ever happens.
  test('W5R-1: the first-line merge of a mid-block multi-line paste reaches the Yjs doc', async ({ page }) => {
    test.fail(true, 'W5R-1 (W4S-2): blockManager.ts:2100 drops the in-flight write-back of the caret split');
    await mount(page, [{ id: 'a', type: 'paragraph', data: { text: 'Hello world' } }]);
    await instrument(page, 'a');
    await caretAfterFifthChar(page, 'a');
    await gap(page);
    await mark(page, 'PASTE');
    await paste(page, { 'text/plain': 'X1\nX2' });
    await gap(page, 1500);
    const afterPaste = { saved: await savedText(page), doc: await docText(page, 'a') };

    await mark(page, 'UNDO');
    await page.keyboard.press(UNDO);
    await gap(page, 500);
    const afterUndo = { saved: await savedText(page), doc: await docText(page, 'a'), canUndo: await page.evaluate(() => window.blokInstance?.history.canUndo()) };

    dump('1', { afterPaste, afterUndo, log: await readLog(page) });
    expect(afterPaste.doc, 'the doc holds what save() reports').toBe('HelloX1');
    expect(afterPaste.saved[0]).toBe('a:HelloX1');
  });

  // W4S-2 seen by a second client fed by this editor's Yjs updates. Observed: after the paste the peer shows
  // "Hello world" + "X2 world" (the author shows "HelloX1" + "X2 world"); after the undo the peer shows
  // "Hello world" and the author "HelloX1". A host persisting save() keeps "HelloX1" and loses " world";
  // a host persisting the Yjs doc keeps "Hello world".
  test('W5R-1b: a second client sees the same text as the author after a mid-block multi-line paste', async ({ page }) => {
    test.fail(true, 'W5R-1b (W4S-2): the caret-split write never reaches the doc, so peers diverge');
    await mount(page, [{ id: 'a', type: 'paragraph', data: { text: 'Hello world' } }]);
    await instrument(page, 'a');
    await run(page, PEER_SETUP);
    const peerBefore = await peerState(page);

    await caretAfterFifthChar(page, 'a');
    await gap(page);
    await paste(page, { 'text/plain': 'X1\nX2' });
    await gap(page, 1500);
    const local = await savedText(page);
    const peerAfter = await peerState(page);

    await page.keyboard.press(UNDO);
    await gap(page, 700);
    const localUndo = await savedText(page);
    const peerUndo = await peerState(page);

    dump('1b', { peerBefore, local, peerAfter, localUndo, peerUndo, log: await readLog(page) });
    expect(peerAfter.saved).toContain('a:HelloX1');
    expect(local[0]).toBe('a:HelloX1');
  });

  // A Vue v-model echo calls readOnly.set(false) on an already-editable editor. That is a no-op and keeps the caret.
  isolatedTest('W5R-2: a Vue v-model echo keeps the caret where the user is typing', async ({ page }) => {
    isolatedTest.setTimeout(60_000);
    await openVue(page, 'vmodel');
    await instrument(page, 'p1');
    await run(page, VUE_TRACE);
    await editable(page, 'p1').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' ');
    await gap(page);
    await page.keyboard.type('x');
    await gap(page, SAVE_SETTLE);
    await editable(page, 'p2').click();
    const beforeUndo = await docText(page, 'p1');

    await mark(page, 'UNDO');
    await page.keyboard.press(UNDO);
    await gap(page, 500);
    const afterUndo = await docText(page, 'p1');

    await mark(page, 'REDO');
    await page.keyboard.press(REDO);
    await gap(page, 800);
    const afterRedo = await docText(page, 'p1');

    dump('2', { beforeUndo, afterUndo, afterRedo, saves: await page.evaluate(() => window.__w4n?.saves), log: await readLog(page) });
    expect(beforeUndo, 'the letter was typed at the caret, before any undo').toBe('Hello from Vue x');
  });

  // Control: the same steps without v-model (no update:data echo) type at the caret.
  isolatedTest('W5R-2 control: without v-model the letter is typed at the caret', async ({ page }) => {
    isolatedTest.setTimeout(60_000);
    await openVue(page, 'none');
    await editable(page, 'p1').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' ');
    await gap(page);
    await page.keyboard.type('x');
    await gap(page, SAVE_SETTLE);

    expect(await docText(page, 'p1')).toBe('Hello from Vue x');
  });

  // Core half of W5R-2, no framework: a no-op readOnly.set(false) kills a live caret.
  test('W5R-2b: readOnly.set(false) on an editable editor keeps the caret', async ({ page }) => {
    await mount(page, [{ id: 'p', type: 'paragraph', data: { text: 'Hello' } }], false);
    await editable(page, 'p').click();
    await page.keyboard.press('End');
    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.set(false);
    });
    await page.keyboard.type('x');
    await gap(page);
    const saved = await savedText(page);

    dump('2b', { saved });
    expect(saved).toEqual(['p:Hellox']);
  });

  // Each block subscribes to didMutated once, so extra set(false) calls add no write-back per keystroke.
  test('W5R-2c: repeated readOnly.set(false) does not multiply the write-back per keystroke', async ({ page }) => {
    await mount(page, [{ id: 'p', type: 'paragraph', data: { text: 'Hello' } }], false);
    await instrument(page, 'p');
    const syncsForOneKey = async (): Promise<number> => {
      await editable(page, 'p').click();
      await page.keyboard.press('End');
      const start = (await readLog(page)).length;

      await page.keyboard.type('x');
      await gap(page);

      return (await readLog(page)).slice(start).filter((e) => e.k === 'bm.syncBlockDataToYjs').length;
    };
    const baseline = await syncsForOneKey();

    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.set(false);
      await window.blokInstance?.readOnly.set(false);
      await window.blokInstance?.readOnly.set(false);
    });
    const after = await syncsForOneKey();

    dump('2c', { baseline, after });
    expect(after).toBe(baseline);
  });

  // Multi-select Tab is a plain tracked parentId write; its redo is a parentId replay, which must fire the
  // list's moved() hook itself. Single-item Tab records a move entry, whose redo runs moved() through the
  // placement callback.
  for (const variant of ['multi', 'single'] as const) {
    test(`W5R-3 ${variant}: redo of Tab draws the nested bullet glyph`, async ({ page }) => {
      const L = (id: string, text: string): OutputData['blocks'][number] => ({ id, type: 'list', data: { text, style: 'unordered', checked: false } });

      await mount(page, [L('a', 'A'), L('b', 'B'), L('c', 'C')], false);
      await instrument(page);
      await run(page, LIST_TRACE);
      const markers = (): Promise<string[]> => page.evaluate(() => Array.from(document.querySelectorAll('#blok [data-blok-testid="block-wrapper"]')).map((wr) =>
        `${wr.getAttribute('data-blok-id') ?? '?'}|d${wr.getAttribute('data-blok-depth') ?? '-'}|${wr.querySelector('[data-list-marker]')?.textContent ?? ''}`));

      await editable(page, 'b').click();
      await page.keyboard.press('End');
      const extend = variant === 'multi' ? 2 : 0;

      await page.keyboard.down('Shift');
      for (let i = 0; i < extend; i++) {
        await page.keyboard.press('ArrowDown');
      }
      await page.keyboard.up('Shift');
      await page.waitForFunction((n) => document.querySelectorAll('#blok [data-blok-selected="true"]').length === n, extend);
      await gap(page);
      await mark(page, 'TAB');
      await page.keyboard.press('Tab');
      await gap(page);
      const after = await markers();

      await mark(page, 'UNDO');
      await page.keyboard.press(UNDO);
      await gap(page, 300);
      const undone = await markers();

      await mark(page, 'REDO');
      await page.keyboard.press(REDO);
      await gap(page, 300);
      const redone = await markers();

      dump(`3-${variant}`, { after, undone, redone, log: await readLog(page) });
      expect(redone, 'redo restores the post-Tab glyphs').toEqual(after);
    });
  }

  // W4K-16..19 root cause. The entry's "before" is NOT null: it equals the post-conversion caret.
  // The handler's FIRST stopCapturing (markdownShortcuts.ts:385 / :510, emojiTrigger.ts:471) flushes the
  // buffered typing (undo-history.ts:1251); that write merges into the typing item (stack-item-updated) and
  // the listener calls resetPendingCaretState (undo-history.ts:890), so no caret-before is pending any more.
  // The handler then rewrites the DOM, moves the caret and calls dispatchChange (markdownShortcuts.ts:440 /
  // :542, emojiTrigger.ts:487). The conversion's write marks caret-before lazily at enqueue
  // (yjs/index.ts:517), reading the ALREADY-MOVED caret, so before == after == post-conversion offset.
  // Nothing captures the caret between the first stopCapturing and the DOM rewrite.
  for (const c of [
    { id: '4a', typed: '**b**', literal: '**b**' },
    { id: '4b', typed: '[a](x.io)', literal: '[a](x.io)' },
    { id: '4c', typed: ':smile', literal: ':smile:' },
  ]) {
    test(`W5R-${c.id}: the undo entry of "${c.literal}" remembers the caret from before the conversion`, async ({ page }) => {
      test.fail(true, `W5R-${c.id}: caret-before captured after the handler moved the caret`);
      await mount(page, [{ id: 'p', type: 'paragraph', data: { text: '' } }], false);
      await instrument(page, 'p');
      await editable(page, 'p').click();
      await gap(page);
      await mark(page, 'TYPE');
      await page.keyboard.type(c.typed);
      // The emoji shortcode commits only once the menu has matched it.
      await page.waitForFunction((isEmoji) => !isEmoji || Boolean(document.querySelector('[data-blok-id="p"] [contenteditable="true"]')?.getAttribute('aria-activedescendant')), c.id === '4c');
      await page.keyboard.type(c.literal.slice(c.typed.length));
      await gap(page);
      const stack = await run<Array<{ before: { offset: number } | null; after: { offset: number } | null }>>(page, CARET_STACK);

      await mark(page, 'UNDO');
      await page.keyboard.press(UNDO);
      await gap(page, 300);
      const text = await page.evaluate(() => document.querySelector('[data-blok-id="p"] [contenteditable="true"]')?.textContent);

      dump(c.id, { stack, text, log: await readLog(page) });
      // This entry reverts to the full literal text, so its caret-before is right after that text.
      expect(stack.at(-1)?.before?.offset).toBe(c.literal.length);
      expect(text).toBe(c.literal);
    });
  }

  // One-off w4-nested failure ("Level two&nbsp;" after 3 undos) is DESIGNED step splitting, not a write outside
  // history. The typed space is written by its own leading-edge flush as a TRACKED step (origin 'local',
  // stack-item-added) and arms the word-boundary checkpoint (UndoHistory.markBoundary, undo-history.ts:1611-1629,
  // BOUNDARY_TIMEOUT_MS = 100, serializer.ts:311). Any stall >= 100 ms after the space (not the 500 ms capture
  // window) closes the group, so "deep" becomes the next step. Unloaded, CPU throttling 4x/6x and a 50 ms stall
  // do not split it; 150 ms and 450 ms stalls always do. Under parallel load (--repeat-each=3) even the plain
  // run pauses >= 100 ms after the space now and then; the test asserts split <=> checkpoint fired.
  for (const variant of ['plain', 'cpu4', 'cpu6', 'stall50', 'stall150', 'stall450'] as const) {
    test(`W5R-5 ${variant}: toggle > callout > list > nested list, 3 undos after " deep", Enter, "new item"`, async ({ page }) => {
      await mount(page, [
        { id: 'top', type: 'paragraph', data: { text: 'Top' } },
        { id: 't', type: 'toggle', data: { text: 'Tog', isOpen: true }, content: ['co'] },
        { id: 'co', type: 'callout', data: { emoji: '💡', textColor: null, backgroundColor: null }, parent: 't', content: ['l1'] },
        { id: 'l1', type: 'list', data: { text: 'Level one', style: 'unordered' }, parent: 'co', content: ['l2'] },
        { id: 'l2', type: 'list', data: { text: 'Level two', style: 'unordered', depth: 1 }, parent: 'l1' },
      ] as OutputData['blocks'], false);
      await instrument(page, 'l2');
      const cdp = await page.context().newCDPSession(page);
      const rates: Record<string, number> = { cpu4: 4, cpu6: 6 };
      const stall = variant.startsWith('stall') ? Number(variant.slice('stall'.length)) : 0;

      await cdp.send('Emulation.setCPUThrottlingRate', { rate: rates[variant] ?? 1 });
      const l2 = async (): Promise<{ doc: string | undefined; saved: string | undefined }> =>
        ({ doc: await docText(page, 'l2'), saved: (await savedText(page)).find((x) => x.startsWith('l2:')) });

      await editable(page, 'l2').click();
      await page.keyboard.press('End');
      await mark(page, 'TYPE');
      await page.keyboard.type(' ');
      await gap(page, stall);
      await page.keyboard.type('deep');
      await gap(page);
      const s1 = await l2();

      await page.keyboard.press('Enter');
      await gap(page);
      await page.keyboard.type('new item');
      await gap(page);
      const steps: Array<{ doc: string | undefined; saved: string | undefined }> = [];

      for (let i = 0; i < 3; i++) {
        await mark(page, `UNDO ${i}`);
        await page.keyboard.press(UNDO);
        await gap(page, 500);
        steps.push(await l2());
      }
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      const log = await readLog(page);

      const typed = log.slice(log.findIndex((e) => e.k === '=== TYPE'));
      const isL2Text = (e: LogEntry): boolean => e.k === 'Y' && e.path === 'l2/data/text';
      const spaceWrite = typed.find(isL2Text);
      const boundaryAt = typed.findIndex((e) => e.k === 'uh.markBoundary');
      const nextWriteAt = typed.findIndex((e, i) => i > boundaryAt && isL2Text(e));
      // The word-boundary checkpoint fired before "d" was written.
      const checkpoint = boundaryAt >= 0 && typed.slice(boundaryAt, nextWriteAt).some((e) => e.k === 'uh.stopCapturing');

      dump(`5-${variant}`, { s1, steps, checkpoint, log });
      expect(spaceWrite?.origin, 'the typed space is written as a tracked local change').toBe('local');
      expect(checkpoint || stall < 100, 'a stall of 100 ms or more after the space always closes the group').toBe(true);
      // The space survives the third undo exactly when the checkpoint fired, whatever caused the pause.
      expect(steps[2]).toEqual(checkpoint
        ? { doc: 'Level two&nbsp;', saved: 'l2:Level two&nbsp;' }
        : { doc: 'Level two', saved: 'l2:Level two' });
    });
  }
});

/* ---------------- Vue harness (copied from w4-nested.spec.ts) ---------------- */

const IMPORT_MAP = JSON.stringify({
  imports: {
    vue: '/test/playwright/fixtures/vendor/vue.mjs',
    '@bloklabs/core': '/dist/blok.mjs?_v=1',
    '@bloklabs/core/adapters': '/dist/adapters.mjs?_v=1',
    '@bloklabs/core/view': '/dist/view.mjs?_v=1',
    '@bloklabs/core/locales': '/dist/locales.mjs?_v=1',
  },
});

const VUE_APP = `
import { createApp, h, ref } from 'vue';
import { BlokEditor, createVueBlock } from '/packages/vue/dist/index.mjs?_v=1';
const { Paragraph, Header } = await import('/dist/tools.mjs?_v=1');
window.__w4n = { renders: 0, saves: 0, ready: false };
const VCounter = createVueBlock({
  type: 'vcounter',
  propSchema: { count: { default: 0 } },
  setup: (ctx) => () => h('div', [
    h('span', { 'data-blok-testid': 'rc-value' }, String(ctx.data.value.count)),
    h('button', { 'data-blok-testid': 'rc-inc', onClick: () => ctx.commit({ count: ctx.data.value.count + 1 }) }, '+1'),
  ]),
});
const App = {
  setup() {
    const data = ref({ blocks: [
      { id: 'p1', type: 'paragraph', data: { text: 'Hello from Vue' } },
      { id: 'rc', type: 'vcounter', data: { count: 0 } },
      { id: 'p2', type: 'paragraph', data: { text: 'Second' } },
    ] });
    return () => h(BlokEditor, {
      tools: { paragraph: { class: Paragraph }, header: { class: Header }, vcounter: { class: VCounter } },
      data: data.value,
      onReady: (ed) => {
        window.blokInstance = ed;
        const orig = ed.render.bind(ed);
        ed.render = (...a) => { window.__w4n.renders++; return orig(...a); };
        window.__w4n.ready = true;
      },
      ...(new URLSearchParams(location.search).get('mode') === 'none' ? {} : { 'onUpdate:data': (next) => { window.__w4n.saves++; window.__push && window.__push({ k: 'update:data', stack: window.__st() }); data.value = next; } }),
    });
  },
};
createApp(App).mount('#root');
`;

const openVue = async (page: Page, mode: string): Promise<void> => {
  const url = 'http://localhost:4444/test/playwright/fixtures/__w5r-vue.html';

  await page.route(`${url}*`, route => route.fulfill({
    contentType: 'text/html',
    body: `<!DOCTYPE html><html><head><meta charset="utf-8"><script type="importmap">${IMPORT_MAP}</script></head><body><div id="root"></div><script type="module">${VUE_APP}</script></body></html>`,
  }));
  await page.goto(`${url}?mode=${mode}`);
  await page.waitForFunction(() => window.__w4n?.ready === true);
};
