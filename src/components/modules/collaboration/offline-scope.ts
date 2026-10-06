import { escapePartitionSegment } from './operation-store';

const PREFIX = 'blok-ops-';
const STORES = ['meta', 'updates', 'outbox', 'quarantine'] as const;
const LINEAGE_PATTERN = /^[0-9a-f]{32}$/;

export interface OfflinePartitionReport {
  url: string;
  doc: string;
  outbox: { count: number; bytes: number };
  quarantine: { count: number; bytes: number };
  updates: { count: number; bytes: number };
  mayHaveUnsentV1Edits: boolean;
}

export interface OfflineScopeReport {
  partitions: readonly OfflinePartitionReport[];
}

export interface OfflineScopeForgetResult {
  deletedPartitions: number;
  discarded: OfflineScopeReport;
}

interface NamedPartition {
  name: string;
  report: OfflinePartitionReport;
}

const decodeSegment = (encoded: string): string | null => {
  // Decode pipes first so a literal "%7C" stays distinct from a pipe.
  const decoded = encoded.replace(/%7C/g, '|').replace(/%25/g, '%');

  return escapePartitionSegment(decoded) === encoded ? decoded : null;
};

const parseName = (name: string): { url: string; doc: string; scope: string } | null => {
  if (!name.startsWith(PREFIX)) {
    return null;
  }

  const parts = name.slice(PREFIX.length).split('|');

  if (parts.length !== 3) {
    return null;
  }

  const [encodedUrl, encodedDoc, encodedScope] = parts;
  const url = decodeSegment(encodedUrl);
  const doc = decodeSegment(encodedDoc);
  const scope = decodeSegment(encodedScope);

  return url === null || doc === null || scope === null ? null : { url, doc, scope };
};

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise<T>((resolve, reject) => {
  request.addEventListener('success', () => resolve(request.result));
  request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')));
});

const openExisting = (factory: IDBFactory, name: string): Promise<IDBDatabase> =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(name);

    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error ?? new Error(`Cannot open ${name}`)));
    request.addEventListener('blocked', () => reject(new Error(`Opening ${name} was blocked`)));
    request.addEventListener('upgradeneeded', () => {
      request.transaction?.abort();
      reject(new Error(`Offline partition ${name} disappeared during inspection`));
    });
  });

const summarize = (rows: readonly unknown[], store: string): { count: number; bytes: number } => {
  const bytes = rows.reduce<number>((total, row) => {
    if (typeof row !== 'object' || row === null || !('bytes' in row)) {
      throw new Error(`Cannot inspect ${store} row bytes`);
    }

    const payload = row.bytes;

    if (payload instanceof ArrayBuffer || ArrayBuffer.isView(payload)) {
      return total + payload.byteLength;
    }

    throw new Error(`Cannot inspect ${store} row bytes`);
  }, 0);

  return { count: rows.length, bytes };
};

const isKnownV2Meta = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  if (!('format' in value) || !('protocol' in value) || !('lineage' in value)) {
    return false;
  }

  return value.format === 1 &&
    value.protocol === 'v2' &&
    typeof value.lineage === 'string' &&
    LINEAGE_PATTERN.test(value.lineage);
};

const inspectDatabase = async (
  factory: IDBFactory,
  name: string,
  url: string,
  doc: string
): Promise<OfflinePartitionReport> => {
  const db = await openExisting(factory, name);

  try {
    const missingStore = STORES.find((store) => !db.objectStoreNames.contains(store));

    if (missingStore !== undefined) {
      throw new Error(`Offline partition ${name} is missing ${missingStore}`);
    }

    const transaction = db.transaction([...STORES], 'readonly');
    const committed = new Promise<void>((resolve, reject) => {
      transaction.addEventListener('complete', () => resolve());
      transaction.addEventListener('abort', () => reject(transaction.error ?? new Error(`Cannot inspect ${name}`)));
      transaction.addEventListener('error', () => reject(transaction.error ?? new Error(`Cannot inspect ${name}`)));
    });
    const metaRequest: IDBRequest<unknown> = transaction.objectStore('meta').get('meta');
    const updatesRequest: IDBRequest<unknown[]> = transaction.objectStore('updates').getAll();
    const outboxRequest: IDBRequest<unknown[]> = transaction.objectStore('outbox').getAll();
    const quarantineRequest: IDBRequest<unknown[]> = transaction.objectStore('quarantine').getAll();
    const [meta, updateRows, outboxRows, quarantineRows] = await Promise.all([
      requestResult(metaRequest),
      requestResult(updatesRequest),
      requestResult(outboxRequest),
      requestResult(quarantineRequest),
      committed,
    ]);

    const updates = summarize(updateRows, 'updates');

    return {
      url,
      doc,
      outbox: summarize(outboxRows, 'outbox'),
      quarantine: summarize(quarantineRows, 'quarantine'),
      updates,
      mayHaveUnsentV1Edits: updates.count > 0 && !isKnownV2Meta(meta),
    };
  } finally {
    db.close();
  }
};

const inspectPartitions = async (offlineScope: string): Promise<NamedPartition[]> => {
  const factory = globalThis.indexedDB;

  if (factory === undefined || typeof factory.databases !== 'function') {
    throw new Error('IndexedDB databases() is required to inspect offline scope');
  }

  const databases = await factory.databases();
  const result: NamedPartition[] = [];

  for (const name of databases.map((database) => database.name).filter((value): value is string => typeof value === 'string').sort()) {
    const parsed = parseName(name);

    if (parsed === null || parsed.scope !== offlineScope) {
      continue;
    }

    result.push({
      name,
      report: await inspectDatabase(factory, name, parsed.url, parsed.doc),
    });
  }

  return result;
};

const deleteDatabase = (factory: IDBFactory, name: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const request = factory.deleteDatabase(name);

    request.addEventListener('success', () => resolve());
    request.addEventListener('error', () => reject(request.error ?? new Error(`Cannot delete ${name}`)));
  });

export const inspectOfflineScope = async (offlineScope: string): Promise<OfflineScopeReport> => ({
  partitions: (await inspectPartitions(offlineScope)).map(({ report }) => report),
});

export const forgetOfflinePartitions = async (
  offlineScope: string,
  select: (partition: OfflinePartitionReport) => boolean,
  options: { discardPending: true }
): Promise<OfflineScopeForgetResult> => {
  if (!options?.discardPending) {
    throw new Error('forgetOfflinePartitions requires discardPending: true');
  }

  const selected = (await inspectPartitions(offlineScope)).filter(({ report }) => select(report));
  const deleted: string[] = [];

  for (const { name } of selected) {
    try {
      await deleteDatabase(globalThis.indexedDB, name);
      deleted.push(name);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);

      throw new Error(
        `Offline scope deletion incomplete at ${name}: ${detail}; already deleted: ${deleted.join(', ') || '(none)'}`
      );
    }
  }

  return {
    deletedPartitions: deleted.length,
    discarded: { partitions: selected.map(({ report }) => report) },
  };
};

export const forgetOfflineScope = async (
  offlineScope: string,
  options: { discardPending: true }
): Promise<OfflineScopeForgetResult> => forgetOfflinePartitions(offlineScope, () => true, options);
