import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { expect } from 'vitest';

import { diffOutputData } from '../../../../src/view/diff-output-data';
import type { OutputBlockData } from '../../../../types';
import type { CorpusBatch, Expectation, ParityCase } from './corpus';
import { goldenPath } from './corpus';
import type { ParityDocument } from './normalize';
import { stableStringify } from './normalize';

export interface SessionLike {
  execute(batch: CorpusBatch): Promise<{ ok: boolean; error?: { code: string } }>;
}

export const runCorpusCase = async (session: SessionLike, c: ParityCase): Promise<Expectation> => {
  for (const batch of c.batches) {
    const result = await session.execute(batch);

    if (!result.ok) {
      return { errorCode: result.error?.code ?? 'MISSING_ERROR' };
    }
  }

  return 'ok';
};

export interface GoldenFile {
  reviewed: string | false;
  document: ParityDocument;
}

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !isArray(value);

const isOutputBlock = (value: unknown): value is OutputBlockData =>
  isRecord(value) && typeof value.type === 'string' && isRecord(value.data)
  && [value.id, value.parent, value.lastEditedBy, value.lastEditedWith, value.createdBy, value.createdWith]
    .every((field) => field === undefined || typeof field === 'string')
  && [value.indent, value.lastEditedAt, value.createdAt]
    .every((field) => field === undefined || typeof field === 'number')
  && (value.tunes === undefined || isRecord(value.tunes))
  && (value.content === undefined
    || (isArray(value.content) && value.content.every((id) => typeof id === 'string')));

const isParityDocument = (value: unknown): value is ParityDocument =>
  isRecord(value) && isArray(value.blocks) && value.blocks.every(isOutputBlock)
  && (value.title === undefined || typeof value.title === 'string')
  && (value.icon === undefined || (isRecord(value.icon)
    && ((value.icon.type === 'emoji' && typeof value.icon.value === 'string')
      || (value.icon.type === 'image' && typeof value.icon.url === 'string'))));

export const readGolden = (name: string): GoldenFile | null => {
  const path = goldenPath(name);

  if (!existsSync(path)) {
    return null;
  }

  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));

  if (!isRecord(value) || (value.reviewed !== false && typeof value.reviewed !== 'string')
    || !isParityDocument(value.document)) {
    throw new Error(`Invalid golden: ${path}`);
  }

  return { reviewed: value.reviewed, document: value.document };
};

export const compareToGolden = (c: ParityCase, actual: ParityDocument): void => {
  const existing = readGolden(c.name);

  if (process.env.BLOK_UPDATE_GOLDENS === '1') {
    expect(existing?.reviewed ?? false, `${c.name}: a reviewed golden is edited by hand, never regenerated`).toBe(false);
    const path = goldenPath(c.name);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ reviewed: false, document: actual }, null, 2)}\n`);

    return;
  }

  if (existing === null) {
    throw new Error(`No golden for ${c.name}. Run BLOK_UPDATE_GOLDENS=1 on the json runner, then review it.`);
  }

  const actualJson = stableStringify(actual);
  const goldenJson = stableStringify(existing.document);

  // Content first, so a runner that disagrees with json shows up before review.
  if (actualJson !== goldenJson) {
    expect(diffOutputData(existing.document, actual), `${c.name} differs from its golden`).toEqual({
      added: [], removed: [], changed: [], moved: [],
    });
  }

  expect(actualJson, `${c.name} differs from its golden`).toBe(goldenJson);
  expect(existing.reviewed, `${c.name}: golden not reviewed. Check it by hand, then set "reviewed" to your name.`).not.toBe(false);
};
