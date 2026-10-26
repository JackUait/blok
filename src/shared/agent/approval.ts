import type { AgentApprovalRequest, AgentApprover } from '../../../types/agent';
import type { DocSnapshot } from './snapshot';

import { AgentFailure, failure } from './errors';

/**
 * One key per change, block and shown title: a yes for one database never covers another,
 * and a yes for a name that changed while the person decided no longer counts.
 */
export const approvalKey = (request: AgentApprovalRequest): string => JSON.stringify([request.kind, request.blockId, request.title ?? null]);

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

const named = (request: AgentApprovalRequest): string =>
  request.title === undefined ? `database "${request.blockId}"` : `database "${request.title}" (${request.blockId})`;

/** Thrown while planning; the executor turns it into a question for the person, or a refusal. */
export const approvalNeeded = (request: AgentApprovalRequest): AgentFailure => failure(
  'APPROVAL_REQUIRED',
  `Unlocking ${named(request)} needs a person's approval.`,
  { details: { reason: 'pending', approval: request } }
);

const pendingRequest = (error: unknown): AgentApprovalRequest | undefined => {
  if (!(error instanceof AgentFailure) || error.error.code !== 'APPROVAL_REQUIRED' || error.error.details?.reason !== 'pending') {
    return undefined;
  }

  return error.error.details.approval as AgentApprovalRequest;
};

const refused = (cause: AgentFailure, request: AgentApprovalRequest, reason: 'no-channel' | 'denied'): AgentFailure => {
  const message = reason === 'denied'
    ? `The person did not approve unlocking ${named(request)}, so it stays locked. Nothing in this batch was applied. `
      + 'Send the other commands again without this database.setLock. Do not ask to unlock it again unless the person asks you to.'
    : `A person locked ${named(request)}. Unlocking it needs a person's explicit approval, and nothing here can ask one. `
      + 'Nothing in this batch was applied. Ask the person to unlock it themselves (Lock database in the database\'s view menu), '
      + 'then read it again. Never try to unlock it another way.';

  return new AgentFailure({ ...cause.error, message, details: { reason, approval: request } });
};

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
  const answer: unknown = await approve({ ...request });

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
  checkCancel: () => void
): Promise<void> => {
  for (const blockId of ids) {
    const title = savedTitle(current.get(blockId)?.data);
    const request: AgentApprovalRequest = { kind: 'database.unlock', blockId, ...(title !== undefined && { title }) };
    const cause = approvalNeeded(request);

    if (approve === undefined) {
      throw refused(cause, request, 'no-channel');
    }
    const answer: unknown = await approve({ ...request });

    checkCancel();
    if (answer !== true) {
      throw refused(cause, request, 'denied');
    }
  }
};
