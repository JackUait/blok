import { modelAnswer } from '../../../../src/shared/agent/model-answer';
import type { OutputBlockData } from '../../../../types';
import { openJsonSession, TEST_ACTOR } from '../harness';
import type { CorpusBatch, HostServices, ParityCase } from './corpus';
import { normalizeForParity } from './normalize';
import { runCorpusCase } from './run-case';

/** One batch's answer as the model reads it, with engine-minted values masked. */
export interface ProjectedAnswer {
  ok: boolean;
  error?: string;
  warnings: Array<{ code: unknown; commandIndex?: unknown }>;
  refs?: Record<string, string>;
  changed?: Record<'created' | 'updated' | 'moved' | 'removed', string[]>;
  blocks?: Array<Record<string, unknown>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const records = (value: unknown): Array<Record<string, unknown>> =>
  (Array.isArray(value) ? value.filter(isRecord) : []);

const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

const CHANGED_KEYS = ['created', 'updated', 'moved', 'removed'] as const;

const ATTRS = '\u0000attrs';

// Each row goes in as a root, so the normalizer keeps the order and only cleans data.
// attrs ride inside data so a database's view ids get the same dbid labels.
const cleanRows = (rows: Array<Record<string, unknown>>): Array<{ data?: Record<string, unknown>; attrs?: Record<string, unknown> }> => {
  const blocks: OutputBlockData[] = rows.map((row, index) => ({
    id: `row-${index}`,
    type: typeof row.type === 'string' ? row.type : '',
    data: { ...(isRecord(row.data) ? row.data : {}), ...(isRecord(row.attrs) && { [ATTRS]: row.attrs }) },
  }));
  const cleaned = normalizeForParity({ blocks }, new Set(blocks.map((block) => block.id ?? '')), { answerRows: true }).blocks;

  return rows.map((row, index) => {
    const { [ATTRS]: attrs, ...data } = cleaned[index]?.data ?? {};

    return {
      ...(isRecord(row.data) && { data }),
      ...(isRecord(row.attrs) && isRecord(attrs) && { attrs }),
    };
  });
};

const isIdKey = (key: string): boolean => key === 'id' || key.endsWith('Id');

/** Every string a case writes in its seed or its commands: anything else in an id field was minted. */
export const caseStrings = (c: ParityCase): Set<string> => {
  const found = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      found.add(value);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (isRecord(value)) {
      Object.values(value).forEach(walk);
    }
  };

  walk(c.seed);
  c.batches.forEach((batch) => batch.commands.forEach((command) => walk(command.args)));

  return found;
};

/**
 * Projects a case's per-batch answers so two engines compare equal when the
 * model would read the same thing. Ids the case did not write (`keep` holds what it
 * wrote; see caseStrings) are labelled, block ids and id fields inside row data alike:
 * `@name` for a ref, then `#n` in order of first sight (rows, then changed lists).
 * The labels carry across batches, so a later batch names the same block the same way.
 */
export const projectAnswers = (answers: Array<Record<string, unknown>>, keepIds: ReadonlySet<string>): ProjectedAnswer[] => {
  const labels = new Map<string, string>();
  const minted = { count: 0 };
  const label = (id: string, name?: string): string => {
    if (keepIds.has(id)) {
      return id;
    }
    if (!labels.has(id)) {
      minted.count += name === undefined ? 1 : 0;
      labels.set(id, name === undefined ? `#${minted.count}` : `@${name}`);
    }

    return labels.get(id) ?? id;
  };

  return answers.map((answer): ProjectedAnswer => {
    const warnings = records(answer.warnings).map((warning) => ({
      code: warning.code,
      ...(warning.commandIndex !== undefined && { commandIndex: warning.commandIndex }),
    }));

    if (answer.ok !== true) {
      return {
        ok: false,
        error: isRecord(answer.error) && typeof answer.error.code === 'string' ? answer.error.code : 'MISSING_ERROR',
        warnings,
      };
    }
    const refs = isRecord(answer.refs) ? answer.refs : {};
    const refEntries = Object.keys(refs).sort().flatMap((name) => {
      const id = refs[name];

      return typeof id === 'string' ? [[name, label(id, name)] as const] : [];
    });
    const rows = records(answer.blocks);
    const cleaned = cleanRows(rows);
    // dbid<n> and pos:<n> are the normalizer's own labels.
    const mask = (value: unknown, idField: boolean): unknown => {
      if (typeof value === 'string') {
        return idField && !/^(dbid\d+|pos:\d+)$/.test(value) ? label(value) : value;
      }
      if (Array.isArray(value)) {
        return value.map((item) => mask(item, idField));
      }

      return isRecord(value)
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mask(item, isIdKey(key) || (key === 'blocks' && Array.isArray(item)))]))
        : value;
    };
    const blocks = rows.map((row, index) => {
      const { id, parentId, data: _data, attrs: _attrs, meta, ...rest } = row;
      const { data, attrs } = cleaned[index];

      return {
        ...rest,
        // Clocks differ per runner: keep that the time is there, not its value.
        ...(isRecord(meta) && { meta: { ...meta, ...(meta.lastEditedAt !== undefined && { lastEditedAt: 'TIME' }) } }),
        ...(typeof id === 'string' && { id: label(id) }),
        ...(typeof parentId === 'string' && { parentId: label(parentId) }),
        ...(attrs !== undefined && { attrs: mask(attrs, false) }),
        ...(data !== undefined && { data: mask(data, false) }),
      };
    });
    const changedRaw = isRecord(answer.changed) ? answer.changed : {};
    const changed = Object.fromEntries(CHANGED_KEYS.map((key) => [
      key,
      strings(changedRaw[key]).map((id) => label(id)).sort(),
    ])) as Record<typeof CHANGED_KEYS[number], string[]>;

    return { ok: true, warnings, refs: Object.fromEntries(refEntries), changed, blocks };
  });
};

export interface AnswerRecorder {
  answers: Array<Record<string, unknown>>;
  execute(batch: CorpusBatch): Promise<{ ok: boolean; error?: { code: string } }>;
}

/** Wraps a session so runCorpusCase also keeps each batch's model answer. */
export const recordAnswers = (
  execute: (batch: CorpusBatch) => Promise<Record<string, unknown>>,
): AnswerRecorder => {
  const answers: Array<Record<string, unknown>> = [];

  return {
    answers,
    execute: async (batch) => {
      const answer = await execute(batch);
      const error = isRecord(answer.error) && typeof answer.error.code === 'string' ? { code: answer.error.code } : undefined;

      answers.push(answer);

      return { ok: answer.ok === true, ...(error !== undefined && { error }) };
    },
  };
};

/**
 * The reference answers: the json engine, given only the host services the
 * runner under test has, through the same modelAnswer both surfaces send.
 */
export const referenceAnswers = async (c: ParityCase, services: HostServices = { names: [], impl: {} }): Promise<Array<Record<string, unknown>>> => {
  const session = openJsonSession(c.seed, TEST_ACTOR, services);

  try {
    const recorder = recordAnswers(async (batch) => modelAnswer(await session.execute(batch)));

    await runCorpusCase(recorder, c);

    return recorder.answers;
  } finally {
    session.close();
  }
};
