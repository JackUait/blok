import type { OutputData } from '../../../../types';

/*
 * A database whose rows show every computed kind: formula, self-relation
 * back-links, rollup, a rollup over another database's formula, unique ID,
 * created and edited time and person, an anonymous answer, a template, a
 * cross-document rollup and a broken formula. No now() and UTC instants only,
 * so every runtime's clock and zone give the same values.
 */
export const COMPUTED_DB: OutputData = {
  blocks: [
    {
      id: 'db',
      type: 'database',
      data: {
        title: 'Tasks',
        schema: [
          { id: 't', name: 'Name', type: 'title', position: 'a0' },
          { id: 'n', name: 'Est', type: 'number', position: 'a1' },
          { id: 'f', name: 'Double', type: 'formula', position: 'a2', formula: { expression: 'prop("Est") * 2' } },
          { id: 'ft', name: 'Label', type: 'formula', position: 'a3', formula: { expression: 'prop("Name") + "!"' } },
          { id: 'rel', name: 'Parent', type: 'relation', position: 'a4', relation: { targetDatabaseId: 'db' } },
          { id: 'ru', name: 'Sum', type: 'rollup', position: 'a5', rollup: { relationPropertyId: 'rel', targetPropertyId: 'n', function: 'sum' } },
          { id: 'ct', name: 'Created', type: 'createdTime', position: 'a6' },
          { id: 'cb', name: 'Creator', type: 'createdBy', position: 'a7' },
          { id: 'lt', name: 'Edited', type: 'lastEditedTime', position: 'a8' },
          { id: 'lb', name: 'Editor', type: 'lastEditedBy', position: 'a9' },
          { id: 'uid', name: 'ID', type: 'uniqueId', position: 'b0', uniqueId: { prefix: 'T' } },
          { id: 'xrel', name: 'Remote', type: 'relation', position: 'b1', relation: { targetDatabaseId: 'remote-db', targetDocumentId: 'other-doc' } },
          { id: 'xru', name: 'Remote count', type: 'rollup', position: 'b2', rollup: { relationPropertyId: 'xrel', targetPropertyId: 'x', function: 'count' } },
          { id: 'bad', name: 'Broken', type: 'formula', position: 'b3', formula: { expression: 'prop("Nope") +' } },
        ],
        views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', filters: [], sorts: [], visibleProperties: [] }],
        activeViewId: 'v1',
      },
      content: ['r1', 'r2', 'r3', 'tpl'],
    },
    {
      id: 'r1', type: 'database-row', parent: 'db',
      data: { title: 'One', properties: { t: 'Stale mirror', n: 21, rel: [{ id: 'r2' }], xrel: [{ id: 'remote-1' }] }, position: 'a0' },
      createdAt: Date.UTC(2026, 0, 2, 3, 4, 5), createdBy: 'u1', lastEditedAt: Date.UTC(2026, 1, 3, 4, 5, 6), lastEditedBy: 'u2',
    },
    {
      id: 'r2', type: 'database-row', parent: 'db',
      data: { title: 'Two', properties: { t: 'Two', n: 5 }, position: 'a1' },
      createdAt: Date.UTC(2026, 0, 3), createdBy: 'u1', lastEditedAt: Date.UTC(2026, 0, 3), lastEditedBy: 'u1',
    },
    {
      id: 'r3', type: 'database-row', parent: 'db',
      data: { title: 'Three', properties: { t: 'Three', n: 1 }, position: 'a2', anonymous: true },
      createdAt: Date.UTC(2026, 0, 4), createdBy: 'u3', lastEditedAt: Date.UTC(2026, 0, 4), lastEditedBy: 'u3',
    },
    {
      id: 'tpl', type: 'database-row', parent: 'db',
      data: { title: 'Template', properties: { t: 'Template', n: 100 }, position: 'a3', template: true },
      createdAt: Date.UTC(2026, 0, 1),
    },
    {
      id: 'db2',
      type: 'database',
      data: {
        title: 'Projects',
        schema: [
          { id: 't2', name: 'Name', type: 'title', position: 'a0' },
          { id: 'link', name: 'Tasks', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db' } },
          { id: 'total', name: 'Total', type: 'rollup', position: 'a2', rollup: { relationPropertyId: 'link', targetPropertyId: 'f', function: 'sum' } },
        ],
        views: [{ id: 'v2', name: 'Table', type: 'table', position: 'a0', filters: [], sorts: [], visibleProperties: [] }],
        activeViewId: 'v2',
      },
      content: ['s1'],
    },
    {
      id: 's1', type: 'database-row', parent: 'db2',
      data: { title: 'Launch', properties: { t2: 'Launch', link: [{ id: 'r1' }, { id: 'r2' }] }, position: 'a0' },
      createdAt: Date.UTC(2026, 0, 5),
    },
  ],
};

const REMOTE = { unavailable: 'Rolls up a database in another document. Not computed here.' };

/** What a read shows in `computed` for each row of COMPUTED_DB. */
export const COMPUTED_DB_EXPECTED: Record<string, Record<string, unknown>> = {
  r1: {
    f: 42, ft: 'One!', rel: [{ id: 'r2' }], ru: 5,
    ct: '2026-01-02T03:04:05.000Z', cb: [{ id: 'u1' }], lt: '2026-02-03T04:05:06.000Z', lb: [{ id: 'u2' }],
    uid: 'T-1', xrel: [{ id: 'remote-1' }], xru: REMOTE,
  },
  r2: {
    f: 10, ft: 'Two!', rel: [{ id: 'r1' }], ru: 21,
    ct: '2026-01-03T00:00:00.000Z', cb: [{ id: 'u1' }], lt: '2026-01-03T00:00:00.000Z', lb: [{ id: 'u1' }],
    uid: 'T-2', xrel: [], xru: REMOTE,
  },
  r3: {
    f: 2, ft: 'Three!', rel: [], ru: null,
    ct: '2026-01-04T00:00:00.000Z', cb: [], lt: '2026-01-04T00:00:00.000Z', lb: [],
    uid: 'T-3', xrel: [], xru: REMOTE,
  },
  s1: { link: [{ id: 'r1' }, { id: 'r2' }], total: 52 },
};
