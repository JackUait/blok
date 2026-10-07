/**
 * Architectural enforcement: the Null-Origin Transaction Law.
 *
 * `BlockObserver.mapTransactionOrigin` maps origin `null` to 'local' ONLY for
 * yjs's own format cleanup: a transaction that inserts nothing and deletes
 * only format items. Every other null-origin transaction is 'remote', so the
 * block re-renders. yjs runs the cleanup only after a NON-local transaction
 * (yjs YText.js `_callObserver` sets `_needFormattingCleanup` when
 * `!transaction.local`; Transaction.js runs it after `afterTransaction`), and
 * it never changes the segments.
 *
 * A Blok write with a null origin is therefore not silent any more, but it is
 * still wrong: it re-renders its own block as if a peer wrote it, and the undo
 * manager does not track it.
 *
 * Three halves:
 * 1. Runtime: every changing null-origin transaction is a format cleanup, and
 *    only ever follows a non-local one; a solo session shows none.
 * 2. Runtime: the observer maps a cleanup to 'local' and any other null-origin
 *    write to 'remote'.
 * 3. Static: every transact in src passes an origin — `x.transact(fn, origin)`,
 *    `Y.transact(doc, fn, origin)` and yjs's imported `transact(doc, fn,
 *    origin)`, never a `null`/`undefined` literal — except Blok wrappers that
 *    add one themselves and the listed read-only scans.
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

import { BlockObserver } from '../../../src/components/modules/yjs/block-observer';
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
  inserted: boolean;
  formatOnlyDeletes: boolean;
}

/**
 * Whether the transaction deleted only format items. Must run inside
 * `afterTransaction`, before GC hides what the deleted items held.
 * @param transaction - the transaction to read
 */
const deletesOnlyFormats = (transaction: Y.Transaction): boolean => {
  const kinds = { other: 0 };

  Y.iterateDeletedStructs(transaction, transaction.deleteSet, (struct) => {
    if (!(struct instanceof Y.Item) || !(struct.content instanceof Y.ContentFormat)) {
      kinds.other += 1;
    }
  });

  return kinds.other === 0;
};

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
        inserted: [...transaction.afterState].some(([client, clock]) => transaction.beforeState.get(client) !== clock),
        formatOnlyDeletes: deletesOnlyFormats(transaction),
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
    // Every changing null-origin transaction has the cleanup's shape, which
    // is what the observer keys 'local' on.
    expect([...a.log, ...b.log]
      .filter((entry) => entry.nullOrigin && entry.changes)
      .filter((entry) => entry.inserted || !entry.formatOnlyDeletes)).toEqual([]);
    // Guard: the scenario really produced changing cleanups.
    expect([...a.log, ...b.log].some((entry) => entry.nullOrigin && entry.changes)).toBe(true);
  });
});

describe('Null-Origin Transaction Law — classification', () => {
  /** A store whose observer records the origin of every update to `p1`. */
  const observed = (clientId: number): { store: DocumentStore; origins: string[]; destroy: () => void } => {
    const store = new DocumentStore(new YBlockSerializer());
    const observer = new BlockObserver();
    const origins: string[] = [];

    if (store.blocksMap.doc !== null) {
      store.blocksMap.doc.clientID = clientId;
    }
    const undoManager = new Y.UndoManager(store.undoScope, { trackedOrigins: new Set(['local']) });

    observer.observe({ blocksMap: store.blocksMap, rootOrder: store.rootOrder }, undoManager);
    observer.onBlocksChanged((event) => {
      if ('blockId' in event && event.blockId === 'p1' && event.type === 'update') {
        origins.push(event.origin);
      }
    });

    return {
      store,
      origins,
      destroy: () => {
        observer.destroy();
        undoManager.destroy();
      },
    };
  };

  it.each([[1, 2], [2, 1]])('maps a real format cleanup to local (ids %i/%i)', (ownId, peerId) => {
    const own = observed(ownId);
    const peer = new DocumentStore(new YBlockSerializer());

    if (peer.blocksMap.doc !== null) {
      peer.blocksMap.doc.clientID = peerId;
    }
    own.store.fromJSON([{ id: 'p1', type: 'paragraph', data: { text: 'The quick brown fox jumps' } }]);
    peer.applyRemoteUpdate(own.store.encodeStateAsUpdate());
    own.store.updateBlockData('p1', 'text', 'The q<b>uic</b>k brown fox jumps');
    peer.updateBlockData('p1', 'text', 'The  fox jumps');
    own.origins.length = 0;
    // Reading the delta is what makes yjs clean up (see recordedStore).
    const deltas: unknown[] = [];

    own.store.blocksMap.observeDeep((events) => events.forEach((event) => {
      if (event instanceof Y.YTextEvent) {
        deltas.push(event.delta);
      }
    }));
    own.store.applyRemoteUpdate(peer.encodeStateAsUpdate(own.store.getStateVector()));
    own.destroy();

    // The remote apply, then yjs's cleanup.
    expect(own.origins).toEqual(['remote', 'local']);
    expect(deltas.length).toBeGreaterThan(0);
  });

  it('maps any other null-origin write to remote', () => {
    const own = observed(1);

    own.store.fromJSON([{ id: 'p1', type: 'paragraph', data: { text: 'hello' } }]);

    const data = own.store.getBlockById('p1')?.get('data') as Y.Map<unknown>;
    const text = data.get('text') as Y.XmlText;

    own.origins.length = 0;
    // A bare insert, a bare text delete, and a delete-only map write.
    text.insert(5, '!');
    text.delete(0, 1);
    data.doc?.transact(() => data.set('k', 1), 'local');
    data.doc?.transact(() => data.delete('k'));
    own.destroy();

    expect(own.origins).toEqual(['remote', 'remote', 'local', 'remote']);
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

const isNullish = (node: ts.Expression | undefined): boolean =>
  node !== undefined &&
  (node.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(node) && node.text === 'undefined'));

/**
 * The local names a file binds yjs to: its namespace imports (`import * as Y`)
 * and its named imports of `transact` (`import { transact as t }`).
 * @param sourceFile - the parsed file
 */
const yjsBindings = (sourceFile: ts.SourceFile): { namespaces: Set<string>; transacts: Set<string> } => {
  const namespaces = new Set<string>();
  const transacts = new Set<string>();

  sourceFile.statements.forEach((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'yjs'
    ) {
      return;
    }

    const bindings = statement.importClause?.namedBindings;

    if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    }
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      bindings.elements
        .filter((element) => (element.propertyName ?? element.name).text === 'transact')
        .forEach((element) => transacts.add(element.name.text));
    }
  });

  return { namespaces, transacts };
};

/**
 * Every transact call in `source` that makes a null origin, as
 * `file#method receiver`:
 * - `x.transact(fn)` / `x.transact(fn, null | undefined)` (a Y.Doc or a wrapper);
 * - `Y.transact(doc, fn)` / yjs's imported `transact(doc, fn)`, with no origin
 *   or a `null` / `undefined` one.
 *
 * `idb.transact(db, stores)` (IndexedDB) always passes a store list second, so
 * it never shows up.
 * @param file - path relative to src
 * @param source - file text
 */
const findBareTransacts = (file: string, source: string): Array<{ key: string; receiver: string }> => {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const { namespaces, transacts } = yjsBindings(sourceFile);
  const found: Array<{ key: string; receiver: string }> = [];
  const lacksOrigin = (node: ts.CallExpression, index: number): boolean =>
    node.arguments.length <= index || isNullish(node.arguments[index]);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isYjsFunction =
        (ts.isPropertyAccessExpression(callee) &&
          callee.name.text === 'transact' &&
          ts.isIdentifier(callee.expression) &&
          namespaces.has(callee.expression.text)) ||
        (ts.isIdentifier(callee) && transacts.has(callee.text));
      const isMethod = !isYjsFunction && ts.isPropertyAccessExpression(callee) && callee.name.text === 'transact';

      if ((isYjsFunction && lacksOrigin(node, 2)) || (isMethod && lacksOrigin(node, 1))) {
        found.push({
          key: `${file}#${enclosingMethod(node)}`,
          receiver: ts.isPropertyAccessExpression(callee) ? callee.expression.getText() : '<yjs>',
        });
      }
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

  it('every transact in src passes an origin, or is an exempt wrapper or read-only scan', () => {
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

  it.each([
    ['an explicit null origin', 'class S { private write(): void { this.ydoc.transact(() => {}, null); } }', 'this.ydoc.transact'],
    ['an explicit undefined origin', 'class S { private write(): void { this.ydoc.transact(() => {}, undefined); } }', 'this.ydoc.transact'],
    ['Y.transact with no origin', 'import * as Y from \'yjs\';\nclass S { private write(): void { Y.transact(this.ydoc, () => {}); } }', 'Y.transact'],
    ['Y.transact with a null origin', 'import * as Y from \'yjs\';\nclass S { private write(): void { Y.transact(this.ydoc, () => {}, null); } }', 'Y.transact'],
    ['an imported transact', 'import { transact } from \'yjs\';\nclass S { private write(): void { transact(this.ydoc, () => {}); } }', '<yjs>.transact'],
    ['an aliased imported transact', 'import { transact as tx } from \'yjs\';\nclass S { private write(): void { tx(this.ydoc, () => {}, undefined); } }', '<yjs>.transact'],
  ])('flags %s', (_label, scratch, call) => {
    expect(violationsIn('components/modules/yjs/scratch.ts', scratch)).toEqual([
      `components/modules/yjs/scratch.ts#write (${call})`,
    ]);
  });

  it('passes yjs transacts that carry an origin, and a local transact helper', () => {
    const scratch = [
      'import * as Y from \'yjs\';',
      'import { transact } from \'yjs\';',
      'class S {',
      '  private write(): void {',
      '    Y.transact(this.ydoc, () => {}, \'local\');',
      '    transact(this.ydoc, () => {}, \'local\');',
      '    this.ydoc.transact(() => {}, \'local\');',
      '    idb.transact(db, [\'outbox\']);',
      '  }',
      '}',
    ].join('\n');
    const helper = 'const transact = (fn: () => void): void => fn();\nclass S { private write(): void { transact(() => {}); } }';

    expect(violationsIn('components/modules/yjs/scratch.ts', scratch)).toEqual([]);
    expect(violationsIn('components/modules/yjs/scratch.ts', helper)).toEqual([]);
  });
});
