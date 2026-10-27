import type { AgentApprovalRequest, AgentApprover, AgentShareChange } from '../../../types/agent';
import type { OutputData } from '../../../types/data-formats/output-data';
import type { FormSubmissionAccess } from '../../../types/tools/database';
import type { DocSnapshot } from './snapshot';

import { deepEqual } from '../deep-equal';
import { LOCK_PROTECTED_FIELDS } from '../tool-actions/database';

import { AgentFailure, failure } from './errors';

/**
 * One key per change, block and shown title: a yes for one database never covers another,
 * and a yes for a name that changed while the person decided no longer counts.
 */
export const approvalKey = (request: AgentApprovalRequest): string => JSON.stringify(((): unknown[] => {
  switch (request.kind) {
    case 'database.share':
      return [request.kind, request.blockId, request.title ?? null, request.viewId, request.view ?? null, request.changes];
    case 'database.buttonConfirm':
    case 'database.buttonHooks':
      return [request.kind, request.blockId, request.title ?? null, request.rowId ?? null, request.steps ?? null,
        request.message ?? null, request.confirmLabel ?? null, request.cancelLabel ?? null, request.hooks ?? null];
    case 'database.restore':
    case 'database.unlock':
      return [request.kind, request.blockId, request.title ?? null];
  }
})());

// Longer titles push the question out of view.
const MAX_TITLE = 80;

/**
 * The title the person is shown: the saved one, as one plain line. Line breaks, control and
 * format characters (bidi overrides, zero-width) are dropped, so a title cannot fake more of the question.
 */
export const plainLine = (raw: string, max = MAX_TITLE): string | undefined => {
  const line = raw
    .replace(/[\p{Zl}\p{Zp}\r\n\t\v\f\u0085]/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  const chars = Array.from(line);

  if (chars.length === 0) {
    return undefined;
  }

  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : line;
};

export const savedTitle = (data: Readonly<Record<string, unknown>> | undefined): string | undefined =>
  (typeof data?.title === 'string' ? plainLine(data.title) : undefined);

const named = (request: AgentApprovalRequest): string => {
  const database = request.title === undefined ? `database "${request.blockId}"` : `database "${request.title}" (${request.blockId})`;

  if (request.kind !== 'database.share') {
    return database;
  }

  return `${request.view === undefined ? `view "${request.viewId}"` : `view "${request.view}" (${request.viewId})`} of ${database}`;
};

const ACCESS_LABELS: Record<FormSubmissionAccess, string> = {
  none: 'No access', view: 'Can view', comment: 'Can comment', edit: 'Can edit', full: 'Full access',
};

/** One change in the Share panel's words, as the person would set it there. */
export const describeShareChange = (change: AgentShareChange): string => {
  switch (change.setting) {
    case 'access':
      return `Who can fill out: ${{ public: 'anyone on the web with the link', workspace: 'anyone in the workspace with the link', closed: 'no one (the form is closed)' }[change.to]}`;
    case 'anonymous':
      return `Anonymous responses: ${change.to ? 'on' : 'off'}`;
    case 'submissionAccess':
      return `Access to submission: ${ACCESS_LABELS[change.to]}`;
    case 'calendarSync':
      if (!change.to.enabled) {
        return 'Calendar sync: off';
      }

      return change.to.calendarId === undefined ? 'Calendar sync: on' : `Calendar sync: on, to calendar ${JSON.stringify(change.to.calendarId)}`;
  }
};

const describeChanges = (changes: readonly AgentShareChange[]): string => changes.map(describeShareChange).join('; ');

/** Thrown while planning; the executor turns it into a question for the person, or a refusal. */
export const approvalNeeded = (request: AgentApprovalRequest): AgentFailure => failure(
  'APPROVAL_REQUIRED',
  ((): string => {
    switch (request.kind) {
      case 'database.share':
        return `Changing who can use ${named(request)} needs a person's approval (${describeChanges(request.changes)}).`;
      case 'database.buttonConfirm':
        return `A button in ${named(request)} asks for confirmation, which only a person can give.`;
      case 'database.buttonHooks':
        return `A button in ${named(request)} calls the host, which only a person can allow.`;
      case 'database.restore':
      case 'database.unlock':
        return `Unlocking ${named(request)} needs a person's approval.`;
    }
  })(),
  { details: { reason: 'pending', approval: request } }
);

const pendingRequest = (error: unknown): AgentApprovalRequest | undefined => {
  if (!(error instanceof AgentFailure) || error.error.code !== 'APPROVAL_REQUIRED' || error.error.details?.reason !== 'pending') {
    return undefined;
  }

  return error.error.details.approval as AgentApprovalRequest;
};

const refusedRestore = (request: AgentApprovalRequest, reason: 'no-channel' | 'denied'): string => (reason === 'denied'
  ? `The person did not approve a restore that changes the locked ${named(request)}, so nothing was restored. `
    + 'Do not restore this version again unless the person asks you to.'
  : `A person locked ${named(request)}, and this version removes it or changes what the lock protects. `
    + 'Restoring it needs a person\'s explicit approval, and nothing here can ask one. Nothing was restored. '
    + 'Ask the person to restore this version themselves from the version history.');

const refusedUnlock = (request: AgentApprovalRequest, reason: 'no-channel' | 'denied'): string => (reason === 'denied'
  ? `The person did not approve unlocking ${named(request)}, so it stays locked. Nothing in this batch was applied. `
    + 'Send the other commands again without this database.setLock. Do not ask to unlock it again unless the person asks you to.'
  : `A person locked ${named(request)}. Unlocking it needs a person's explicit approval, and nothing here can ask one. `
    + 'Nothing in this batch was applied. Ask the person to unlock it themselves (Lock database in the database\'s view menu), '
    + 'then read it again. Never try to unlock it another way.');

const refusedConfirmation = (request: AgentApprovalRequest, reason: 'no-channel' | 'denied'): string => (reason === 'denied'
  ? `The person did not confirm the button in ${named(request)}, so it did nothing. Nothing in this batch was applied. `
    + 'Do not press it again unless the person asks you to.'
  : `This button in ${named(request)} asks for confirmation, and nothing here can ask a person. Nothing was applied. `
    + 'Ask the person to press it themselves.');

const refusedShare = (request: Extract<AgentApprovalRequest, { kind: 'database.share' }>, reason: 'no-channel' | 'denied'): string => (reason === 'denied'
  ? `The person did not approve this sharing change to ${named(request)} (${describeChanges(request.changes)}), so nothing in this batch, step or restore was applied. `
    + 'Do not try this sharing change again unless the person asks you to.'
  : `Who can see or fill out ${named(request)} stays with the person: this change (${describeChanges(request.changes)}) needs a person's explicit approval, `
    + 'and nothing here can ask one. Nothing in this batch, step or restore was applied. '
    + 'Ask the person to change it themselves in the view\'s Share menu. Never try to change it another way.');

const refusedHooks = (request: AgentApprovalRequest, reason: 'no-channel' | 'denied'): string => (reason === 'denied'
  ? `The person did not allow the button in ${named(request)} to call the host, so it did nothing. Nothing in this batch was applied. `
    + 'Do not press it again unless the person asks you to.'
  : `This button in ${named(request)} calls the host (a callback or a notification), and nothing here can ask a person to allow it. `
    + 'Nothing was applied. Ask the person to press it themselves.');

const refused = (cause: AgentFailure, request: AgentApprovalRequest, reason: 'no-channel' | 'denied'): AgentFailure => {
  const message = ((): string => {
    switch (request.kind) {
      case 'database.share':
        return refusedShare(request, reason);
      case 'database.restore':
        return refusedRestore(request, reason);
      case 'database.buttonConfirm':
        return refusedConfirmation(request, reason);
      case 'database.buttonHooks':
        return refusedHooks(request, reason);
      case 'database.unlock':
        return refusedUnlock(request, reason);
    }
  })();

  return new AgentFailure({ ...cause.error, message, details: { reason, approval: request } });
};

// The host gets its own copy: a host that edits it cannot change what was approved.
const copyOf = (request: AgentApprovalRequest): AgentApprovalRequest => JSON.parse(JSON.stringify(request)) as AgentApprovalRequest;

// A batch names a handful of databases; more is a loop, not a person's work.
const MAX_ASKS = 20;

/**
 * Runs `plan` until it needs no more approvals. Each request asks the person once.
 * Only a literal true from the host's approver approves; a pending ask with no approver is refused.
 */
export const planWithApprovals = async <T>(
  plan: (approved: ReadonlySet<string>) => T,
  approved: Set<string>,
  approve: AgentApprover | undefined,
  checkCancel: () => void,
  asks = 0
): Promise<T> => {
  const attempt = ((): { value: T } | { request: AgentApprovalRequest; cause: AgentFailure } => {
    try {
      return { value: plan(approved) };
    } catch (error) {
      const request = pendingRequest(error);

      if (request === undefined || !(error instanceof AgentFailure)) {
        throw error;
      }

      return { request, cause: error };
    }
  })();

  if ('value' in attempt) {
    return attempt.value;
  }
  const { request, cause } = attempt;

  if (approve === undefined || approved.has(approvalKey(request)) || asks >= MAX_ASKS) {
    throw refused(cause, request, 'no-channel');
  }
  // Typed loosely: a host function that resolves anything but true has not approved.
  const answer: unknown = await approve(copyOf(request));

  checkCancel();
  if (answer !== true) {
    throw refused(cause, request, 'denied');
  }
  approved.add(approvalKey(request));

  return planWithApprovals(plan, approved, approve, checkCancel, asks + 1);
};

const lockedIn = (snapshot: DocSnapshot): Set<string> => new Set(snapshot.ids().filter((id) => {
  const schema: unknown = snapshot.get(id)?.data.schema;

  return Array.isArray(schema) && schema.some((property: unknown) => typeof property === 'object' && property !== null
    && 'type' in property && property.type === 'title' && 'databaseLocked' in property && property.databaseLocked === true);
}));

/** Every locked database: what a step could unlock when nothing says what it holds. */
export const lockedDatabases = (snapshot: DocSnapshot): string[] => [...lockedIn(snapshot)];

/** Databases locked in `from` that are still there, unlocked, in `to`: going from one to the other unlocks them. */
export const unlockedBetween = (from: DocSnapshot, to: DocSnapshot): string[] => {
  const after = lockedIn(to);

  return [...lockedIn(from)].filter(id => to.get(id) !== undefined && !after.has(id));
};

/**
 * Asks about each unlock a history step would make, before it runs. The rules are a batch's:
 * no approver refuses, anything but a literal true refuses, and each step asks again.
 */
export const approveStep = async (
  ids: readonly string[],
  current: DocSnapshot,
  approve: AgentApprover | undefined,
  checkCancel: () => void,
  kind: 'database.unlock' | 'database.restore' = 'database.unlock'
): Promise<void> => {
  await approveRequests(ids.map((blockId) => {
    const title = savedTitle(current.get(blockId)?.data);

    return { kind, blockId, ...(title !== undefined && { title }) };
  }), approve, checkCancel);
};

/** Asks each request in turn, by the same rules as approveStep. */
export const approveRequests = async (
  requests: readonly AgentApprovalRequest[],
  approve: AgentApprover | undefined,
  checkCancel: () => void
): Promise<void> => {
  for (const request of requests) {
    const cause = approvalNeeded(request);

    if (approve === undefined) {
      throw refused(cause, request, 'no-channel');
    }
    const answer: unknown = await approve(copyOf(request));

    checkCancel();
    if (answer !== true) {
      throw refused(cause, request, 'denied');
    }
  }
};

const lockedOrHeld = (snapshot: DocSnapshot, id: string, locked: ReadonlySet<string>, seen: ReadonlySet<string> = new Set()): boolean => {
  const parent = snapshot.get(id)?.parent ?? null;

  return locked.has(id) || (parent !== null && !seen.has(parent) && snapshot.get(parent)?.type === 'database'
    && lockedOrHeld(snapshot, parent, locked, new Set([...seen, id])));
};

/** The databases among `ids` that are locked, by their own lock or a holder's. */
export const lockedAmong = (snapshot: DocSnapshot, ids: readonly string[]): string[] => {
  const locked = lockedIn(snapshot);

  return ids.filter(id => snapshot.get(id)?.type === 'database' && lockedOrHeld(snapshot, id, locked));
};

/**
 * Databases locked now (their own lock or a holder's) that the restored version removes, turns into
 * something else, or changes in any field the lock protects. A new id never stands in for an old one.
 */
export const restoreTouchesLocked = (now: DocSnapshot, target: OutputData): string[] => {
  const locked = lockedIn(now);
  const restored = new Map(target.blocks.flatMap(block => (block.id === undefined ? [] : [[block.id, block] as const])));

  return now.ids().filter(id => now.get(id)?.type === 'database' && lockedOrHeld(now, id, locked)).filter((id) => {
    const after = restored.get(id);
    const before = now.get(id);
    const data: Record<string, unknown> = typeof after?.data === 'object' && after.data !== null ? after.data : {};

    return after === undefined || after.type !== 'database'
      || LOCK_PROTECTED_FIELDS.some(field => !deepEqual(before?.data[field], data[field]));
  });
};

// ─── Sharing: who can see or fill out a view ───

type Access = 'workspace' | 'public' | 'closed';

/** The share settings a view holds, defaults filled in. Compared field by field. */
interface ViewShare {
  access: Access;
  anonymous: boolean;
  submissionAccess: FormSubmissionAccess;
  calendarSync: { enabled: boolean; calendarId?: string };
}

const SUBMISSION_ACCESS: readonly FormSubmissionAccess[] = ['none', 'view', 'comment', 'edit', 'full'];

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** As the Share form panel reads it: closed wins over public. */
const shareOf = (view: Record<string, unknown> | undefined): ViewShare => {
  const form = isPlainRecord(view?.form) ? view.form : {};
  const sync = isPlainRecord(view?.calendarSync) ? view.calendarSync : {};
  const access = typeof form.submissionAccess === 'string' && (SUBMISSION_ACCESS as readonly string[]).includes(form.submissionAccess)
    ? form.submissionAccess as FormSubmissionAccess
    : 'none';

  const publicOrNot: Access = form.public === true ? 'public' : 'workspace';

  return {
    access: form.closed === true ? 'closed' : publicOrNot,
    anonymous: form.anonymous === true,
    submissionAccess: access,
    calendarSync: {
      enabled: sync.enabled === true,
      ...(typeof sync.calendarId === 'string' && sync.calendarId !== '' && { calendarId: sync.calendarId }),
    },
  };
};

// The question names the calendar in full: a longer id would be cut there.
const MAX_CALENDAR_ID = 64;

const rawShare = (view: Record<string, unknown> | undefined): unknown[] => {
  const form = isPlainRecord(view?.form) ? view.form : {};

  return [view?.form === undefined || isPlainRecord(view.form), form.closed, form.public, form.anonymous, form.submissionAccess, view?.calendarSync];
};

const optional = (value: unknown, valid: (value: unknown) => boolean): boolean => value === undefined || valid(value);
const isBoolean = (value: unknown): boolean => typeof value === 'boolean';

/** The question can only say what a value means when Blok reads it the one way the Share panel does. */
const readableShare = (view: Record<string, unknown>): boolean => {
  const form = isPlainRecord(view.form) ? view.form : undefined;
  const sync = isPlainRecord(view.calendarSync) ? view.calendarSync : undefined;
  const id = sync?.calendarId;

  return (view.form === undefined || form !== undefined)
    && (view.calendarSync === undefined || sync !== undefined)
    && optional(form?.closed, isBoolean) && optional(form?.public, isBoolean) && optional(form?.anonymous, isBoolean)
    && optional(form?.submissionAccess, value => (SUBMISSION_ACCESS as readonly unknown[]).includes(value))
    && optional(sync?.enabled, isBoolean)
    && optional(id, value => typeof value === 'string' && plainLine(value, MAX_CALENDAR_ID) === value && Array.from(value).length <= MAX_CALENDAR_ID);
};

/** Fails closed on a sharing value that changes and that the person could not be shown as it is. */
const checkReadable = (was: Record<string, unknown> | undefined, now: Record<string, unknown>): void => {
  if (!deepEqual(rawShare(was), rawShare(now)) && !readableShare(now)) {
    throw failure('INVALID_ARGS', `View "${typeof now.id === 'string' ? plainLine(now.id, 64) ?? '?' : '?'}" has a sharing setting Blok cannot read as the Share panel does `
      + `(form closed, public and anonymous are true or false; submissionAccess is ${SUBMISSION_ACCESS.join(', ')}; calendarSync.calendarId is one plain line of at most ${MAX_CALENDAR_ID} characters). Nothing was written.`);
  }
};

const changesBetween = (was: ViewShare, now: ViewShare): AgentShareChange[] => [
  ...(was.access === now.access ? [] : [{ setting: 'access' as const, to: now.access }]),
  ...(was.anonymous === now.anonymous ? [] : [{ setting: 'anonymous' as const, to: now.anonymous }]),
  ...(was.submissionAccess === now.submissionAccess ? [] : [{ setting: 'submissionAccess' as const, to: now.submissionAccess }]),
  ...(deepEqual(was.calendarSync, now.calendarSync) ? [] : [{ setting: 'calendarSync' as const, to: now.calendarSync }]),
];

/** One view's sharing changes, by ids: what a history step keeps, and asks about once it runs. */
export interface ShareStep { blockId: string; viewId: string; changes: AgentShareChange[] }

type DatabaseSource = (id: string) => { type: string; data: Readonly<Record<string, unknown>> } | undefined;

const viewsIn = (data: Readonly<Record<string, unknown>> | undefined): Array<Record<string, unknown>> =>
  (Array.isArray(data?.views) ? data.views.filter(isPlainRecord) : []);

/**
 * Every view whose sharing differs between two documents. A view that is new counts against the defaults,
 * so bringing back a public form asks too. A view that goes away shares nothing, so it never asks.
 */
const shareSteps = (ids: readonly string[], from: DatabaseSource, to: DatabaseSource): ShareStep[] => ids.flatMap((blockId) => {
  const after = to(blockId);

  if (after?.type !== 'database') {
    return [];
  }
  const before = from(blockId);
  const was = new Map(viewsIn(before?.type === 'database' ? before.data : undefined)
    .flatMap(view => (typeof view.id === 'string' ? [[view.id, view] as const] : [])));

  return viewsIn(after.data).flatMap((view) => {
    // A view with no id is new: it still asks, against the defaults.
    const viewId = typeof view.id === 'string' ? view.id : '';
    const previous = viewId === '' ? undefined : was.get(viewId);

    checkReadable(previous, view);
    const changes = changesBetween(shareOf(previous), shareOf(view));

    return changes.length === 0 ? [] : [{ blockId, viewId, changes }];
  });
});

const snapshotSource = (snapshot: DocSnapshot): DatabaseSource => id => snapshot.get(id);

/** Going from one document to the other changes these views' sharing. */
export const sharedBetween = (from: DocSnapshot, to: DocSnapshot): ShareStep[] =>
  shareSteps(to.ids(), snapshotSource(from), snapshotSource(to));

/** Restoring `target` over `now` changes these views' sharing. */
export const restoreShares = (now: DocSnapshot, target: OutputData): ShareStep[] => {
  const restored = new Map(target.blocks.flatMap(block => (block.id === undefined ? [] : [[block.id, block] as const])));

  return shareSteps([...restored.keys()], snapshotSource(now), id => {
    const block = restored.get(id);

    return block === undefined ? undefined : { type: block.type, data: isPlainRecord(block.data) ? block.data : {} };
  });
};

/** The question for one view, named from `named` (the document before the change). */
export const shareRequest = (step: ShareStep, named: DocSnapshot): AgentApprovalRequest => {
  const data = named.get(step.blockId)?.data;
  const title = savedTitle(data);
  const viewName = viewsIn(data).find(view => view.id === step.viewId)?.name;
  const view = typeof viewName === 'string' ? plainLine(viewName) : undefined;
  // Values as written: shareSteps refused any the person could not be shown as they are.
  return { kind: 'database.share', blockId: step.blockId, ...(title !== undefined && { title }), viewId: step.viewId, ...(view !== undefined && { view }), changes: step.changes };
};

/** Two steps run as one: per view and setting, the step run last decides the value. */
export const joinShares = (first: readonly ShareStep[], last: readonly ShareStep[]): ShareStep[] => {
  const joined = new Map<string, ShareStep>();

  for (const step of [...first, ...last]) {
    const key = JSON.stringify([step.blockId, step.viewId]);
    const had = joined.get(key)?.changes ?? [];
    const settings = new Set(step.changes.map(change => change.setting));

    joined.set(key, { ...step, changes: [...had.filter(change => !settings.has(change.setting)), ...step.changes] });
  }

  return [...joined.values()];
};

/** Set in ctx.services by the editor when the database tool has config.forms, the Share panel's host. */
export const FORMS_HOST_SERVICE = 'databaseFormsHost';

/**
 * Never more than a person can do. The Share panel offers anyone-with-the-link, anonymous answers and
 * access to submission only with the host's form sharing, and Blok has no control for calendar sync at all.
 */
export const checkShareReachable = (steps: readonly ShareStep[], services: Partial<Record<string, unknown>>): void => {
  const host = services[FORMS_HOST_SERVICE] === true;
  const changes = steps.flatMap(step => step.changes);

  if (changes.some(change => change.setting === 'calendarSync')) {
    throw failure('PRECONDITION_FAILED', 'Calendar sync has no setting a person can change in Blok, so an agent cannot change it either. Nothing was written.');
  }
  const hostOnly = host ? undefined : changes.find(change => change.setting === 'anonymous' || change.setting === 'submissionAccess'
    || (change.setting === 'access' && change.to === 'public'));

  if (hostOnly !== undefined) {
    throw failure('COMMAND_UNAVAILABLE', `${describeShareChange(hostOnly)}: the Share panel offers this only when the host shares forms (database config.forms), and this editor has none. Nothing was written.`, {
      details: { reason: 'host' },
    });
  }
};
