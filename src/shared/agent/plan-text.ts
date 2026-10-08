import { isRichText } from '../rich-text/guards';
import { AgentFailure, failure } from './errors';
import { planUpdate } from './plan-block';

import type { TextRange } from '../../../types/agent';
import type { RichText } from '../../../types/rich-text';
import type { PlanState } from './plan-state';

interface Target { id: string; type: string; field: string; value: RichText }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
const pointerKey = (key: string): string => key.replace(/~/g, '~0').replace(/\//g, '~1');

const target = (state: PlanState, args: Record<string, unknown>): Target => {
  const block = state.requireBlock(args.id, '/id');
  const tool = state.tool(block.type)
    ?? state.fail('UNKNOWN_TOOL', `Block "${block.id}" is a "${block.type}", which is not registered here.`, '/id', { opaque: true });
  const fields = tool.entry.richTextFields;

  if (args.field !== undefined && typeof args.field !== 'string') {
    state.fail('INVALID_ARGS', 'Expected a rich-text field name.', '/field');
  }

  const field = args.field ?? fields[0];

  if (field === undefined || !fields.includes(field)) {
    state.fail('FIELD_NOT_RICH_TEXT', `"${String(field)}" is not a rich-text field of "${block.type}". Rich fields: ${fields.join(', ') || 'none'}.`, '/field', { fields });
  }
  if (tool.entry.viewState.includes(field)) {
    state.fail('FIELD_NOT_WRITABLE', `"${field}" is view state. Agents do not set it.`, '/field', { reason: 'view-state', field });
  }
  if (Object.hasOwn(tool.entry.guardedFields, field)) {
    const use = tool.entry.guardedFields[field];

    state.fail('FIELD_NOT_WRITABLE', `"${field}" keeps an invariant. Use ${use} instead.`, '/field', { reason: 'guarded', field, use });
  }

  const value = block.data[field] ?? [];

  if (!isRichText(value)) {
    state.fail('INVALID_ARGS', `"${field}" must contain rich-text segments.`, '/field');
  }

  return { id: block.id, type: block.type, field, value };
};

const readRange = (state: PlanState, value: unknown): TextRange => {
  if (value === 'all') {
    return value;
  }
  if (isRecord(value)) {
    if (typeof value.find === 'string' && (value.occurrence === undefined || typeof value.occurrence === 'number')) {
      return { find: value.find, ...(value.occurrence !== undefined && { occurrence: value.occurrence }) };
    }
    if (typeof value.start === 'number' && typeof value.end === 'number' &&
        (value.expectText === undefined || typeof value.expectText === 'string')) {
      return { start: value.start, end: value.end, ...(value.expectText !== undefined && { expectText: value.expectText }) };
    }
  }

  return state.fail('INVALID_ARGS', 'Expected offsets, a find range, or "all".', '/range');
};

const resolve = (state: PlanState, t: Target, range: TextRange, path: string): { start: number; end: number } => {
  try {
    return state.ctx.richText.resolve(t.value, range);
  } catch (error) {
    if (!(error instanceof AgentFailure)) {
      throw error;
    }

    const text = state.ctx.richText.plainText(t.value);

    throw failure(error.error.code, error.error.message, {
      commandIndex: state.index,
      path: `/commands/${state.index}/args${path}`,
      details: { ...error.error.details, text, ...(error.error.code === 'STALE' && { current: [{ id: t.id, type: t.type, text }] }) },
    });
  }
};

const input = (state: PlanState, t: Target, value: unknown, path: string, marks?: unknown): RichText => {
  const literal = typeof value === 'string' && value !== ''
    ? [{ text: value, ...(marks !== undefined && { marks }) }]
    : [];
  const raw = typeof value === 'string' ? literal : value;
  const clean: unknown = (() => {
    try {
      return state.prepareData(t.type, { [t.field]: raw }, '', t.id, { normalize: false })[t.field];
    } catch (error) {
      if (!(error instanceof AgentFailure)) {
        throw error;
      }

      const prefix = `/commands/${state.index}/args/${pointerKey(t.field)}`;

      throw failure(error.error.code, error.error.message, {
        commandIndex: state.index,
        path: `/commands/${state.index}/args${path}${error.error.path?.startsWith(prefix) === true ? error.error.path.slice(prefix.length) : ''}`,
        ...(error.error.details !== undefined && { details: error.error.details }),
      });
    }
  })();
  if (clean === undefined) {
    return [];
  }
  if (!isRichText(clean)) {
    state.fail('INVALID_ARGS', 'The sanitized input must contain rich-text segments.', path);
  }

  return state.ctx.richText.canonicalize(clean);
};

const write = (state: PlanState, t: Target, value: RichText, start: number, end: number): void => {
  const intendedText = state.ctx.richText.plainText(value);

  try {
    planUpdate(state, { id: t.id, data: { [t.field]: value } });
  } finally {
    const warned = { value: false };
    const warnings = state.warnings.filter(entry => {
      if (entry.code !== 'LOOKS_LIKE_MARKDOWN' || entry.commandIndex !== state.index || entry.blockId !== t.id || entry.field !== t.field) {
        return true;
      }
      if (warned.value) {
        return false;
      }
      warned.value = true;

      return true;
    });

    state.warnings.splice(0, state.warnings.length, ...warnings);
  }

  const effective = state.requireBlock(t.id, '/id').data[t.field] ?? [];

  if (!isRichText(effective)) {
    state.fail('INVALID_ARGS', `"${t.field}" must contain rich-text segments.`, '/field');
  }

  const rewritten = intendedText !== state.ctx.richText.plainText(effective);

  Object.assign(state, { lastRange: { blockId: t.id, field: t.field, start: rewritten ? 0 : start, end: rewritten ? state.ctx.richText.length(effective) : end } });
};

export const planTextInsert = (state: PlanState, args: Record<string, unknown>): unknown => {
  const t = target(state, args);
  const at = (() => {
    if (typeof args.at === 'number') {
      return resolve(state, t, { start: args.at, end: args.at }, '/at').start;
    }
    if (isRecord(args.at) && typeof args.at.after === 'string') {
      return resolve(state, t, { find: args.at.after }, '/at/after').end;
    }

    return state.fail('INVALID_ARGS', 'Expected an offset or { after: text }.', '/at');
  })();

  const inserted = input(state, t, args.text, '/text', args.marks);
  const length = state.ctx.richText.length(inserted);

  write(state, t, state.ctx.richText.insert(t.value, at, inserted), at, at + length);

  return { length };
};

export const planTextDelete = (state: PlanState, args: Record<string, unknown>): unknown => {
  const t = target(state, args);
  const { start, end } = resolve(state, t, readRange(state, args.range), '/range');
  const removed = state.ctx.richText.plainText(state.ctx.richText.slice(t.value, start, end));

  write(state, t, state.ctx.richText.remove(t.value, start, end), start, start);

  return { removed };
};

export const planTextReplace = (state: PlanState, args: Record<string, unknown>): unknown => {
  const t = target(state, args);
  const { start, end } = resolve(state, t, readRange(state, args.range ?? 'all'), '/range');
  const inserted = input(state, t, args.with, '/with');
  const length = state.ctx.richText.length(inserted);
  const removed = state.ctx.richText.remove(t.value, start, end);

  write(state, t, state.ctx.richText.insert(removed, start, inserted), start, start + length);

  return { length };
};

export const planTextFormat = (state: PlanState, args: Record<string, unknown>): unknown => {
  const t = target(state, args);
  const { start, end } = resolve(state, t, readRange(state, args.range), '/range');
  const marked: unknown = [{ text: '', ...(args.set !== undefined && { marks: args.set }) }];

  if (!isRichText(marked)) {
    state.fail('INVALID_ARGS', 'Marks must be a record.', '/set');
  }
  if (args.unset !== undefined && !isStringArray(args.unset)) {
    state.fail('INVALID_ARGS', 'Expected a list of mark names.', '/unset');
  }

  write(state, t, state.ctx.richText.format(t.value, start, end, marked[0]?.marks, args.unset), start, end);

  return {};
};
