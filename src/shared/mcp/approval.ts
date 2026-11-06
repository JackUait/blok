import type { AgentApprovalRequest, AgentApprover } from '../../../types/agent';

import { approvalKey, describeShareChange, plainLine } from '../agent/approval';
import { failure } from '../agent/errors';

/** One stored reply, read as the MCP SDK's `inputResponse` reads it. Only `elicit` counts here. */
export type InputResponseView = { kind: 'elicit'; action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> } | { kind: string };

/** The question MCP elicitation puts to the client's person (spec: client/elicitation). */
export interface ApprovalQuestion {
  message: string;
  requestedSchema: {
    type: 'object';
    properties: Record<string, { type: 'boolean'; title: string; description: string; default: false }>;
    required: string[];
  };
}

/** The one tick the person gives: named for what it allows. */
const approvalField = (request: AgentApprovalRequest): 'unlock' | 'restore' | 'share' => {
  switch (request.kind) {
    case 'database.restore':
      return 'restore';
    case 'database.share':
      return 'share';
    case 'database.unlock':
    // Never asked here (elicitationApprover says no first); named for the switch only.
    case 'database.buttonConfirm':
    case 'database.buttonHooks':
      return 'unlock';
  }
};

const FIELDS = {
  unlock: { title: 'Unlock', description: 'Tick to let the agent unlock this database.' },
  restore: { title: 'Restore', description: 'Tick to let the agent restore this version.' },
  share: { title: 'Allow', description: 'Tick to let the agent make exactly this sharing change.' },
};

/**
 * Named by the saved title, so a rename in the same batch cannot hide the database.
 * `client` is already safeClientName's: letters, digits, dot, dash and underscore.
 */
export const approvalQuestion = (request: AgentApprovalRequest, client: string): ApprovalQuestion => {
  // The title is already one plain line (savedTitle); JSON quoting keeps its own quotes from closing ours.
  const database = `${request.title === undefined ? '' : `${JSON.stringify(request.title)} `}(id ${JSON.stringify(plainLine(request.blockId, 64) ?? '?')})`;
  const field = approvalField(request);
  const message = ((): string => {
    switch (request.kind) {
      case 'database.restore':
        return `${client}'s agent wants to restore a version that changes the locked database ${database}. `
          + 'A person locked it; the version removes it or changes its properties, views or settings. Restore it?';
      case 'database.share': {
        const view = `${request.view === undefined ? '' : `${JSON.stringify(request.view)} `}(id ${JSON.stringify(plainLine(request.viewId, 64) ?? '?')})`;

        return `${client}'s agent wants to change who can see or fill out the view ${view} of the database ${database}. `
          + `After the change: ${request.changes.map(describeShareChange).join('; ')}. Allow it?`;
      }
      case 'database.unlock':
        return `${client}'s agent wants to unlock the database ${database}. A person locked it, so its properties and views cannot change. Unlock it?`;
      case 'database.buttonConfirm':
        return `${client}'s agent wants to press a button in the database ${database} that asks for confirmation. Go on?`;
      case 'database.buttonHooks':
        return `${client}'s agent wants to press a button in the database ${database} that calls the host. Go on?`;
    }
  })();

  return {
    message,
    requestedSchema: {
      type: 'object',
      properties: { [field]: { type: 'boolean', ...FIELDS[field], default: false } },
      required: [field],
    },
  };
};

/** The MCP SDK's `inputResponse` (2.4.0), for runtimes without the SDK. */
export const readInputResponse = (responses: unknown, key: string): InputResponseView => {
  if (typeof responses !== 'object' || responses === null) {
    return { kind: 'missing' };
  }
  const entry: unknown = Reflect.get(responses, key);

  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return { kind: 'missing' };
  }
  const action: unknown = Reflect.get(entry, 'action');

  if (action === 'accept' || action === 'decline' || action === 'cancel') {
    const content: unknown = Reflect.get(entry, 'content');

    return {
      kind: 'elicit',
      action,
      ...(content !== null && typeof content === 'object' && !Array.isArray(content) && { content: content as Record<string, unknown> }),
    };
  }

  return { kind: 'other' };
};

/**
 * Answers from the person's elicitation replies on this request. With no reply yet it records
 * the question and says no, so the batch applies nothing; the server then asks and the client retries.
 * The model never sees these replies: the client sends them, not the tool arguments.
 */
export const elicitationApprover = (
  responses: unknown,
  asked: AgentApprovalRequest[],
  readReply: (responses: Record<string, unknown> | undefined, key: string) => InputResponseView,
): AgentApprover => (request) => {
  // Button presses run only in the editor; a question MCP cannot word is never asked.
  if (request.kind === 'database.buttonConfirm' || request.kind === 'database.buttonHooks') {
    return Promise.resolve(false);
  }
  const replies = typeof responses === 'object' && responses !== null ? responses as Record<string, unknown> : undefined;
  const reply = readReply(replies, approvalKey(request));

  if (reply.kind === 'elicit' && 'action' in reply) {
    return Promise.resolve(reply.action === 'accept' && reply.content?.[approvalField(request)] === true);
  }
  // A retry carries only the last round's replies, so asking again here would ask about the first database forever.
  if (replies !== undefined && Object.keys(replies).length > 0) {
    return Promise.reject(failure('APPROVAL_REQUIRED', request.kind === 'database.share'
      ? 'Only one change a person must approve can be asked per call, and nothing in this batch was applied. '
        + 'Send the sharing change of each view, and each unlock, in its own blok_execute.'
      : 'Only one database can be unlocked per call, and nothing in this batch was applied. '
        + 'Send each database.setLock that unlocks in its own blok_execute.', { details: { reason: 'one-per-call', approval: request } }));
  }
  asked.push(request);

  return Promise.resolve(false);
};

/** Form mode only: an empty elicitation object means form (the SDK's getSupportedElicitationModes); a URL-only client cannot send the tick back. */
export const canElicit = (capabilities: unknown): boolean => {
  const elicitation = typeof capabilities === 'object' && capabilities !== null && 'elicitation' in capabilities ? capabilities.elicitation : undefined;

  return typeof elicitation === 'object' && elicitation !== null && (Object.keys(elicitation).length === 0 || 'form' in elicitation);
};
