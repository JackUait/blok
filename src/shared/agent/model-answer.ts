import type { AgentResult } from '../../../types/agent';

/**
 * Most ids one list in a model's answer shows. Matches the changed-rows cap,
 * so a capped list covers the blocks the answer shows rows for.
 */
export const ANSWER_ID_LIMIT = 50;

type Answer = Record<string, unknown>;

const CHANGED_KEYS = ['created', 'updated', 'moved', 'removed'] as const;

// Only a delete lists ids the model already knows. A create's ids stay whole: the model needs them to address new blocks.
const CAPPED_RESULT_KEYS = ['removedIds', 'liftedIds'] as const;

const moreKey = (key: string): string => `more${key.charAt(0).toUpperCase()}${key.slice(1)}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const capped = (key: string, list: unknown[]): Answer => (list.length > ANSWER_ID_LIMIT
  ? { [key]: list.slice(0, ANSWER_ID_LIMIT), [moreKey(key)]: list.length - ANSWER_ID_LIMIT }
  : { [key]: list });

const cappedResult = (result: unknown): unknown => {
  if (!isRecord(result)) {
    return result;
  }

  return CAPPED_RESULT_KEYS.reduce<Answer>((out, key) => {
    const list = result[key];

    return Array.isArray(list) ? { ...out, ...capped(key, list) } : out;
  }, { ...result });
};

const cappedChanged = (changed: Record<string, unknown>): Answer => CHANGED_KEYS.reduce<Answer>((out, key) => {
  const list = changed[key];

  return Array.isArray(list) && list.length > 0 ? { ...out, ...capped(key, list) } : out;
}, {});

const isEmpty = (value: unknown): boolean =>
  (Array.isArray(value) && value.length === 0) || (isRecord(value) && Object.keys(value).length === 0);

const answerField = (key: string, value: unknown): unknown => {
  if (key === 'results' && Array.isArray(value)) {
    return value.map(cappedResult);
  }

  return key === 'changed' && isRecord(value) ? cappedChanged(value) : value;
};

// Warnings come right after ok: after up to 50 block rows a model skims past them.
const FIRST_KEYS = ['ok', 'warnings'];

/**
 * The answer a model sees for one batch: empty fields left out, long id lists capped.
 * Hosts keep the full result; only what goes to the model is trimmed.
 */
export const modelAnswer = (result: AgentResult): Answer => {
  const entries = Object.entries(result);
  const ordered = [
    ...FIRST_KEYS.flatMap(key => entries.filter(([name]) => name === key)),
    ...entries.filter(([name]) => !FIRST_KEYS.includes(name)),
  ];

  return Object.fromEntries(ordered.flatMap(([key, value]) => {
    const field = answerField(key, value);

    return ['refs', 'changed', 'warnings'].includes(key) && isEmpty(field) ? [] : [[key, field]];
  }));
};
