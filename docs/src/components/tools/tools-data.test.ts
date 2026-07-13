// docs/src/components/tools/tools-data.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { defaultBlockTools, defaultInlineTools } from '../../../../src/tools/index';
import { DEFAULT_CAPTION_PLACEHOLDER } from '../../../../src/tools/audio/constants';
import {
  DOCUMENTED_BLOCK_TOOL_KEYS,
  DOCUMENTED_INLINE_TOOL_KEYS,
  TOOL_SECTIONS,
} from './tools-data';

/** Repo root — docs/src/components/tools → up four levels. */
const BLOK_ROOT = resolve(__dirname, '..', '..', '..', '..');
const readSource = (rel: string): string => readFileSync(join(BLOK_ROOT, rel), 'utf8');

describe('tools documentation coverage', () => {
  it('documents every key in defaultBlockTools', () => {
    for (const key of Object.keys(defaultBlockTools)) {
      expect(
        DOCUMENTED_BLOCK_TOOL_KEYS.has(key),
        `Block tool "${key}" is exported in defaultBlockTools but has no docs entry in tools-data.ts`
      ).toBe(true);
    }
  });

  it('documents every key in defaultInlineTools', () => {
    for (const key of Object.keys(defaultInlineTools)) {
      expect(
        DOCUMENTED_INLINE_TOOL_KEYS.has(key),
        `Inline tool "${key}" is exported in defaultInlineTools but has no docs entry in tools-data.ts`
      ).toBe(true);
    }
  });

  it('every TOOL_SECTIONS entry has a non-empty id, title, and description', () => {
    for (const section of TOOL_SECTIONS) {
      expect(section.id.length).toBeGreaterThan(0);
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.description.length).toBeGreaterThan(0);
    }
  });

  it('every TOOL_SECTIONS entry has a non-empty exportName', () => {
    for (const section of TOOL_SECTIONS) {
      expect(section.exportName.length).toBeGreaterThan(0);
    }
  });

  it('every TOOL_SECTIONS entry has a non-empty usageExample', () => {
    for (const section of TOOL_SECTIONS) {
      expect(section.usageExample.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate section ids', () => {
    const ids = TOOL_SECTIONS.map((section) => section.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicates).toEqual([]);
  });

  it('database description only names real PropertyType values', () => {
    // Root cause: the example type list was hand-authored and drifted from the
    // real union. "status" is not a PropertyType — a status column is a `select`.
    // See src/tools/database/types.ts.
    const typesSrc = readSource('src/tools/database/types.ts');
    const union = typesSrc.match(/export type PropertyType\s*=\s*([^;]+);/)?.[1] ?? '';
    const members = [...union.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(members).toContain('select');

    const description = TOOL_SECTIONS.find((s) => s.id === 'database')?.description ?? '';
    const listed = description.match(/typed properties \(([^)]+)\)/)?.[1] ?? '';
    const tokens = listed
      .split(',')
      .map((t) => t.trim().replace(/`/g, '').replace(/etc\.?/, '').trim())
      .filter(Boolean);
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(members, `database description names "${token}", not a PropertyType`).toContain(token);
    }
  });

  it('audio captionPlaceholder documents the effective default, matching video', () => {
    // Root cause: audio documented the config-level `undefined` instead of the
    // visible fallback (DEFAULT_CAPTION_PLACEHOLDER), diverging from the Video
    // tool which documents the effective value. See src/tools/audio/index.ts.
    const findCaption = (id: string) =>
      TOOL_SECTIONS.find((s) => s.id === id)?.configOptions?.find(
        (o) => o.option === 'captionPlaceholder',
      );
    const audio = findCaption('audio');
    const video = findCaption('video');
    expect(audio).toBeDefined();
    expect(video).toBeDefined();
    expect(audio!.default).toBe(`"${DEFAULT_CAPTION_PLACEHOLDER}"`);
    expect(audio!.default).toBe(video!.default);
  });
});
