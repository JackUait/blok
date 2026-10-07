// @vitest-environment node

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { deltaToSegments, type ReadDeltaOp } from '../../../src/shared/rich-text/delta';
import { CURRENT_RICH_TEXT_FIELDS } from '../../../src/shared/rich-text/fields';
import { canonicalizeSegments } from '../../../src/shared/rich-text/html-to-segments';
import type { RichText } from '../../../types/rich-text';

/**
 * The C# converter's canonical segments (RichText.cs) are pinned against
 * `expected.json`, and this test pins `expected.json` against the real
 * client functions. Key order is part of the contract, so the outputs are
 * compared as JSON strings. `UPDATE_RICH_TEXT_FIXTURES=1` rewrites the file.
 */
const DIRECTORY = new URL('./fixtures/rich-text-canonical/', import.meta.url);

interface Case<T> {
  name: string;
  input: T;
}

interface Inputs {
  segments: Array<Case<RichText>>;
  deltas: Array<Case<ReadDeltaOp[]>>;
}

const read = (file: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(file, DIRECTORY)), 'utf8'));

const inputs = read('inputs.json') as Inputs;

const actual = {
  segments: Object.fromEntries(inputs.segments.map(entry => [entry.name, canonicalizeSegments(entry.input)])),
  deltas: Object.fromEntries(inputs.deltas.map(entry => [entry.name, deltaToSegments(entry.input)])),
};

if (process.env.UPDATE_RICH_TEXT_FIXTURES === '1') {
  writeFileSync(fileURLToPath(new URL('expected.json', DIRECTORY)), `${JSON.stringify(actual, null, 2)}\n`);
}

const expected = read('expected.json') as typeof actual;

describe('rich-text canonical fixtures', () => {
  it('names every input case exactly once', () => {
    expect(Object.keys(expected.segments)).toEqual(inputs.segments.map(entry => entry.name));
    expect(Object.keys(expected.deltas)).toEqual(inputs.deltas.map(entry => entry.name));
  });

  it.each(inputs.segments.map(entry => entry.name))('canonicalizeSegments: %s', (name) => {
    expect(JSON.stringify(actual.segments[name])).toBe(JSON.stringify(expected.segments[name]));
  });

  it.each(inputs.deltas.map(entry => entry.name))('deltaToSegments: %s', (name) => {
    expect(JSON.stringify(actual.deltas[name])).toBe(JSON.stringify(expected.deltas[name]));
  });
});

describe('built-in rich-text fields fixture', () => {
  // The C# server reads the same file (RichTextFieldsTests), so the two
  // built-in tables cannot drift apart.
  it('equals CURRENT_RICH_TEXT_FIELDS', () => {
    expect(read('../rich-text-fields.json')).toEqual(CURRENT_RICH_TEXT_FIELDS);
  });
});
