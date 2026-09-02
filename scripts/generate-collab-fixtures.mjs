/**
 * Generates the collab lockstep fixtures under
 * `test/unit/server-conformance/fixtures/collab/<case>/`:
 *
 *   input.json     — the block array `DocumentStore.fromJSON` receives
 *   canonical.json — `DocumentStore.toJSON()` of the seeded doc
 *   update.b64     — `encodeStateAsUpdate()` of the seeded doc, base64
 *
 * plus `manifest.json` (case names + one-line descriptions). The folder is
 * shared: this script owns ONLY the case directories it lists (current and
 * previously-manifested) and manifest.json, and never removes anything else.
 *
 * LOCKSTEP MECHANISM. The C# `YDocConverter` (Blok.Server/Collab) mirrors two
 * client modules law-for-law: `YBlockSerializer` (value rules) and
 * `DocumentStore.toJSON/fromJSON` (hierarchy laws). These fixtures are the
 * contract between them, the way tickets.json is for the ticket verifier:
 *
 *   - they are produced ONLY here, by running the REAL client code from src/
 *     (bundled with esbuild, never re-implemented);
 *   - the JS pin (`collab-fixtures.freshness.test.ts`) replays update.b64 and
 *     re-serializes input.json against the committed canonical.json, so a
 *     client change that alters the format goes red in the JS suite;
 *   - the C# pin (`YDocConverterConformanceTests`) seeds from input.json,
 *     applies update.b64, and round-trips through its own encoder, comparing
 *     to canonical.json, so a server that stops mirroring goes red there.
 *
 * Both CIs are therefore red on any unilateral drift. When the client format
 * changes ON PURPOSE, regenerate (`node scripts/generate-collab-fixtures.mjs`),
 * commit the fixtures, and update the converter in the same change.
 *
 * Generation is NOT byte-deterministic: row keys are nanoid, and the Yjs
 * client id is random. The law is JSON-level equality against canonical.json,
 * never byte equality of update.b64.
 *
 * Doc-only cases (a `mutate` step below) reproduce doc shapes that concurrent
 * editing can create but `fromJSON` never does — a duplicated grid row key, a
 * bare legacy row array. For those, input.json is canonical.json itself: the
 * malformation exists only inside update.b64, and the JSON→doc direction is
 * pinned by the round-trip law instead.
 */
import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as Y from 'yjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_ROOT = join(REPO_ROOT, 'test', 'unit', 'server-conformance', 'fixtures', 'collab');
const BUNDLE_DIR = join(REPO_ROOT, 'node_modules', '.cache', 'blok-collab-fixtures');

/**
 * Bundle the client modules with esbuild (the same tool the vendor build
 * scripts use) and import the result. `packages: 'external'` keeps `yjs`
 * resolving to node_modules, so the store and this script share ONE yjs
 * instance — the mutate steps hand it prelim Y types.
 */
async function loadClient() {
  const modulePath = (name) => JSON.stringify(join(REPO_ROOT, 'src', 'components', 'modules', 'yjs', name));
  const outfile = join(BUNDLE_DIR, 'client.mjs');

  mkdirSync(BUNDLE_DIR, { recursive: true });
  await build({
    stdin: {
      contents:
        `export { DocumentStore } from ${modulePath('document-store.ts')};\n` +
        `export { YBlockSerializer, GRID_ORDER_KEY, GRID_ROWS_KEY } from ${modulePath('serializer.ts')};\n`,
      resolveDir: REPO_ROOT,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outfile,
    logLevel: 'silent',
  });

  return import(`${outfile}?t=${Date.now()}`);
}

const paragraph = (id, text, extra = {}) => ({ id, type: 'paragraph', data: { text }, ...extra });

/**
 * One entry per fixture directory. `input` is what fromJSON receives; an
 * optional `mutate(store, client)` runs afterwards inside a transaction and
 * makes the case doc-only (see the header).
 */
const CASES = [
  {
    name: 'nested-data-maps',
    description: 'nested data objects become nested Y.Maps at any depth; empty objects and null leaves survive',
    input: [
      {
        id: 'n1',
        type: 'paragraph',
        data: {
          text: 'Styled',
          style: { color: '#ff0000', font: { family: 'Inter', weight: 600 } },
          meta: {},
        },
      },
      {
        id: 'n2',
        type: 'callout',
        data: {
          title: 'Note',
          icon: { emoji: '💡', set: 'native' },
          flags: { pinned: true, archived: false, note: null },
        },
      },
    ],
  },
  {
    name: 'keyed-grid',
    description: 'arrays of arrays take the keyed __rows/__rowKeys shape; empty rows and [[],[]] stay grids; grids nest',
    input: [
      {
        id: 'g1',
        type: 'table',
        data: { withHeadings: true, content: [[{ text: 'A1' }, { text: 'B1' }], [{ text: 'A2' }, { text: 'B2' }]] },
      },
      { id: 'g2', type: 'table', data: { withHeadings: false, content: [[{ text: 'only' }], []] } },
      { id: 'g3', type: 'table', data: { content: [[], []] } },
      { id: 'g4', type: 'matrix', data: { cells: [['a', 'b'], ['c']] } },
      { id: 'g5', type: 'cube', data: { layers: [[[{ v: 1 }], [{ v: 2 }]], [[{ v: 3 }]]] } },
    ],
  },
  {
    name: 'array-kinds',
    description: 'convertible arrays (all objects) become Y.Arrays; primitive, mixed and empty arrays stay atomic leaves',
    input: [
      {
        id: 'a1',
        type: 'widget',
        data: {
          strings: ['x', 'y'],
          empty: [],
          mixed: [1, { a: 1 }],
          withNull: [null, 'z'],
          numbers: [1, -2, 2.5, 0.1, 1099511627776, 0, 1e21],
          booleans: [true, false],
          objects: [{ k: 'one', n: 1 }, { k: 'two', nested: { deep: [1, 2] } }],
          emptyObjectsInArray: [{}, {}],
          arraysAndScalars: [[1], 'x'],
        },
      },
    ],
  },
  {
    name: 'tunes',
    description: 'tunes are emitted only when the Y.Map is non-empty; {} and absent both read back as absent',
    input: [
      paragraph('t1', 'with tunes', { tunes: { anchor: 'intro', alignment: { value: 'center' }, tags: ['a', 'b'] } }),
      paragraph('t2', 'empty tunes', { tunes: {} }),
      paragraph('t3', 'no tunes'),
    ],
  },
  {
    name: 'hierarchy-3-deep',
    description: 'flat order is DFS from root through contentIds, independent of input order',
    input: [
      paragraph('root-1', 'first root'),
      { id: 'toggle-1', type: 'toggle', data: { text: 'Toggle' }, content: ['child-a', 'child-b'] },
      paragraph('grand-2', 'A.2', { parent: 'child-a', content: ['great-1'] }),
      paragraph('child-b', 'B', { parent: 'toggle-1' }),
      paragraph('great-1', 'A.2.i', { parent: 'grand-2' }),
      paragraph('child-a', 'A', { parent: 'toggle-1', content: ['grand-1', 'grand-2'] }),
      paragraph('grand-1', 'A.1', { parent: 'child-a' }),
      paragraph('root-2', 'last root'),
    ],
  },
  {
    name: 'cycle',
    description: 'parent cycles: the smallest id keeps its parent, the rest go to root; a self-parent is always broken',
    input: [
      paragraph('anchor', 'root anchor', { content: ['q'] }),
      paragraph('q', 'Q', { parent: 'p', content: ['p'] }),
      paragraph('p', 'P', { parent: 'q', content: ['q'] }),
      paragraph('c3-b', 'B', { parent: 'c3-c', content: ['c3-a'] }),
      paragraph('c3-c', 'C', { parent: 'c3-a', content: ['c3-b'] }),
      paragraph('c3-a', 'A', { parent: 'c3-b', content: ['c3-c'] }),
      paragraph('selfie', 'self parent', { parent: 'selfie', content: ['selfie'] }),
      paragraph('tail', 'hangs off the cycle', { parent: 'p' }),
    ],
  },
  {
    name: 'duplicate-id',
    description: 'an id in two order arrays is emitted at its first PARENT-AGREEING occurrence; repeats in one array are kept',
    input: [
      paragraph('pa', 'parent A', { content: ['late', 'shared', 'twice', 'twice'] }),
      paragraph('pb', 'parent B', { content: ['shared', 'late'] }),
      paragraph('shared', 'listed under both, belongs to A', { parent: 'pa' }),
      paragraph('late', 'listed first under A, belongs to B', { parent: 'pb' }),
      paragraph('twice', 'listed twice under A', { parent: 'pa' }),
      paragraph('dup-root', 'first definition'),
      paragraph('dup-root', 'second definition wins the map entry'),
    ],
  },
  {
    name: 'orphans',
    description: 'unreached blocks append in two sorted passes: tops (no parent entry) first, then the rest; sort is UTF-16 code-unit order',
    input: [
      paragraph('holder', 'root that lists no children'),
      paragraph('root-x', 'second root'),
      paragraph('z-top', 'dangling parent, sorts first', { parent: 'ghost-1', content: ['z-kid'] }),
      paragraph('z-kid', 'child of a dangling top', { parent: 'z-top' }),
      paragraph('é-top', 'latin-1 id', { parent: 'ghost-2' }),
      paragraph('😀-top', 'surrogate-pair id sorts before fullwidth', { parent: 'ghost-3' }),
      paragraph('Ａ-top', 'fullwidth id sorts last by code unit', { parent: 'ghost-4' }),
      paragraph('held', 'parent exists but never listed it', { parent: 'holder', content: ['held-kid'] }),
      paragraph('held-kid', 'reached through its orphan parent', { parent: 'held' }),
      paragraph('zz-orphan', 'orphan whose child sorts before it', { parent: 'holder', content: ['aa-kid'] }),
      paragraph('aa-kid', 'emitted before its own parent in pass two', { parent: 'zz-orphan' }),
    ],
  },
  {
    name: 'dangling',
    description: 'a parentId with no map entry is kept; a content id with no map entry is kept in content and skipped in order',
    input: [
      paragraph('d-root', 'root', { content: ['present', 'missing-child'] }),
      paragraph('present', 'present child', { parent: 'd-root' }),
      paragraph('stray', 'parent never arrived', { parent: 'not-yet-arrived' }),
    ],
  },
  {
    name: 'parent-null',
    description: 'parent: null is written as a doc-side null, reads back as no parent, and is NOT in the root order (orphan tail)',
    input: [
      paragraph('first', 'first root'),
      paragraph('nullish', 'parent: null', { parent: null }),
      paragraph('last', 'last root'),
    ],
  },
  {
    name: 'edit-metadata',
    description: 'lastEditedAt survives only as a number, lastEditedBy only as a string',
    input: [
      paragraph('m1', 'edited', { lastEditedAt: 1735689600000, lastEditedBy: 'user-42' }),
      paragraph('m2', 'only at', { lastEditedAt: 1735689600001 }),
      paragraph('m3', 'only by', { lastEditedBy: 'user-7' }),
      paragraph('m4', 'null by is dropped', { lastEditedAt: 1735689600002, lastEditedBy: null }),
    ],
  },
  {
    name: 'paragraph-normalization',
    description: 'an empty paragraph data {} becomes { text: "" }; other tools and non-empty paragraphs are untouched',
    input: [
      { id: 'p-empty', type: 'paragraph', data: {} },
      { id: 'h-empty', type: 'header', data: {} },
      paragraph('p-text', 'kept'),
      { id: 'p-other', type: 'paragraph', data: { alignment: 'left' } },
    ],
  },
  {
    name: 'unicode-text',
    description: 'non-ASCII text, emoji (incl. ZWJ sequences), combining marks, RTL and escapes in values, keys and ids',
    input: [
      paragraph('u1', 'Привет, мир! 你好，世界 🌍✨ 👨‍👩‍👧‍👦 é (é) שלום مرحبا'),
      paragraph('u2', 'tabs\tand\nnewlines\r\nand "quotes" \\ backslashes <b>&amp;</b>'),
      { id: 'u-🙂', type: 'paragraph', data: { '🔑': 'emoji key', 'ключ': 'cyrillic key' } },
    ],
  },
  {
    name: 'content-string-code-points',
    description: 'a string content spreads by code point (Y.Array.from): a surrogate pair is one entry, a combining sequence stays two',
    input: [
      { id: 'cp', type: 'widget', data: { k: 1 }, content: 'a😀e\u0301' },
    ],
  },
  {
    name: 'database-rows',
    description: 'arrays of plain objects (schema, views, options) are element-wise Y.Arrays, never grids; rows are child blocks',
    input: [
      {
        id: 'db',
        type: 'database',
        data: {
          name: 'Tasks',
          schema: [
            { id: 'title', name: 'Title', type: 'title' },
            {
              id: 'status',
              name: 'Status',
              type: 'select',
              options: [{ id: 'todo', label: 'To do' }, { id: 'done', label: 'Done' }],
            },
          ],
          views: [{ id: 'v1', type: 'table', visible: ['title', 'status'] }],
        },
        content: ['row-1', 'row-2'],
      },
      {
        id: 'row-1',
        type: 'database-row',
        data: { properties: { title: 'Write fixtures', status: 'done', tags: [] } },
        parent: 'db',
        content: ['row-1-body'],
      },
      paragraph('row-1-body', 'body text', { parent: 'row-1' }),
      {
        id: 'row-2',
        type: 'database-row',
        data: { properties: { title: 'Ship', status: 'todo', tags: ['a'] } },
        parent: 'db',
      },
    ],
  },
  {
    name: 'grid-normalization',
    description: 'doc-only: duplicated row key → first wins; key without a row → dropped; rows absent from the order → appended sorted by key',
    input: [
      { id: 'grid', type: 'table', data: { content: [[{ text: 'r1' }], [{ text: 'r2' }]] } },
    ],
    mutate(store, client, serializer) {
      const grid = store.getBlockById('grid').get('data').get('content');
      const rows = grid.get(client.GRID_ROWS_KEY);
      const order = grid.get(client.GRID_ORDER_KEY);
      const [firstKey] = order.toArray();

      order.push([firstKey]);
      order.insert(1, ['stray-key']);
      rows.set('zz-orphan-row', serializer.plainToYValue([{ text: 'orphan z' }]));
      rows.set('aa-orphan-row', serializer.plainToYValue([{ text: 'orphan a' }]));
    },
  },
  {
    name: 'legacy-bare-grid',
    description: 'doc-only: a bare Y.Array of row Y.Arrays (pre-keyed docs) still reads back as rows',
    input: [
      { id: 'legacy', type: 'table', data: { content: [] } },
    ],
    mutate(store) {
      const cell = (text) => {
        const map = new Y.Map();

        map.set('text', text);

        return map;
      };
      const row = (...cells) => {
        const array = new Y.Array();

        array.push(cells);

        return array;
      };
      const rows = new Y.Array();

      rows.push([row(cell('legacy a1'), cell('legacy b1')), row(cell('legacy a2'))]);
      store.getBlockById('legacy').get('data').set('content', rows);
    },
  },
  {
    name: 'empty-doc',
    description: 'an empty block list seeds an empty doc',
    input: [],
  },
  {
    name: 'malformed-blocks',
    description: 'a non-string id is skipped entirely; non-string content entries and parents pass through the type checks',
    input: [
      { id: 42, type: 'paragraph', data: { text: 'numeric id is skipped' } },
      paragraph('keeper', 'kept', { content: [7, 'kid'] }),
      paragraph('kid', 'kid', { parent: 'keeper' }),
      paragraph('num-parent', 'numeric parent reads as no parent', { parent: 42 }),
    ],
  },
  {
    name: 'proto-key',
    // Written through JSON.parse on purpose: a `__proto__` key in an object
    // LITERAL invokes the prototype setter and never becomes an own property,
    // so a literal here would generate an empty fixture that pins nothing.
    description: 'a __proto__ key is an ordinary own key in data, tunes and nested objects; other Object.prototype names are ordinary too',
    input: JSON.parse(`[
      {
        "id": "pk1",
        "type": "widget",
        "data": { "__proto__": "in data", "kept": 1, "nested": { "__proto__": 2, "k": 3 } },
        "tunes": { "__proto__": "in tunes", "anchor": "intro" }
      },
      {
        "id": "pk2",
        "type": "widget",
        "data": { "__proto__": { "polluted": true }, "constructor": 1, "hasOwnProperty": 2, "toString": 3 }
      },
      {
        "id": "pk3",
        "type": "widget",
        "data": { "rows": [{ "__proto__": "in an array element" }, { "__proto__": "and another" }] }
      }
    ]`),
  },
  {
    name: 'lenient-seed',
    description: 'malformed records fromJSON tolerates: Object.entries leniency for data/tunes, iterable content, non-object entries skipped',
    input: [
      { id: 'l-data-array', type: 'widget', data: ['a', 'b'] },
      { id: 'l-data-string', type: 'widget', data: 'abc' },
      { id: 'l-data-number', type: 'widget', data: 5 },
      { id: 'l-data-boolean', type: 'widget', data: true },
      { id: 'l-data-empty-array', type: 'widget', data: [] },
      { id: 'l-para-number', type: 'paragraph', data: 5 },
      { id: 'l-para-empty-array', type: 'paragraph', data: [] },
      { id: 'l-tunes-array', type: 'widget', data: { a: 1 }, tunes: ['x'] },
      { id: 'l-tunes-string', type: 'widget', data: { a: 1 }, tunes: 'ab' },
      { id: 'l-tunes-number', type: 'widget', data: { a: 1 }, tunes: 5 },
      { id: 'l-content-string', type: 'widget', data: { a: 1 }, content: 'abc' },
      { id: 'l-content-null', type: 'widget', data: { a: 1 }, content: null },
      'a bare string entry is skipped',
      42,
      [],
    ],
  },
  {
    name: 'malformed-doc-blocks',
    // Shapes only a foreign writer can put in the doc; both readers must stay
    // total on them. Levels count on the PLAIN shape: a value directly inside
    // data is level 1, each enclosing object or array adds one, a keyed grid
    // is one level.
    description: 'doc-only: a block whose id or type is not a string, or whose data is not a map, is skipped on export (its order slot with it); a value nested past 256 levels exports as null',
    input: [
      paragraph('keeper-1', 'first kept'),
      { id: 'deep', type: 'widget', data: {} },
      paragraph('keeper-2', 'last kept'),
    ],
    mutate(store) {
      const raw = (fields) => {
        const map = new Y.Map();

        for (const [key, value] of Object.entries(fields)) {
          map.set(key, value);
        }

        return map;
      };

      store.blocksMap.set('string-data', raw({ id: 'string-data', type: 'paragraph', data: 'junk', contentIds: new Y.Array() }));
      store.blocksMap.set('numeric-id', raw({ id: 42, type: 'paragraph', data: new Y.Map(), contentIds: new Y.Array() }));
      store.blocksMap.set('numeric-type', raw({ id: 'numeric-type', type: 7, data: new Y.Map(), contentIds: new Y.Array() }));
      store.rootOrder.insert(1, ['string-data', 'numeric-id', 'numeric-type']);

      // One integrated map per step, so yjs itself never recurses.
      let current = store.getBlockById('deep').get('data');

      for (let level = 0; level < 300; level++) {
        const next = new Y.Map();

        current.set('n', next);
        current = next;
      }

      current.set('leaf', 'past the cap');
    },
  },
];

const deepEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function toBase64Lines(bytes) {
  const base64 = Buffer.from(bytes).toString('base64');
  const lines = base64.match(/.{1,76}/g) ?? [''];

  return `${lines.join('\n')}\n`;
}

/**
 * Case names the previous run wrote, so a case dropped from CASES does not
 * leave a stale directory behind. Nothing outside those names is touched.
 */
function previousCaseNames() {
  const manifestPath = join(FIXTURE_ROOT, 'manifest.json');

  if (!existsSync(manifestPath)) {
    return [];
  }

  return JSON.parse(readFileSync(manifestPath, 'utf8')).cases.map((entry) => entry.name);
}

async function main() {
  const client = await loadClient();
  const names = new Set();

  mkdirSync(FIXTURE_ROOT, { recursive: true });

  for (const name of new Set([...previousCaseNames(), ...CASES.map((entry) => entry.name)])) {
    rmSync(join(FIXTURE_ROOT, name), { recursive: true, force: true });
  }

  for (const testCase of CASES) {
    if (names.has(testCase.name)) {
      throw new Error(`generate-collab-fixtures: duplicate case name "${testCase.name}"`);
    }

    names.add(testCase.name);

    const serializer = new client.YBlockSerializer();
    const store = new client.DocumentStore(serializer);

    store.fromJSON(testCase.input);

    if (testCase.mutate !== undefined) {
      store.transact(() => testCase.mutate(store, client, serializer), 'local');
    }

    const canonical = store.toJSON();
    const update = store.encodeStateAsUpdate();
    const input = testCase.mutate === undefined ? testCase.input : canonical;

    // Generator-side sanity: the three laws the pins assert, checked before
    // anything is written.
    const replayed = new client.DocumentStore(new client.YBlockSerializer());

    replayed.applyRemoteUpdate(update);

    if (!deepEqual(replayed.toJSON(), canonical)) {
      throw new Error(`generate-collab-fixtures: "${testCase.name}" does not replay to its own canonical output`);
    }

    const reseeded = new client.DocumentStore(new client.YBlockSerializer());

    reseeded.fromJSON(canonical);

    if (!deepEqual(reseeded.toJSON(), canonical)) {
      throw new Error(`generate-collab-fixtures: "${testCase.name}" does not round-trip through fromJSON/toJSON`);
    }

    const directory = join(FIXTURE_ROOT, testCase.name);

    mkdirSync(directory);
    writeJson(join(directory, 'input.json'), input);
    writeJson(join(directory, 'canonical.json'), canonical);
    writeFileSync(join(directory, 'update.b64'), toBase64Lines(update), 'utf8');
  }

  writeJson(join(FIXTURE_ROOT, 'manifest.json'), {
    generatedBy: 'scripts/generate-collab-fixtures.mjs',
    cases: CASES.map(({ name, description }) => ({ name, description })),
  });

  console.log(`Wrote ${CASES.length} collab fixture cases to test/unit/server-conformance/fixtures/collab`);
}

await main();
