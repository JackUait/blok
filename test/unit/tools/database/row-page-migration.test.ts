import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryAllByAttribute, within } from '@testing-library/dom';
import type { API, BlockAPI, BlockToolConstructorOptions, OutputData } from '../../../../types';
import type { DatabaseAdapter, DatabaseData, DatabaseRowData, DatabaseRowPages } from '../../../../src/tools/database/types';
import { DatabaseTool } from '../../../../src/tools/database';
import { DatabaseRowTool } from '../../../../src/tools/database-row';
import { equalsOutputData } from '../../../../src/shared/output-data';

interface NestedEditorConfig {
  holder: HTMLElement;
  data?: OutputData;
  onChange: () => Promise<void>;
}

const nestedEditor = vi.hoisted((): {
  configs: NestedEditorConfig[];
  savePayload: OutputData;
  saveResults: Array<Promise<OutputData>>;
} => ({
  configs: [],
  savePayload: { blocks: [] },
  saveResults: [],
}));

vi.mock('../../../../src/blok', () => ({
  Blok: class MockBlok {
    readonly isReady = Promise.resolve();
    readonly i18n = { update: vi.fn(async () => {}) };

    constructor(config: NestedEditorConfig) {
      nestedEditor.configs.push(config);
    }

    save(): Promise<OutputData> {
      return nestedEditor.saveResults.shift() ?? Promise.resolve(nestedEditor.savePayload);
    }

    destroy(): void {}
  },
}));

type CopyReceipt = Awaited<ReturnType<DatabaseRowPages['copyFromLegacy']>>;
type CopyRequest = Parameters<DatabaseRowPages['copyFromLegacy']>[0];
type RowPages = DatabaseRowPages;

const body = (text: string): OutputData => ({
  blocks: [{ id: 'body-p', type: 'paragraph', data: { text } }],
});

const schema: DatabaseData['schema'] = [
  { id: 'prop-title', name: 'Title', type: 'title', position: 'a0' },
  { id: 'prop-status', name: 'Status', type: 'select', position: 'a1', config: {
    options: [{ id: 'opt-todo', label: 'Todo', position: 'a0' }],
  } },
  { id: 'prop-body', name: 'Details', type: 'richText', position: 'a2' },
];

const databaseData: DatabaseData = {
  schema,
  views: [{
    id: 'view-1', name: 'Board', type: 'board', position: 'a0',
    groupBy: 'prop-status', sorts: [], filters: [], visibleProperties: [],
  }],
  activeViewId: 'view-1',
};

const deferred = <T>(): { promise: Promise<T>; resolve(value: T): void; reject(reason: Error): void } => {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((reason: Error) => void) | undefined;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });

  return {
    promise,
    resolve(value) {
      if (resolve === undefined) throw new Error('deferred promise was not initialized');
      resolve(value);
    },
    reject(reason) {
      if (reject === undefined) throw new Error('deferred promise was not initialized');
      reject(reason);
    },
  };
};

const createAPI = (getChildren: () => BlockAPI[]): API => ({
  styles: {
    block: 'blok-block',
    inlineToolbar: 'blok-inline-toolbar',
    inlineToolButton: 'blok-inline-tool-button',
    inlineToolButtonActive: 'blok-inline-tool-button--active',
    input: 'blok-input',
    loader: 'blok-loader',
    button: 'blok-button',
    settingsButton: 'blok-settings-button',
    settingsButtonActive: 'blok-settings-button--active',
  },
  i18n: { t: (key: string) => key === 'tools.stub.error' ? 'Error' : key },
  events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  blocks: {
    getCurrentBlockIndex: vi.fn().mockReturnValue(0),
    getBlocksCount: vi.fn().mockReturnValue(1),
    getChildren: vi.fn(getChildren),
    getBlockIndex: vi.fn().mockReturnValue(0),
    delete: vi.fn(),
  },
  notifier: { show: vi.fn() },
  tools: { getBlockTools: vi.fn(() => []), getToolsConfig: vi.fn(() => ({ tools: undefined })) },
} as unknown as API);

const openLegacyRowWithBody = async (
  rowPages: RowPages,
  legacy: OutputData,
  onRowWrite?: (data: DatabaseRowData) => void,
  adapter?: DatabaseAdapter,
  database: DatabaseData = databaseData,
  secondRow = false,
): Promise<{
  tool: DatabaseTool;
  databaseElement: HTMLElement;
  editorHolder: HTMLElement;
  rowData(): DatabaseRowData;
  editBody(next: OutputData): Promise<void>;
  projectPeerBody(next: OutputData): Promise<void>;
  notifier: API['notifier'];
}> => {
  const childBlocks: BlockAPI[] = [];
  const api = createAPI(() => childBlocks);

  vi.mocked(api.blocks.delete).mockImplementation(async (index = 0) => {
    childBlocks.splice(index, 1);
  });
  const row = new DatabaseRowTool({
    data: {
      properties: {
        'prop-title': 'Row',
        'prop-status': 'opt-todo',
        ...(database.schema.some(({ type }) => type === 'richText') ? { 'prop-body': legacy } : {}),
      },
      position: 'a0',
    },
    config: {},
    api,
    block: { id: 'row-1' } as BlockAPI,
    readOnly: false,
  });
  let preservedData = row.save(document.createElement('div'));
  const rowBlock = {
    id: 'row-1',
    name: 'database-row',
    holder: document.createElement('div'),
    get preservedData() { return preservedData; },
    call: vi.fn((method: string, params?: unknown) => {
      const action = (row as unknown as Record<string, unknown>)[method];

      if (typeof action === 'function') Reflect.apply(action, row, [params]);
    }),
    dispatchChange: vi.fn(() => {
      preservedData = row.save(document.createElement('div'));
      onRowWrite?.(preservedData);
    }),
  } as unknown as BlockAPI;

  childBlocks.push(rowBlock);
  if (secondRow) {
    const otherData: DatabaseRowData = {
      properties: { 'prop-title': 'Other row', 'prop-status': 'opt-todo', 'prop-body': body('Other body') },
      position: 'a1',
    };

    childBlocks.push({
      id: 'row-2', name: 'database-row', holder: document.createElement('div'),
      preservedData: otherData, call: vi.fn(), dispatchChange: vi.fn(),
    } as unknown as BlockAPI);
  }
  const config = { adapter, rowPages };
  const options: BlockToolConstructorOptions<DatabaseData, typeof config> = {
    data: database,
    config,
    api,
    block: { id: 'database', dispatchChange: vi.fn() } as unknown as BlockAPI,
    readOnly: false,
  };
  const tool = new DatabaseTool(options);
  const element = tool.render();

  tool.rendered();
  const card = queryAllByAttribute('data-row-id', element, 'row-1')[0];

  if (card === undefined) throw new Error('row card was not rendered');
  card.click();
  const holder = queryAllByAttribute('data-blok-database-drawer-editor', element, '')[0];

  if (holder === undefined) throw new Error('drawer body was not rendered');
  await vi.waitFor(() => {
    expect(nestedEditor.configs.some(({ holder: configuredHolder }) => configuredHolder === holder)).toBe(true);
  });
  const editor = nestedEditor.configs.find(({ holder: configuredHolder }) => configuredHolder === holder);

  if (editor === undefined) throw new Error('nested editor was not constructed');

  return {
    tool,
    databaseElement: element,
    editorHolder: holder,
    rowData: () => row.save(document.createElement('div')),
    editBody: async (next) => {
      const currentEditor = nestedEditor.configs.filter(({ holder: configuredHolder }) => configuredHolder === holder).at(-1);

      if (currentEditor === undefined) throw new Error('nested editor is unavailable');
      nestedEditor.savePayload = next;
      await currentEditor.onChange();
    },
    projectPeerBody: async (next) => {
      const current = row.save(document.createElement('div'));

      row.setData({ ...current, properties: { ...current.properties, 'prop-body': next } });
      rowBlock.dispatchChange();
      const onBlockChanged = vi.mocked(api.events.on).mock.calls
        .find(([eventName]) => eventName === 'block changed')?.[1];

      if (onBlockChanged === undefined) throw new Error('row change listener was not registered');
      onBlockChanged({ event: { detail: { target: rowBlock } } });
      await Promise.resolve();
    },
    notifier: api.notifier,
  };
};

describe('database row page migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nestedEditor.configs.length = 0;
    nestedEditor.savePayload = { blocks: [] };
    nestedEditor.saveResults.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the legacy body authoritative until a matching durable page receipt arrives', async () => {
    const legacy = body('Old body');
    const latest = body('Latest body');
    const receipt = deferred<CopyReceipt>();
    const authoritativeRow: { body: OutputData; pageId?: string } = { body: legacy };
    const pages = new Map<string, OutputData>();
    const rowPages: RowPages = {
      copyFromLegacy: vi.fn(() => receipt.promise),
      mount: vi.fn(() => ({ destroy: vi.fn() })),
    };
    const harness = await openLegacyRowWithBody(rowPages, legacy);

    try {
      await harness.editBody(latest);

      expect(rowPages.copyFromLegacy).toHaveBeenCalledTimes(1);
      const request = vi.mocked(rowPages.copyFromLegacy).mock.calls[0]?.[0];

      if (request === undefined) throw new Error('copy request was not sent');
      expect(request).toMatchObject({ rowId: 'row-1', body: latest });
      expect(request.operationId.length).toBeGreaterThan(0);
      expect(harness.rowData().pageId).toBeUndefined();
      expect(harness.rowData().properties['prop-body']).toEqual(latest);
      expect(authoritativeRow.pageId).toBeUndefined();
      expect(pages.size).toBe(0);

      authoritativeRow.body = latest;
      authoritativeRow.pageId = 'row-page';
      pages.set('row-page', latest);
      receipt.resolve({ pageId: 'row-page', transactionId: 'tx-1', acceptedBody: latest });

      await vi.waitFor(() => {
        expect(harness.rowData().pageId).toBe('row-page');
      });
      expect(harness.rowData().properties['prop-body']).toEqual(latest);
      expect(authoritativeRow.pageId).toBe('row-page');
      expect(pages.get('row-page')).toEqual(latest);
      expect(rowPages.mount).toHaveBeenCalledWith('row-page', expect.any(HTMLElement));
    } finally {
      harness.tool.destroy();
    }
  });

  it('copies the newest of two edits queued before body migration starts', async () => {
    const first = body('First edit');
    const latest = body('Latest edit');
    const firstSave = deferred<OutputData>();
    const secondSave = deferred<OutputData>();
    const rowPages: RowPages = {
      copyFromLegacy: vi.fn(async ({ body: acceptedBody }: CopyRequest) => ({
        pageId: 'row-page', transactionId: 'tx-1', acceptedBody,
      })),
      mount: vi.fn(() => ({ destroy: vi.fn() })),
    };
    const harness = await openLegacyRowWithBody(rowPages, body('Old body'));

    nestedEditor.saveResults.push(firstSave.promise, secondSave.promise);
    const firstEdit = harness.editBody(first);
    const secondEdit = harness.editBody(latest);

    try {
      firstSave.resolve(first);
      await firstEdit;

      expect(rowPages.copyFromLegacy).not.toHaveBeenCalled();
      expect(harness.rowData().pageId).toBeUndefined();

      secondSave.resolve(latest);
      await secondEdit;
      await vi.waitFor(() => {
        expect(harness.rowData().pageId).toBe('row-page');
      });
      expect(harness.rowData().properties['prop-body']).toEqual(latest);
      expect(rowPages.copyFromLegacy).toHaveBeenCalledWith(expect.objectContaining({ body: latest }));
      expect(rowPages.copyFromLegacy).toHaveBeenCalledTimes(1);
    } finally {
      secondSave.resolve(latest);
      await secondEdit;
      harness.tool.destroy();
    }
  });

  it('waits for an adapter row-body write before requesting a page copy', async () => {
    const legacy = body('Old body');
    const latest = body('Latest body');
    const write = deferred<void>();
    let authoritativeBody = legacy;
    const adapter = {
      loadDatabase: vi.fn().mockResolvedValue(undefined),
      updateRow: vi.fn(async ({ rowId, properties }: Parameters<DatabaseAdapter['updateRow']>[0]) => {
        await write.promise;
        const savedBody = properties['prop-body'];

        if (savedBody === null || typeof savedBody !== 'object' || Array.isArray(savedBody)) {
          throw new Error('row body was not sent');
        }
        authoritativeBody = savedBody;
        return { id: rowId, position: 'a0', properties };
      }),
    } as unknown as DatabaseAdapter;
    const rowPages: RowPages = {
      copyFromLegacy: vi.fn(async ({ body: acceptedBody }: CopyRequest) => {
        if (!equalsOutputData(authoritativeBody, acceptedBody)) throw new Error('stale body');
        return { pageId: 'row-page', transactionId: 'tx-1', acceptedBody };
      }),
      mount: vi.fn(() => ({ destroy: vi.fn() })),
    };
    const harness = await openLegacyRowWithBody(rowPages, legacy, undefined, adapter);

    try {
      await harness.editBody(latest);

      expect(rowPages.copyFromLegacy).not.toHaveBeenCalled();
      await vi.waitFor(() => {
        expect(adapter.updateRow).toHaveBeenCalledTimes(1);
      });
      expect(rowPages.copyFromLegacy).not.toHaveBeenCalled();
      expect(harness.rowData().pageId).toBeUndefined();

      write.resolve(undefined);
      await vi.waitFor(() => {
        expect(harness.rowData().pageId).toBe('row-page');
      });
      expect(authoritativeBody).toEqual(latest);
      expect(rowPages.copyFromLegacy).toHaveBeenCalledTimes(1);
    } finally {
      harness.tool.destroy();
    }
  });

  it('does not copy a stale body after a peer reprojects the row before the adapter responds', async () => {
    const legacy = body('Old body');
    const local = body('Local body');
    const peer = body('Peer body');
    const response = deferred<void>();
    const authoritativeRow: { body: OutputData; pageId?: string } = { body: legacy };
    const pages = new Map<string, OutputData>();
    const adapter = {
      loadDatabase: vi.fn().mockResolvedValue(undefined),
      updateRow: vi.fn(async ({ rowId, properties }: Parameters<DatabaseAdapter['updateRow']>[0]) => {
        const savedBody = properties['prop-body'];

        if (savedBody === null || typeof savedBody !== 'object' || Array.isArray(savedBody)) {
          throw new Error('row body was not sent');
        }
        authoritativeRow.body = savedBody;
        await response.promise;
        return { id: rowId, position: 'a0', properties };
      }),
    } as unknown as DatabaseAdapter;
    const rowPages: RowPages = {
      copyFromLegacy: vi.fn(async ({ body: acceptedBody }: CopyRequest) => {
        authoritativeRow.pageId = 'row-page';
        pages.set('row-page', acceptedBody);
        return { pageId: 'row-page', transactionId: 'tx-1', acceptedBody };
      }),
      mount: vi.fn(() => ({ destroy: vi.fn() })),
    };
    const harness = await openLegacyRowWithBody(rowPages, legacy, undefined, adapter);

    try {
      await harness.editBody(local);
      await vi.waitFor(() => {
        expect(adapter.updateRow).toHaveBeenCalledTimes(1);
      });
      expect(authoritativeRow.body).toEqual(local);

      authoritativeRow.body = peer;
      await harness.projectPeerBody(peer);
      expect(harness.rowData().properties['prop-body']).toEqual(peer);
      expect(harness.editorHolder.hasAttribute('inert')).toBe(true);

      response.resolve(undefined);
      await vi.waitFor(() => {
        expect(harness.editorHolder.hasAttribute('inert')).toBe(false);
      });
      expect(pages.size).toBe(0);
      expect(rowPages.copyFromLegacy).not.toHaveBeenCalled();
      expect(authoritativeRow.pageId).toBeUndefined();
      expect(authoritativeRow.body).toEqual(peer);
      expect(harness.rowData().pageId).toBeUndefined();
      expect(harness.rowData().properties['prop-body']).toEqual(peer);
    } finally {
      response.resolve(undefined);
      harness.tool.destroy();
    }
  });

  it('waits for default body-property creation and its adapter row write before copying', async () => {
    const latest = body('Latest body');
    const creation = deferred<Parameters<DatabaseAdapter['createProperty']>[0]>();
    const write = deferred<void>();
    let bodyPropertyId: string | undefined;
    let createdProperty: Parameters<DatabaseAdapter['createProperty']>[0] | undefined;
    let authoritativeBody: OutputData = { blocks: [] };
    const adapter = {
      loadDatabase: vi.fn().mockResolvedValue(undefined),
      createProperty: vi.fn(() => creation.promise),
      updateRow: vi.fn(async ({ rowId, properties }: Parameters<DatabaseAdapter['updateRow']>[0]) => {
        await write.promise;
        const savedBody = bodyPropertyId === undefined ? undefined : properties[bodyPropertyId];

        if (savedBody === null || typeof savedBody !== 'object' || Array.isArray(savedBody)) {
          throw new Error('created body property was not sent');
        }
        authoritativeBody = savedBody;
        return { id: rowId, position: 'a0', properties };
      }),
    } as unknown as DatabaseAdapter;
    const rowPages: RowPages = {
      copyFromLegacy: vi.fn(async ({ body: acceptedBody }: CopyRequest) => {
        if (!equalsOutputData(authoritativeBody, acceptedBody)) throw new Error('stale body');
        return { pageId: 'row-page', transactionId: 'tx-1', acceptedBody };
      }),
      mount: vi.fn(() => ({ destroy: vi.fn() })),
    };
    const initialData = { ...databaseData, schema: schema.filter(({ type }) => type !== 'richText') };
    const harness = await openLegacyRowWithBody(rowPages, { blocks: [] }, undefined, adapter, initialData);

    try {
      await harness.editBody(latest);

      expect(adapter.createProperty).toHaveBeenCalledTimes(1);
      expect(adapter.updateRow).not.toHaveBeenCalled();
      expect(rowPages.copyFromLegacy).not.toHaveBeenCalled();
      createdProperty = vi.mocked(adapter.createProperty).mock.calls[0]?.[0];
      if (createdProperty === undefined) throw new Error('body property was not created');
      bodyPropertyId = createdProperty.id;
      creation.resolve(createdProperty);
      await vi.waitFor(() => {
        expect(adapter.updateRow).toHaveBeenCalledTimes(1);
      });
      expect(rowPages.copyFromLegacy).not.toHaveBeenCalled();

      write.resolve(undefined);
      await vi.waitFor(() => {
        expect(harness.rowData().pageId).toBe('row-page');
      });
      expect(authoritativeBody).toEqual(latest);
      expect(rowPages.copyFromLegacy).toHaveBeenCalledTimes(1);
    } finally {
      if (createdProperty !== undefined) creation.resolve(createdProperty);
      write.resolve(undefined);
      harness.tool.destroy();
    }
  });

  it('does not recreate a row deleted while its body property is being created', async () => {
    const latest = body('Latest body');
    const creation = deferred<Parameters<DatabaseAdapter['createProperty']>[0]>();
    const persistedRows = new Set(['row-1']);
    const adapter = {
      loadDatabase: vi.fn().mockResolvedValue(undefined),
      createProperty: vi.fn(() => creation.promise),
      updateRow: vi.fn(async ({ rowId, properties }: Parameters<DatabaseAdapter['updateRow']>[0]) => {
        persistedRows.add(rowId);
        return { id: rowId, position: 'a0', properties };
      }),
      deleteRow: vi.fn(async ({ rowId }: Parameters<DatabaseAdapter['deleteRow']>[0]) => {
        persistedRows.delete(rowId);
      }),
    } as unknown as DatabaseAdapter;
    const rowPages: RowPages = {
      copyFromLegacy: vi.fn(async ({ body: acceptedBody }: CopyRequest) => ({
        pageId: 'row-page', transactionId: 'tx-1', acceptedBody,
      })),
      mount: vi.fn(() => ({ destroy: vi.fn() })),
    };
    const initialData: DatabaseData = {
      ...databaseData,
      schema: schema.filter(({ type }) => type !== 'richText'),
      views: databaseData.views.map((view) => ({ ...view, type: 'list' })),
    };
    const harness = await openLegacyRowWithBody(rowPages, { blocks: [] }, undefined, adapter, initialData);

    try {
      await harness.editBody(latest);
      expect(adapter.createProperty).toHaveBeenCalledTimes(1);
      expect(adapter.updateRow).not.toHaveBeenCalled();

      const deleteButton = queryAllByAttribute('data-blok-database-delete-row', harness.databaseElement, '')[0];

      if (deleteButton === undefined) throw new Error('row delete button was not rendered');
      deleteButton.click();
      await vi.waitFor(() => {
        expect(adapter.deleteRow).toHaveBeenCalledWith({ rowId: 'row-1' });
        expect(persistedRows.has('row-1')).toBe(false);
      });

      const createdProperty = vi.mocked(adapter.createProperty).mock.calls[0]?.[0];

      if (createdProperty === undefined) throw new Error('body property was not created');
      creation.resolve(createdProperty);
      await vi.waitFor(() => {
        expect(harness.editorHolder.hasAttribute('inert')).toBe(false);
      });

      expect(persistedRows.has('row-1')).toBe(false);
      expect(adapter.updateRow).not.toHaveBeenCalled();
      expect(rowPages.copyFromLegacy).not.toHaveBeenCalled();
    } finally {
      harness.tool.destroy();
    }
  });

  it('keeps another row open when the copied row is deleted during page-pointer writeback', async () => {
    const legacy = body('Old body');
    const latest = body('Latest body');
    const receipt = deferred<CopyReceipt>();
    const rowPages: RowPages = {
      copyFromLegacy: vi.fn(() => receipt.promise),
      mount: vi.fn(() => ({ destroy: vi.fn() })),
    };
    const listData: DatabaseData = {
      ...databaseData,
      views: databaseData.views.map((view) => ({ ...view, type: 'list' })),
    };
    const harness = await openLegacyRowWithBody(rowPages, legacy, (data) => {
      if (data.pageId !== 'row-page') return;
      const deleteButton = queryAllByAttribute('data-blok-database-delete-row', harness.databaseElement, '')
        .find((button) => button.getAttribute('data-row-id') === 'row-1');

      if (deleteButton === undefined) throw new Error('row delete button was not rendered');
      deleteButton.click();
    }, undefined, listData, true);

    try {
      await harness.editBody(latest);
      const otherRow = queryAllByAttribute('data-blok-database-list-row', harness.databaseElement, '')
        .find((item) => item.getAttribute('data-row-id') === 'row-2');

      if (otherRow === undefined) throw new Error('other row was not rendered');
      otherRow.click();
      receipt.resolve({ pageId: 'row-page', transactionId: 'tx-1', acceptedBody: latest });
      await vi.waitFor(() => {
        if (harness.rowData().pageId !== 'row-page') throw new Error('page pointer was not written');
      });

      const drawer = queryAllByAttribute('data-blok-database-drawer', harness.databaseElement, '')[0];

      expect(drawer?.style.width).not.toBe('0px');
    } finally {
      harness.tool.destroy();
    }
  });

  it('does not request a page copy when the adapter row-body write fails', async () => {
    const legacy = body('Old body');
    const latest = body('Latest body');
    const adapter = {
      loadDatabase: vi.fn().mockResolvedValue(undefined),
      updateRow: vi.fn(async () => { throw new Error('row write failed'); }),
    } as unknown as DatabaseAdapter;
    const rowPages: RowPages = {
      copyFromLegacy: vi.fn(async ({ body: acceptedBody }: CopyRequest) => {
        if (!equalsOutputData(legacy, acceptedBody)) throw new Error('stale body');
        return { pageId: 'row-page', transactionId: 'tx-1', acceptedBody };
      }),
      mount: vi.fn(() => ({ destroy: vi.fn() })),
    };
    const harness = await openLegacyRowWithBody(rowPages, legacy, undefined, adapter);

    try {
      await harness.editBody(latest);
      await vi.waitFor(() => {
        expect(adapter.updateRow).toHaveBeenCalledTimes(1);
      });
      await vi.waitFor(() => {
        expect(harness.notifier.show).toHaveBeenCalled();
      });

      expect(rowPages.copyFromLegacy).not.toHaveBeenCalled();
      expect(harness.rowData().pageId).toBeUndefined();
      expect(harness.rowData().properties['prop-body']).toEqual(latest);
      expect(harness.editorHolder.hasAttribute('inert')).toBe(false);
    } finally {
      harness.tool.destroy();
    }
  });

  it('reports a mismatched copy receipt without switching away from the legacy body', async () => {
    const legacy = body('Old body');
    const latest = body('Latest body');
    const rowPages: RowPages = {
      copyFromLegacy: vi.fn(async () => ({
        pageId: 'row-page', transactionId: 'tx-1', acceptedBody: body('Different body'),
      })),
      mount: vi.fn(() => ({ destroy: vi.fn() })),
    };
    const harness = await openLegacyRowWithBody(rowPages, legacy);

    try {
      await harness.editBody(latest);
      await vi.waitFor(() => {
        expect(harness.notifier.show).toHaveBeenCalledTimes(1);
      });

      expect(harness.rowData().pageId).toBeUndefined();
      expect(harness.rowData().properties['prop-body']).toEqual(latest);
      expect(harness.editorHolder.hasAttribute('inert')).toBe(false);
      expect(rowPages.mount).not.toHaveBeenCalled();
    } finally {
      harness.tool.destroy();
    }
  });

  it('suspends legacy body editing while a copy is pending and resumes after refusal', async () => {
    const legacy = body('Old body');
    const latest = body('Latest body');
    const refusal = deferred<CopyReceipt>();
    const rowPages: RowPages = {
      copyFromLegacy: vi.fn(() => refusal.promise),
      mount: vi.fn(() => ({ destroy: vi.fn() })),
    };
    const harness = await openLegacyRowWithBody(rowPages, legacy);

    try {
      await harness.editBody(latest);

      expect(harness.editorHolder.hasAttribute('inert')).toBe(true);
      expect(harness.rowData().properties['prop-body']).toEqual(latest);
      refusal.reject(new Error('old client still connected'));
      await vi.waitFor(() => {
        expect(harness.notifier.show).toHaveBeenCalledTimes(1);
      });
      expect(harness.editorHolder.hasAttribute('inert')).toBe(false);
      expect(harness.rowData().pageId).toBeUndefined();
      expect(harness.rowData().properties['prop-body']).toEqual(latest);
    } finally {
      harness.tool.destroy();
    }
  });

  it('ignores a late legacy editor change while its copy is pending', async () => {
    const legacy = body('Old body');
    const sent = body('Sent body');
    const late = body('Late editor body');
    const receipt = deferred<CopyReceipt>();
    const rowPages: RowPages = {
      copyFromLegacy: vi.fn(() => receipt.promise),
      mount: vi.fn(() => ({ destroy: vi.fn() })),
    };
    const harness = await openLegacyRowWithBody(rowPages, legacy);

    try {
      await harness.editBody(sent);
      expect(harness.editorHolder.hasAttribute('inert')).toBe(true);
      await harness.editBody(late);

      expect(harness.rowData().properties['prop-body']).toEqual(sent);
      expect(rowPages.copyFromLegacy).toHaveBeenCalledTimes(1);
      receipt.resolve({ pageId: 'row-page', transactionId: 'tx-1', acceptedBody: sent });
      await vi.waitFor(() => {
        expect(harness.rowData().pageId).toBe('row-page');
      });
    } finally {
      harness.tool.destroy();
    }
  });

  it('keeps a reopened legacy drawer suspended while its copy is pending', async () => {
    const sent = body('Sent body');
    const receipt = deferred<CopyReceipt>();
    const rowPages: RowPages = {
      copyFromLegacy: vi.fn(() => receipt.promise),
      mount: vi.fn(() => ({ destroy: vi.fn() })),
    };
    const harness = await openLegacyRowWithBody(rowPages, body('Old body'));

    try {
      await harness.editBody(sent);
      const close = queryAllByAttribute('data-blok-database-drawer-close', harness.databaseElement, '')[0];

      if (close === undefined) throw new Error('drawer close button was not rendered');
      close.click();
      const card = queryAllByAttribute('data-row-id', harness.databaseElement, 'row-1')[0];

      if (card === undefined) throw new Error('row card was not rendered');
      card.click();
      const reopenedHolder = queryAllByAttribute('data-blok-database-drawer-editor', harness.databaseElement, '')[0];

      if (reopenedHolder === undefined) throw new Error('drawer body was not reopened');
      expect(reopenedHolder.hasAttribute('inert')).toBe(true);
      expect(rowPages.copyFromLegacy).toHaveBeenCalledTimes(1);

      receipt.resolve({ pageId: 'row-page', transactionId: 'tx-1', acceptedBody: sent });
      await vi.waitFor(() => {
        expect(harness.rowData().pageId).toBe('row-page');
      });
      expect(reopenedHolder.hasAttribute('inert')).toBe(false);
    } finally {
      harness.tool.destroy();
    }
  });

  it('shows a non-editable failure when a migrated page cannot mount', async () => {
    const legacy = body('Old body');
    const latest = body('Latest body');
    const rowPages: RowPages = {
      copyFromLegacy: vi.fn(async ({ body: acceptedBody }) => ({
        pageId: 'row-page', transactionId: 'tx-1', acceptedBody,
      })),
      mount: vi.fn((_pageId, holder) => {
        const partialEditor = document.createElement('div');

        partialEditor.setAttribute('contenteditable', 'true');
        holder.appendChild(partialEditor);
        throw new Error('offline page unavailable');
      }),
    };
    const harness = await openLegacyRowWithBody(rowPages, legacy);

    try {
      await harness.editBody(latest);
      await vi.waitFor(() => {
        expect(harness.rowData().pageId).toBe('row-page');
      });

      expect(queryAllByAttribute('contenteditable', harness.editorHolder, 'true')).toHaveLength(0);
      const alertText = within(harness.editorHolder).getByRole('alert').textContent;

      expect(alertText).toBe('Error');
      expect(alertText).not.toContain('offline page unavailable');
      expect(nestedEditor.configs).toHaveLength(1);
      expect(harness.rowData().properties['prop-body']).toEqual(latest);
    } finally {
      harness.tool.destroy();
    }
  });

  it('retries a lost receipt with the same operation id and one committed page', async () => {
    const legacy = body('Old body');
    const latest = body('Latest body');
    const authoritativeRow: { body: OutputData; pageId?: string } = { body: legacy };
    const pages = new Map<string, OutputData>();
    const operations = new Map<string, { body: OutputData; receipt: CopyReceipt }>();
    const rowPages: RowPages = {
      copyFromLegacy: vi.fn(async (input: CopyRequest) => {
        const previous = operations.get(input.operationId);

        if (previous !== undefined) {
          if (!equalsOutputData(previous.body, input.body)) throw new Error('changed retry');
          return previous.receipt;
        }
        if (!equalsOutputData(authoritativeRow.body, input.body)) throw new Error('stale body');
        const receipt = { pageId: 'row-page', transactionId: 'tx-1', acceptedBody: input.body };

        authoritativeRow.pageId = receipt.pageId;
        pages.set(receipt.pageId, input.body);
        operations.set(input.operationId, { body: input.body, receipt });
        throw new Error('response lost after commit');
      }),
      mount: vi.fn(() => ({ destroy: vi.fn() })),
    };
    const harness = await openLegacyRowWithBody(rowPages, legacy, (data) => {
      const savedBody = data.properties['prop-body'];

      if (savedBody !== null && typeof savedBody === 'object' && !Array.isArray(savedBody)) {
        authoritativeRow.body = savedBody;
      }
    });

    try {
      await harness.editBody(latest);

      await vi.waitFor(() => {
        expect(rowPages.copyFromLegacy).toHaveBeenCalledTimes(2);
      });
      const [first, retry] = vi.mocked(rowPages.copyFromLegacy).mock.calls.map(([input]) => input);

      if (first === undefined || retry === undefined) throw new Error('copy requests were not recorded');
      expect(retry.operationId).toBe(first.operationId);
      expect(retry.body).toEqual(first.body);
      expect(pages.size).toBe(1);
      expect(pages.get('row-page')).toEqual(latest);
      expect(authoritativeRow.pageId).toBe('row-page');
      await vi.waitFor(() => {
        expect(harness.rowData().pageId).toBe('row-page');
      });
      expect(harness.rowData().properties['prop-body']).toEqual(latest);
    } finally {
      harness.tool.destroy();
    }
  });

  it('leaves a peer body authoritative until a later local edit can be copied', async () => {
    const legacy = body('Old body');
    const first = body('First local body');
    const peer = body('Peer body');
    const latest = body('Latest local body');
    const authoritativeRow: { body: OutputData; pageId?: string } = { body: legacy };
    const pages = new Map<string, OutputData>();
    const operations = new Map<string, CopyReceipt>();
    let localWrites = 0;
    const rowPages: RowPages = {
      copyFromLegacy: vi.fn(async (input: CopyRequest) => {
        if (!equalsOutputData(authoritativeRow.body, input.body)) {
          throw new Error('authoritative row body changed');
        }
        const receipt = { pageId: 'row-page', transactionId: 'tx-1', acceptedBody: input.body };

        authoritativeRow.pageId = receipt.pageId;
        pages.set(receipt.pageId, input.body);
        operations.set(input.operationId, receipt);
        return receipt;
      }),
      mount: vi.fn(() => ({ destroy: vi.fn() })),
    };
    const harness = await openLegacyRowWithBody(rowPages, legacy, (data) => {
      const savedBody = data.properties['prop-body'];

      if (savedBody === null || typeof savedBody !== 'object' || Array.isArray(savedBody)) return;
      localWrites += 1;
      authoritativeRow.body = localWrites === 1 ? peer : savedBody;
    });

    try {
      await harness.editBody(first);
      await vi.waitFor(() => {
        expect(harness.notifier.show).toHaveBeenCalledTimes(1);
      });
      expect(harness.rowData().pageId).toBeUndefined();
      expect(authoritativeRow.body).toEqual(peer);
      expect(authoritativeRow.pageId).toBeUndefined();
      expect(pages.size).toBe(0);
      expect(operations.size).toBe(0);

      await harness.editBody(latest);
      await vi.waitFor(() => {
        expect(harness.rowData().pageId).toBe('row-page');
      });
      expect(authoritativeRow.body).toEqual(latest);
      expect(authoritativeRow.pageId).toBe('row-page');
      expect(pages.get('row-page')).toEqual(latest);
      expect(operations.size).toBe(1);
      expect(harness.rowData().properties['prop-body']).toEqual(latest);
    } finally {
      harness.tool.destroy();
    }
  });

  it('writes a migrated body through the host page without changing the legacy blob', async () => {
    const legacy = body('Old body');
    const migrated = body('Migrated body');
    const pageBodies = new Map<string, OutputData>();
    const rowPages: RowPages = {
      copyFromLegacy: vi.fn(async ({ body: acceptedBody }: CopyRequest) => {
        pageBodies.set('row-page', acceptedBody);
        return { pageId: 'row-page', transactionId: 'tx-1', acceptedBody };
      }),
      mount: vi.fn((pageId: string, holder: HTMLElement) => {
        const editor = document.createElement('div');

        editor.setAttribute('contenteditable', 'true');
        editor.addEventListener('input', () => {
          pageBodies.set(pageId, body(editor.textContent ?? ''));
        });
        holder.appendChild(editor);
        return { destroy: () => editor.remove() };
      }),
    };
    const harness = await openLegacyRowWithBody(rowPages, legacy);

    try {
      await harness.editBody(migrated);
      await vi.waitFor(() => {
        expect(harness.rowData().pageId).toBe('row-page');
      });
      const pageEditor = queryAllByAttribute('contenteditable', harness.editorHolder, 'true')[0];

      if (pageEditor === undefined) throw new Error('host page editor was not mounted');
      pageEditor.textContent = 'Page edit';
      pageEditor.dispatchEvent(new Event('input', { bubbles: true }));
      await harness.editBody(body('Stale nested edit'));

      expect(harness.rowData().properties['prop-body']).toEqual(migrated);
      expect(pageBodies.get('row-page')).toEqual(body('Page edit'));
      expect(rowPages.copyFromLegacy).toHaveBeenCalledTimes(1);
      expect(nestedEditor.configs).toHaveLength(1);
    } finally {
      harness.tool.destroy();
    }
  });

  it('leaves the row pointer and page absent when the host target write fails', async () => {
    const legacy = body('Old body');
    const latest = body('Latest body');
    const authoritativeRow: { body: OutputData; pageId?: string } = { body: legacy };
    const pages = new Map<string, OutputData>();
    const operations = new Map<string, CopyReceipt>();
    const rowPages: RowPages = {
      copyFromLegacy: vi.fn(async () => { throw new Error('target page write failed'); }),
      mount: vi.fn(() => ({ destroy: vi.fn() })),
    };
    const harness = await openLegacyRowWithBody(rowPages, legacy, (data) => {
      const savedBody = data.properties['prop-body'];

      if (savedBody !== null && typeof savedBody === 'object' && !Array.isArray(savedBody)) {
        authoritativeRow.body = savedBody;
      }
    });

    try {
      await harness.editBody(latest);
      await vi.waitFor(() => {
        expect(harness.notifier.show).toHaveBeenCalledTimes(1);
      });

      expect(authoritativeRow.body).toEqual(latest);
      expect(authoritativeRow.pageId).toBeUndefined();
      expect(pages.size).toBe(0);
      expect(operations.size).toBe(0);
      expect(harness.rowData().pageId).toBeUndefined();
      expect(harness.rowData().properties['prop-body']).toEqual(latest);
    } finally {
      harness.tool.destroy();
    }
  });

  it('requires a host live-room gate before migrating a row', async () => {
    const legacy = body('Old body');
    const attempted = body('Attempted body');
    const accepted = body('Accepted body');
    const oldClientEdit = body('Old client edit');
    const authoritativeRow: { body: OutputData; pageId?: string } = { body: legacy };
    const pages = new Map<string, OutputData>();
    const operations = new Map<string, CopyReceipt>();
    let oldClientConnected = true;
    let fenced = false;
    const writeLegacy = (next: OutputData): void => {
      if (fenced) throw new Error('legacy writer fenced');
      authoritativeRow.body = next;
    };
    const rowPages: RowPages = {
      copyFromLegacy: vi.fn(async (input: CopyRequest) => {
        if (oldClientConnected) throw new Error('old client still connected');
        if (!equalsOutputData(authoritativeRow.body, input.body)) throw new Error('stale body');
        const receipt = { pageId: 'row-page', transactionId: 'tx-1', acceptedBody: input.body };

        fenced = true;
        authoritativeRow.pageId = receipt.pageId;
        pages.set(receipt.pageId, input.body);
        operations.set(input.operationId, receipt);
        return receipt;
      }),
      mount: vi.fn(() => ({ destroy: vi.fn() })),
    };
    const harness = await openLegacyRowWithBody(rowPages, legacy, (data) => {
      if (data.pageId !== undefined) return;
      const savedBody = data.properties['prop-body'];

      if (savedBody !== null && typeof savedBody === 'object' && !Array.isArray(savedBody)) {
        writeLegacy(savedBody);
      }
    });

    try {
      await harness.editBody(attempted);
      await vi.waitFor(() => {
        expect(harness.notifier.show).toHaveBeenCalledTimes(1);
      });
      expect(harness.rowData().pageId).toBeUndefined();
      expect(authoritativeRow.pageId).toBeUndefined();
      expect(pages.size).toBe(0);
      expect(operations.size).toBe(0);

      oldClientConnected = false;
      await harness.editBody(accepted);
      await vi.waitFor(() => {
        expect(harness.rowData().pageId).toBe('row-page');
      });
      expect(authoritativeRow.pageId).toBe('row-page');
      expect(pages.get('row-page')).toEqual(accepted);
      expect(operations.size).toBe(1);
      expect(() => writeLegacy(oldClientEdit)).toThrow('legacy writer fenced');
      expect(authoritativeRow.body).toEqual(accepted);
    } finally {
      harness.tool.destroy();
    }
  });

  it('keeps the legacy body editable when the host refuses a copy', async () => {
    const legacy = body('Old body');
    const latest = body('Latest body');
    const retry = body('Retry body');
    const rowPages: RowPages = {
      copyFromLegacy: vi.fn(async () => { throw new Error('old client still connected'); }),
      mount: vi.fn(() => ({ destroy: vi.fn() })),
    };
    const harness = await openLegacyRowWithBody(rowPages, legacy);

    try {
      await harness.editBody(latest);

      await vi.waitFor(() => {
        expect(harness.notifier.show).toHaveBeenCalled();
      });
      expect(rowPages.copyFromLegacy).toHaveBeenCalledTimes(2);
      const [first, second] = vi.mocked(rowPages.copyFromLegacy).mock.calls.map(([input]) => input);

      if (first === undefined || second === undefined) throw new Error('copy requests were not recorded');
      expect(second.operationId).toBe(first.operationId);
      expect(second.body).toEqual(first.body);
      expect(harness.notifier.show).toHaveBeenCalledTimes(1);
      expect(harness.notifier.show).toHaveBeenCalledWith({ message: 'Error', style: 'error' });
      expect(harness.rowData().pageId).toBeUndefined();
      expect(harness.rowData().properties['prop-body']).toEqual(latest);
      expect(rowPages.mount).not.toHaveBeenCalled();

      await harness.editBody(retry);
      expect(harness.rowData().properties['prop-body']).toEqual(retry);
      await vi.waitFor(() => {
        expect(rowPages.copyFromLegacy).toHaveBeenCalledTimes(4);
      });
    } finally {
      harness.tool.destroy();
    }
  });
});
