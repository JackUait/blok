import { diffOutput } from '../output-diff';
import { outputBlocksToSegments } from '../rich-text/block-data';
import { buildDocumentView, viewRows } from './document-view';
import { AgentFailure, failure } from './errors';
import { DocSnapshot } from './snapshot';

import type { AgentVersionHistory, DocumentView, ViewArgs, ViewBlock } from '../../../types/agent';
import type { OutputData } from '../../../types/data-formats/output-data';
import type { VersionCommandName } from './names';
import type { PlannerContext } from './types';

type VersionContext = Omit<PlannerContext, 'prepared'>;

// Enough rows per list to see what a version did; history.read reads the rest.
const CHANGE_ROWS_LIMIT = 50;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isVersionHistory = (value: unknown): value is AgentVersionHistory =>
  isRecord(value) && typeof value.list === 'function' && typeof value.read === 'function';

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

/** A host failure is not a broken document: the error says if a retry can help. */
const ask = async <T>(call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    if (error instanceof AgentFailure) {
      throw error;
    }
    throw new AgentFailure({
      ...failure('TOOL_ACTION_FAILED', `The version history failed: ${messageOf(error)}`).error,
      retryable: isTransient(error),
    });
  }
};

const readVersion = async (
  history: AgentVersionHistory,
  version: string,
  ctx: VersionContext,
  path: string
): Promise<DocSnapshot> => {
  const output: unknown = await ask(() => history.read(version));

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
  const idsOf = (blocks: Array<{ id?: string }>): string[] =>
    blocks.flatMap(block => block.id === undefined ? [] : [block.id]);
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

/** Runs one version-history read against the host's service. */
export const runVersionCommand = async (
  name: VersionCommandName,
  args: Record<string, unknown>,
  ctx: VersionContext,
  current: () => DocSnapshot
): Promise<unknown> => {
  const history = ctx.services.versionHistory;

  if (!isVersionHistory(history)) {
    throw failure('COMMAND_UNAVAILABLE', `${name} needs the host's version history, and this host has none.`, {
      commandIndex: 0, details: { reason: 'service', requires: ['versionHistory'] },
    });
  }

  if (name === 'history.versions') {
    const group = args.group === 1 || args.group === 15 || args.group === 60 ? args.group : undefined;

    return { versions: await ask(() => history.list(group === undefined ? {} : { group })) };
  }

  if (name === 'history.read') {
    const version = String(args.version);
    const read: Partial<DocumentView> = buildDocumentView(await readVersion(history, version, ctx, '/version'), viewArgs(args), ctx, '');

    // Not a revision: a model would pass it back as expectRevision.
    delete read.revision;

    return { version, ...read };
  }

  const from = String(args.from);
  const to = typeof args.to === 'string' ? args.to : 'current';
  const before = await readVersion(history, from, ctx, '/from');
  const after = typeof args.to === 'string' ? await readVersion(history, args.to, ctx, '/to') : current();

  return { from, to, ...changes(before, after, ctx) };
};
