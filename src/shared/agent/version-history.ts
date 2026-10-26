import { diffOutput } from '../output-diff';
import { outputBlocksToSegments } from '../rich-text/block-data';
import { buildDocumentView, viewRows } from './document-view';
import { approveStep, restoreTouchesLocked } from './approval';
import { AgentFailure, failure } from './errors';
import { DocSnapshot } from './snapshot';

import type { AgentApprover, AgentVersionHistory, ChangedSet, DocumentView, ViewArgs, ViewBlock } from '../../../types/agent';
import type { OutputData } from '../../../types/data-formats/output-data';
import type { VersionCommandName, VersionReadName } from './names';
import type { PlannerContext } from './types';

type VersionContext = Omit<PlannerContext, 'prepared'>;

// Enough rows per list to see what a version did; history.read reads the rest.
const CHANGE_ROWS_LIMIT = 50;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isVersionHistory = (value: unknown): value is AgentVersionHistory =>
  isRecord(value) && typeof value.list === 'function' && typeof value.read === 'function';

/** Whether a host's versionHistory service can restore a version. */
export const canRestore = (value: unknown): boolean => isVersionHistory(value) && typeof value.restore === 'function';

const isOutputData = (value: unknown): value is OutputData =>
  isRecord(value) && Array.isArray(value.blocks)
  && value.blocks.every(block => isRecord(block) && typeof block.type === 'string' && isRecord(block.data));

const numberOf = (value: unknown): number | undefined => typeof value === 'number' ? value : undefined;

/** The doc.read arguments of a history.read; the envelope already checked their types. */
const viewArgs = (args: Record<string, unknown>): ViewArgs => {
  const { rootId, ids, detail, cursor } = args;
  const view: ViewArgs = { depth: numberOf(args.depth), limit: numberOf(args.limit), textLimit: numberOf(args.textLimit) };

  if (typeof rootId === 'string' || rootId === null) {
    view.rootId = rootId;
  }
  if (Array.isArray(ids)) {
    view.ids = ids.map(String);
  }
  if (detail === 'outline' || detail === 'full') {
    view.detail = detail;
  }
  if (typeof cursor === 'string') {
    view.cursor = cursor;
  }

  return view;
};

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Only a transient host failure may pass on a retry: 403, 501 or a deleted document never will. */
const isTransient = (error: unknown): boolean => {
  if (!isRecord(error)) {
    return false;
  }
  if (typeof error.retryable === 'boolean') {
    return error.retryable;
  }
  const status = error.status;

  return typeof status === 'number' && (status === 429 || (status >= 500 && status <= 599 && status !== 501));
};

/** A plain 500, or an error that says nothing of itself: worth one more ask, then it is reported. */
const isPlain = (error: unknown): boolean => !isRecord(error)
  || (typeof error.retryable !== 'boolean' && (error.status === undefined || error.status === 500));

const hostFailure = (error: unknown, retryable: boolean): AgentFailure => new AgentFailure({
  ...failure('TOOL_ACTION_FAILED', `The version history failed: ${messageOf(error)}`).error,
  retryable,
});

/**
 * A host failure is not a broken document: the error says if a retry can help. A plain one is
 * asked once more here, so the model is told not to retry it. `retry: false` for a write.
 */
const ask = async <T>(call: () => Promise<T>, checkCancel: () => void, retry = true): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    if (error instanceof AgentFailure) {
      throw error;
    }
    if (!retry || !isPlain(error)) {
      throw hostFailure(error, !isPlain(error) && isTransient(error));
    }
  }
  checkCancel();
  try {
    return await call();
  } catch (error) {
    if (error instanceof AgentFailure) {
      throw error;
    }
    throw hostFailure(error, false);
  }
};

const readVersion = async (
  history: AgentVersionHistory,
  version: string,
  ctx: VersionContext,
  path: string,
  checkCancel: () => void
): Promise<DocSnapshot> => {
  const output: unknown = await ask(() => history.read(version), checkCancel);

  if (!isOutputData(output)) {
    throw failure('INVALID_ARGS', `There is no version "${version}". history.versions lists them.`, { path });
  }
  // A server export may keep rich text as HTML; reads and diffs need segments.
  const blocks = outputBlocksToSegments(output.blocks, type => ctx.tools.get(type)?.entry.richTextFields ?? [], ctx.ports.htmlToSegments);

  try {
    return DocSnapshot.fromOutput({ ...output, blocks });
  } catch (error) {
    throw new AgentFailure({
      ...failure('TOOL_ACTION_FAILED', `Version "${version}" could not be read: ${messageOf(error)}`).error,
      details: { version },
    });
  }
};

const outline = (row: ViewBlock): ViewBlock => {
  const copy = { ...row };

  delete copy.data;
  delete copy.tunes;

  return copy;
};

const rows = (snap: DocSnapshot, ids: string[], ctx: VersionContext): { rows: ViewBlock[]; more: number } =>
  viewRows(snap, new Set(ids), ctx, CHANGE_ROWS_LIMIT);

const changes = (before: DocSnapshot, after: DocSnapshot, ctx: VersionContext): Record<string, unknown> => {
  const diff = diffOutput(before.toOutput(), after.toOutput(), {
    richTextFields: type => ctx.tools.get(type)?.entry.richTextFields ?? [],
    htmlToSegments: ctx.ports.htmlToSegments,
  });
  const added = rows(after, idsOf(diff.added), ctx);
  const removed = rows(before, idsOf(diff.removed), ctx);
  const moved = rows(after, idsOf(diff.moved), ctx);
  const changedIds = diff.changed.slice(0, CHANGE_ROWS_LIMIT).map(change => change.id);
  const beforeRows = new Map(rows(before, changedIds, ctx).rows.map(row => [row.id, row]));
  const afterRows = new Map(rows(after, changedIds, ctx).rows.map(row => [row.id, row]));
  const changed = diff.changed.slice(0, CHANGE_ROWS_LIMIT).flatMap(change => {
    const was = beforeRows.get(change.id);
    const now = afterRows.get(change.id);

    return was === undefined || now === undefined
      ? []
      : [{ id: change.id, type: now.type, fields: change.fields, before: was, after: now }];
  });
  const more = added.more + removed.more + moved.more + Math.max(0, diff.changed.length - CHANGE_ROWS_LIMIT);

  return {
    added: added.rows.map(outline),
    removed: removed.rows.map(outline),
    changed,
    moved: moved.rows.map(outline),
    ...(more > 0 && { more }),
  };
};

const historyOf = (name: VersionCommandName, ctx: VersionContext): AgentVersionHistory => {
  const history = ctx.services.versionHistory;

  if (!isVersionHistory(history)) {
    throw failure('COMMAND_UNAVAILABLE', `${name} needs the host's version history, and this host has none.`, {
      commandIndex: 0, details: { reason: 'service', requires: ['versionHistory'] },
    });
  }

  return history;
};

const notFound = (version: string): AgentFailure =>
  failure('VERSION_NOT_FOUND', `There is no version "${version}". history.versions lists them.`, { path: '/version' });

const idsOf = (blocks: Array<{ id?: string }>): string[] =>
  blocks.flatMap(block => block.id === undefined ? [] : [block.id]);

/**
 * Restores one version through the host, as its own Restore button does. `previous` is the
 * version that was current before: restoring it is the way back, since history.undo cannot.
 */
export const runRestore = async (
  args: Record<string, unknown>,
  ctx: VersionContext,
  current: () => DocSnapshot,
  checkCancel: () => void,
  approve?: AgentApprover
): Promise<{ result: { version: string; previous?: string }; changed: ChangedSet }> => {
  const history = historyOf('history.restore', ctx);
  const restore = history.restore;

  if (typeof restore !== 'function') {
    throw failure('COMMAND_UNAVAILABLE', 'history.restore needs a version history that can restore, and this host\'s cannot.', {
      commandIndex: 0, details: { reason: 'host', requires: ['versionHistory'] },
    });
  }
  const version = String(args.version);
  const previous = (await ask(() => history.list({}), checkCancel))[0]?.version;
  const target = await ask(() => history.read(version), checkCancel);

  if (!isOutputData(target)) {
    throw notFound(version);
  }
  const now = current();

  // A lock protects more than its flag: removing, replacing or reshaping the database needs the person's yes too.
  const approved = restoreTouchesLocked(now, target);

  await approveStep(approved, now, approve, checkCancel, 'database.restore');
  // The person answered about the document as it was; a lock that landed meanwhile was never asked about.
  if (approved.length > 0 && restoreTouchesLocked(current(), target).some(id => !approved.includes(id))) {
    throw failure('STALE', 'A database was locked while the person decided, so nothing was restored. Read the document again, then retry.', { commandIndex: 0 });
  }
  const blocks = outputBlocksToSegments(target.blocks, type => ctx.tools.get(type)?.entry.richTextFields ?? [], ctx.ports.htmlToSegments);
  const diff = diffOutput(now.toOutput(), { ...target, blocks }, {
    richTextFields: type => ctx.tools.get(type)?.entry.richTextFields ?? [],
    htmlToSegments: ctx.ports.htmlToSegments,
  });

  // The reads above can take a while; a Stop during them must leave the document alone.
  checkCancel();
  // The newest version is what the checks above saw: a host that moved past it restores nothing.
  const restored = await ask(() => (previous === undefined
    ? restore.call(history, version)
    : restore.call(history, version, { expectRevision: previous })), checkCancel, false);

  if (restored === 'stale') {
    throw failure('STALE', 'The document changed since the version history was read, so nothing was restored. Read it again, then retry.', { commandIndex: 0 });
  }
  if (!restored) {
    throw notFound(version);
  }

  return {
    result: { version, ...(previous !== undefined && { previous }) },
    changed: {
      created: idsOf(diff.added), updated: diff.changed.map(change => change.id), moved: idsOf(diff.moved), removed: idsOf(diff.removed),
    },
  };
};

/** Runs one version-history read against the host's service. */
export const runVersionCommand = async (
  name: VersionReadName,
  args: Record<string, unknown>,
  ctx: VersionContext,
  current: () => DocSnapshot,
  checkCancel: () => void
): Promise<unknown> => {
  const history = historyOf(name, ctx);

  if (name === 'history.versions') {
    const group = args.group === 1 || args.group === 15 || args.group === 60 ? args.group : undefined;

    return { versions: await ask(() => history.list(group === undefined ? {} : { group }), checkCancel) };
  }

  if (name === 'history.read') {
    const version = String(args.version);
    const read: Partial<DocumentView> = buildDocumentView(await readVersion(history, version, ctx, '/version', checkCancel), viewArgs(args), ctx, '');

    // Not a revision: a model would pass it back as expectRevision.
    delete read.revision;

    return { version, ...read };
  }

  const from = String(args.from);
  const to = typeof args.to === 'string' ? args.to : 'current';
  const before = await readVersion(history, from, ctx, '/from', checkCancel);
  const after = typeof args.to === 'string' ? await readVersion(history, args.to, ctx, '/to', checkCancel) : current();

  return { from, to, ...changes(before, after, ctx) };
};
