import type {
  ButtonAction,
  ButtonBlock,
  ButtonCallbackAction,
  ButtonPagesTarget,
  ButtonPropertyEdit,
  ButtonSendNotificationAction,
  ButtonShowConfirmationAction,
  DatabaseRow,
  PropertyDefinition,
  PropertyValue,
} from './types';
import { resolveDynamicValue } from './dynamic-values';
import type { DynamicContext } from './dynamic-values';
import { rowMatchesFilters, rowMatchesFilterTree } from './database-query';

/** Notion's cap on "Specific people" (research/17 §3c). */
export const MAX_NOTIFY_PEOPLE = 20;

/** What a button's actions do, as the database tool does them. */
export interface ButtonHost {
  /** One undo step. */
  oneStep: (fn: () => void) => void;
  /** `databaseId` absent: this database. */
  writeValues: (rowId: string, changes: Record<string, PropertyValue>, databaseId?: string) => void;
  /** Appends to the row's page body. */
  insertBlocks: (rowId: string, blocks: ButtonBlock[]) => void;
  /** `databaseId` absent: this database. */
  openRow: (rowId: string, databaseId?: string) => void;
  openUrl: (url: string) => void;
  callback: (action: ButtonCallbackAction) => void;
  me: () => string | null;
  now: () => Date;
  /** A new row, `name` as its title. Null when refused. `databaseId` absent: this database. */
  addPage: (databaseId: string | undefined, name: string, properties: Record<string, PropertyValue>) => string | null;
  /** Another database's schema and rows. */
  source: (databaseId: string) => { schema: PropertyDefinition[]; rows: DatabaseRow[] } | undefined;
  /** This database's row values, read after the writes. */
  rowValues: (rowId: string) => Record<string, PropertyValue> | undefined;
  notify: (action: ButtonSendNotificationAction, to: string[], message: string) => void;
}

interface AddedPage {
  rowId: string;
  databaseId: string | undefined;
}

const resolveEdits = (edits: ButtonPropertyEdit[] | undefined, ctx: DynamicContext): Record<string, PropertyValue> =>
  Object.fromEntries((edits ?? []).map((edit) => [edit.propertyId, resolveDynamicValue(edit.value, ctx)]));

const personIds = (value: PropertyValue | undefined): string[] =>
  (Array.isArray(value) ? value : []).flatMap((item: unknown) =>
    typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string' ? [item.id] : []);

const pagesOf = (
  target: ButtonPagesTarget | undefined,
  rowId: string,
  added: Map<string, AddedPage>,
  host: ButtonHost,
  ctx: DynamicContext
): AddedPage[] => {
  if (target?.type === 'thisPage') return [{ rowId, databaseId: undefined }];
  if (target?.type === 'addedPage') {
    const page = added.get(target.stepId);

    return page === undefined ? [] : [page];
  }
  if (target?.type !== 'database') return [];
  const source = host.source(target.databaseId);

  return (source?.rows ?? [])
    .filter((row) => rowMatchesFilters(row, target.filters ?? [], source?.schema ?? [], ctx.now, ctx.me)
      && rowMatchesFilterTree(row, target.filterTree, source?.schema ?? [], ctx.now, ctx.me))
    .map((row) => ({ rowId: row.id, databaseId: target.databaseId }));
};

const recipientsOf = (action: ButtonSendNotificationAction, rowId: string, host: ButtonHost): string[] => {
  const recipients = action.recipients;

  if (recipients?.type === 'people') return recipients.people.map((person) => person.id).slice(0, MAX_NOTIFY_PEOPLE);
  if (recipients?.type === 'property') return personIds(host.rowValues(rowId)?.[recipients.propertyId]);

  return [];
};

const isWrite = (action: ButtonAction): boolean =>
  action.type === 'editProperty' || action.type === 'insertBlocks' || action.type === 'addPage' || action.type === 'editPages';

const runWrite = (action: ButtonAction, rowId: string, host: ButtonHost, ctx: DynamicContext, added: Map<string, AddedPage>): void => {
  if (action.type === 'editProperty') {
    host.writeValues(rowId, { [action.propertyId]: resolveDynamicValue(action.value, ctx) });
  } else if (action.type === 'insertBlocks' && action.blocks.length > 0) {
    host.insertBlocks(rowId, action.blocks);
  } else if (action.type === 'addPage') {
    const id = host.addPage(action.databaseId, action.name ?? '', resolveEdits(action.edits, ctx));

    if (id !== null) added.set(action.id, { rowId: id, databaseId: action.databaseId });
  } else if (action.type === 'editPages') {
    const changes = resolveEdits(action.edits, ctx);

    if (Object.keys(changes).length === 0) return;
    pagesOf(action.target, rowId, added, host, ctx).forEach((page) => host.writeValues(page.rowId, changes, page.databaseId));
  }
};

const runAfter = (action: ButtonAction, rowId: string, host: ButtonHost, added: Map<string, AddedPage>): void => {
  if (action.type === 'openPage' && action.stepId !== undefined) {
    const page = added.get(action.stepId);

    if (page !== undefined) host.openRow(page.rowId, page.databaseId);
  } else if (action.type === 'openPage' && (action.url === undefined || action.url === '')) {
    host.openRow(rowId);
  } else if (action.type === 'openPage') {
    host.openUrl(action.url ?? '');
  } else if (action.type === 'callback') {
    host.callback(action);
  } else if (action.type === 'sendNotification') {
    const to = recipientsOf(action, rowId, host);

    if (to.length > 0) host.notify(action, to, action.message ?? '');
  }
};

/**
 * Runs the actions in order. Every write lands in one transact, so one undo
 * takes the whole click back. Opening a page, the host callback and a
 * notification run after it: they are not document edits, and a page opened
 * mid-step would show the row before the rest of the writes. A confirmation
 * is asked before this, by `askConfirmations`.
 */
export const runButtonActions = (actions: readonly ButtonAction[], rowId: string, host: ButtonHost): void => {
  const writes = actions.filter(isWrite);
  const ctx = { me: host.me(), now: host.now() };
  const added = new Map<string, AddedPage>();

  if (writes.length > 0) {
    host.oneStep(() => writes.forEach((action) => runWrite(action, rowId, host, ctx, added)));
  }
  actions.forEach((action) => runAfter(action, rowId, host, added));
};

export const needsConfirmation = (actions: readonly ButtonAction[]): boolean =>
  actions.some((action) => action.type === 'showConfirmation');

/**
 * Asks every "Show confirmation" in order and returns the actions to run:
 * the first Cancel drops that action and every one after it. Asking before
 * any write keeps the click's writes in one undo step, since a transact
 * cannot stay open across a dialog.
 */
export const askConfirmations = async (
  actions: readonly ButtonAction[],
  confirm: (action: ButtonShowConfirmationAction) => Promise<boolean>
): Promise<ButtonAction[]> => {
  const kept: ButtonAction[] = [];

  for (const action of actions) {
    if (action.type === 'showConfirmation' && !(await confirm(action))) break;
    kept.push(action);
  }

  return kept;
};
