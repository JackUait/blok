/**
 * Architectural enforcement: the Null-Origin Transaction Law.
 *
 * `BlockObserver.mapTransactionOrigin` maps origin `null` to 'local', because
 * the only writer that uses it is yjs's own format cleanup. yjs runs that
 * cleanup only after a NON-local transaction (yjs YText.js `_callObserver`
 * sets `_needFormattingCleanup` when `!transaction.local`; Transaction.js runs
 * it after `afterTransaction`), and it never changes the segments. If Blok code
 * ever writes in a null-origin transaction, that write is classified 'local'
 * and a peer's or undo's rerender is silently skipped.
 *
 * Two halves:
 * 1. Runtime: a changing null-origin transaction only ever follows a
 *    non-local one; a solo session doing typical edits shows none.
 * 2. Static: every `.transact(` in src passes an origin, except Blok wrappers
 *    that add one themselves and the listed read-only scans.
 *
 * If this fails: pass a `LocalOriginTag` to the transact you added (or use
 * `DocumentStore.transact` / `transactWithoutCapture`), or exempt a read-only
 * scan below with its reason.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import * as ts from 'typescript';
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';

import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import { UndoHistory } from '../../../src/components/modules/yjs/undo-history';
import type { BlokModules } from '../../../src/types-internal/blok-modules';

const SRC = resolve(__dirname, '../../../src');

// ─── Runtime half ────────────────────────────────────────────────────────────

const createMockBlok = (): BlokModules => ({
  BlockManager: {
    currentBlock: undefined,
    getBlockById: vi.fn(),
    getBlockByChildNode: vi.fn(),
    blocks: [],
  } as unknown as BlokModules['BlockManager'],
  Caret: {
    setToBlock: vi.fn(),
    setToInput: vi.fn(),
    positions: { START: 'start', END: 'end', DEFAULT: 'default' },
  } as unknown as BlokModules['Caret'],
} as unknown as BlokModules);

interface Recorded {
  local: boolean;
  nullOrigin: boolean;
  changes: boolean;
}

/**
 * A store with undo, recording every transaction. An observer reads
 * `YTextEvent.delta` on purpose: that read makes yjs delete redundant format
 * items, so cleanups that change the doc are as frequent as they can get.
 */
const recordedStore = (clientId: number): { store: DocumentStore; history: UndoHistory; log: Recorded[]; deltaOps: () => number } => {
  const store = new DocumentStore(new YBlockSerializer());
  const doc = store.blocksMap.doc;
  const log: Recorded[] = [];
  let deltaOps = 0;

  if (doc !== null) {
    doc.clientID = clientId;
    doc.on('afterTransaction', (transaction: Y.Transaction) => {
      log.push({
        local: transaction.local,
        nullOrigin: transaction.origin === null,
        changes: transaction.changed.size > 0 || transaction.deleteSet.clients.size > 0,
      });
    });
  }
  store.blocksMap.observeDeep((events) => events.forEach((event) => {
    if (event instanceof Y.YTextEvent) {
      deltaOps += event.delta.length;
    }
  }));

  return { store, history: new UndoHistory(store.undoScope, createMockBlok()), log, deltaOps: () => deltaOps };
};

/** Typical solo editing through the store's write paths. */
const typicalEdits = (store: DocumentStore, history: UndoHistory): void => {
  store.fromJSON([
    { id: 'p1', type: 'paragraph', data: { text: 'The quick brown fox' } },
    { id: 'h1', type: 'header', data: { text: 'Title', level: 2 } },
  ]);
  store.updateBlockData('p1', 'text', 'The <b>quick</b> brown fox');
  history.stopCapturing();
  store.updateBlockData('p1', 'text', 'The <b>quick</b> <i>brown</i> fox jumps');
  history.stopCapturing();
  store.updateBlockData('p1', 'text', 'The  fox jumps');
  history.stopCapturing();
  store.addBlock({ id: 'p2', type: 'paragraph', data: { text: 'Second <a href="https://a.b">link</a>' } });
  history.stopCapturing();
  store.moveBlockTo('p2', { parentId: null, afterId: null });
  history.stopCapturing();
  store.replaceBlockContent('h1', 'paragraph', { text: 'Title <b>now</b> plain' });
  history.stopCapturing();
  store.updateBlockTune('p1', 'align', { alignment: 'center' });
  history.stopCapturing();
  store.removeBlock('p2');
  history.stopCapturing();
  history.undo();
  history.undo();
  history.undo();
  history.redo();
  history.undo();
  history.undo();
};

describe('Null-Origin Transaction Law — runtime', () => {
  it('a solo session doing typical edits never makes a changing null-origin transaction', () => {
    const { store, history, log, deltaOps } = recordedStore(1);

    typicalEdits(store, history);

    expect(log.filter((entry) => entry.changes).length).toBeGreaterThan(0);
    expect(deltaOps()).toBeGreaterThan(0);
    expect(log.filter((entry) => entry.nullOrigin && entry.changes)).toEqual([]);
  });

  it('with a peer, a changing null-origin transaction only follows a non-local one', () => {
    const a = recordedStore(1);
    const b = recordedStore(2);
    const sync = (): void => {
      const forB = a.store.encodeStateAsUpdate(b.store.getStateVector());
      const forA = b.store.encodeStateAsUpdate(a.store.getStateVector());

      b.store.applyRemoteUpdate(forB);
      a.store.applyRemoteUpdate(forA);
    };

    typicalEdits(a.store, a.history);
    sync();
    a.store.updateBlockData('p1', 'text', 'The q<b>uic</b>k brown fox');
    b.store.updateBlockData('p1', 'text', 'The  fox');
    a.store.updateBlockData('h1', 'text', 'Title <b>now plain</b>');
    b.store.updateBlockData('h1', 'text', '<b>Title now</b> plain');
    sync();
    sync();

    for (const { log } of [a, b]) {
      log.forEach((entry, index) => {
        if (entry.nullOrigin && entry.changes) {
          // Skip the no-change null transactions yjs (and the delta read) open in between.
          const previous = log.slice(0, index).reverse().find((candidate) => !(candidate.nullOrigin && !candidate.changes));

          expect(previous?.local).toBe(false);
        }
      });
    }
    // Guard: the scenario really produced changing cleanups.
    expect([...a.log, ...b.log].some((entry) => entry.nullOrigin && entry.changes)).toBe(true);
  });
});

// ─── Static half ─────────────────────────────────────────────────────────────

/**
 * Receivers whose `transact` is a Blok wrapper that sets the origin itself.
 */
const ORIGIN_SETTING_WRAPPERS: Record<string, string> = {
  'this.Blok.YjsManager': 'YjsManager.transact passes \'local\' (yjs/index.ts)',
  'this.dependencies.YjsManager': 'YjsManager.transact passes \'local\' (yjs/index.ts)',
  'editor.blocks': 'blocks API → YjsManager.transact',
  'api.blocks': 'blocks API → YjsManager.transact',
  'this.api.blocks': 'blocks API → YjsManager.transact',
  blocks: 'blocks API (block/api.ts) → YjsManager.transact',
};

/**
 * Files whose own `this.transact(fn)` is a Blok wrapper, not a Y.Doc call.
 */
const THIS_WRAPPERS: Record<string, string> = {
  'components/modules/yjs/index.ts': 'YjsManager.transact → DocumentStore.transact(fn, \'local\')',
  'components/modules/api/blocks.ts': 'BlocksAPI.transact → BlockManager.transactForTool, opens no Y transaction',
};

/**
 * Read-only `doc.transact` scans: they only call `Y.iterateDeletedStructs`,
 * which needs a transaction, and write nothing. Keyed by file and method.
 */
const READ_ONLY_SCANS: Record<string, string> = {
  'components/modules/yjs/undo-history.ts#scanTopEntry': 'iterateDeletedStructs over a stack item, read-only',
  'components/modules/yjs/undo-history.ts#isShadowed': 'iterateDeletedStructs over a stack item, read-only',
  'components/modules/yjs/undo-history.ts#wasBlockedBySparing': 'iterateDeletedStructs over a stack item, read-only',
  'components/modules/yjs/undo-history.ts#recordDeletedPlacements': 'iterateDeletedStructs over a stack item, read-only',
  'components/modules/yjs/undo-history.ts#undoWouldApply': 'iterateDeletedStructs over a stack item, read-only',
};

const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);

  if (statSync(full).isDirectory()) {
    return walk(full);
  }

  return /\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [full] : [];
});

const enclosingMethod = (node: ts.Node): string => {
  for (let current: ts.Node | undefined = node.parent; current !== undefined; current = current.parent) {
    if ((ts.isMethodDeclaration(current) || ts.isFunctionDeclaration(current)) && current.name !== undefined) {
      return current.name.getText();
    }
  }

  return '<top level>';
};

/**
 * Every `X.transact(...)` call in `source` that passes fewer than two
 * arguments, as `file#method receiver`. `idb.transact(db, stores)` (IndexedDB)
 * always passes two or more, so it never shows up.
 * @param file - path relative to src
 * @param source - file text
 */
const findBareTransacts = (file: string, source: string): Array<{ key: string; receiver: string }> => {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: Array<{ key: string; receiver: string }> = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'transact' &&
      node.arguments.length < 2
    ) {
      found.push({
        key: `${file}#${enclosingMethod(node)}`,
        receiver: node.expression.expression.getText(),
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
};

const violationsIn = (file: string, source: string): string[] =>
  findBareTransacts(file, source)
    .filter(({ key, receiver }) =>
      !(receiver in ORIGIN_SETTING_WRAPPERS) &&
      !(receiver === 'this' && file in THIS_WRAPPERS) &&
      !(key in READ_ONLY_SCANS))
    .map(({ key, receiver }) => `${key} (${receiver}.transact)`);

describe('Null-Origin Transaction Law — static', () => {
  const files = walk(SRC).map((full) => ({ file: relative(SRC, full).split('\\').join('/'), source: readFileSync(full, 'utf8') }));

  it('every .transact( in src passes an origin, or is an exempt wrapper or read-only scan', () => {
    expect(files.flatMap(({ file, source }) => violationsIn(file, source))).toEqual([]);
  });

  it('every read-only exemption still matches a bare transact (no stale entries)', () => {
    const keys = new Set(files.flatMap(({ file, source }) => findBareTransacts(file, source).map(({ key }) => key)));

    expect(Object.keys(READ_ONLY_SCANS).filter((key) => !keys.has(key))).toEqual([]);
  });

  it('flags a bare doc.transact the scan has not been told about', () => {
    const scratch = 'class S { private write(): void { this.ydoc.transact(() => { this.map.set(\'k\', 1); }); } }';

    expect(violationsIn('components/modules/yjs/scratch.ts', scratch)).toEqual([
      'components/modules/yjs/scratch.ts#write (this.ydoc.transact)',
    ]);
  });
});
