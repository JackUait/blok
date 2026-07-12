import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE LAW — a tool may not insert blocks at the END OF THE FLAT ARRAY.
 *
 * `api.blocks.insert(tool, data, tunes, api.blocks.getBlocksCount(), …)` says
 * "append to the very end of the document". For a NESTED tool (a table creating
 * its cell blocks, a container seeding children) that is never the intent: the
 * intent is "a child of MY block". Expressing it as a tail-append means the
 * block is momentarily a root-level sibling of the last document block, and its
 * real position/parent only gets fixed up afterwards by a separate
 * `setBlockParent` call. Any path that reads the tree between those two steps
 * (a lifecycle hook, a Yjs observer, a save racing an in-flight render) sees a
 * block that escaped its container.
 *
 * THE LAW: no file under `src/tools/` may pass `getBlocksCount()` as the index
 * argument of `blocks.insert(...)` unless it is listed in EXEMPTIONS below with
 * a written reason. Prefer an API that carries the parent intent —
 * `api.blocks.insertInsideParent(parentId, index)` — or compute an index
 * relative to the owning block.
 *
 * If this test failed because you added a tail-append: rewrite it to express
 * parent intent. Only add an exemption if you can state, in words, why the
 * block cannot be observed while it is parked at the document tail.
 */

const TOOLS_ROOT = join(__dirname, '../../../src/tools');

/**
 * Files allowed to keep a tail-append, with the reason it is safe there.
 * Keys are paths relative to src/tools/.
 */
const EXEMPTIONS: Record<string, string> = {
  'table/table-cell-blocks.ts':
    'Cell-block creation: every insert(…, getBlocksCount(), …) here is followed ' +
    'SYNCHRONOUSLY, in the same statement block, by ' +
    'api.blocks.setBlockParent(block.id, this.tableBlockId), which reparents the ' +
    'block into the table and moves its holder into the cell before control ' +
    'returns to any other code. The tail index is only a parking slot. Any NEW ' +
    'insert in this file must keep that pairing (asserted below).',
  'table/table-subsystems.ts':
    'Row/column duplication path: same pairing — the inserted paragraph is ' +
    'immediately claimed by setBlockParent(…, tableBlockId) in the same block, ' +
    'so it is never observable as a root-level sibling (asserted below).',
};

/** Files whose tail-appends are exempt because they reparent immediately. */
const REPARENT_PAIRED = new Set(Object.keys(EXEMPTIONS));

const collectSourceFiles = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) {
      out.push(full);
    }
  }

  return out;
};

/**
 * Matches a `blocks.insert(` call whose argument list contains `getBlocksCount()`
 * before the call is closed. Written as a scan rather than a single regex so a
 * multi-line insert() (the common shape in the table tool) is caught too.
 * @param source - file contents
 */
const findCallEnd = (source: string, argsStart: number): number => {
  let depth = 1;
  let cursor = argsStart;

  while (cursor < source.length && depth > 0) {
    const char = source[cursor];

    depth += char === '(' ? 1 : 0;
    depth -= char === ')' ? 1 : 0;
    cursor += 1;
  }

  return cursor - 1;
};

const findTailAppendCalls = (source: string): string[] => {
  const calls: string[] = [];
  const insertPattern = /blocks\s*\.\s*insert\s*\(/g;
  let match = insertPattern.exec(source);

  while (match !== null) {
    const argsStart = match.index + match[0].length;
    const args = source.slice(argsStart, findCallEnd(source, argsStart));

    if (args.includes('getBlocksCount()')) {
      calls.push(args.replace(/\s+/g, ' ').trim());
    }

    match = insertPattern.exec(source);
  }

  return calls;
};

const findTailAppendFiles = (): string[] =>
  collectSourceFiles(TOOLS_ROOT).filter((file) => findTailAppendCalls(readFileSync(file, 'utf8')).length > 0);

describe('tool tail-append law', () => {
  it('the scan actually detects a tail-append (mutation check)', () => {
    const fixture = `
      const block = this.api.blocks.insert('paragraph', { text: '' }, {}, this.api.blocks.getBlocksCount(), false);
      const other = this.api.blocks.insert(
        'paragraph',
        {},
        {},
        this.api.blocks.getBlocksCount(),
        false
      );
      const safe = this.api.blocks.insert('paragraph', {}, {}, index + 1, false);
    `;

    expect(findTailAppendCalls(fixture)).toHaveLength(2);
    expect(findTailAppendCalls(`api.blocks.insert('paragraph', {}, {}, 3, false);`)).toEqual([]);
  });

  it('no tool inserts blocks at the end of the flat array (or is exempt with a reason)', () => {
    const violations = findTailAppendFiles()
      .map((file) => relative(TOOLS_ROOT, file))
      .filter((relPath) => !(relPath in EXEMPTIONS));

    expect(
      violations,
      `These tool files insert blocks at the end of the flat block array:\n` +
      violations.map((violation) => `  - ${violation}`).join('\n') +
      `\n"The end of the document" is almost never a nested tool's intent. Use ` +
      `api.blocks.insertInsideParent(parentId, index) — or an index relative to ` +
      `the owning block — so the insert carries its parent intent. If the tail ` +
      `index is genuinely a parking slot that is reparented before anything can ` +
      `observe it, add an exemption with a reason.`
    ).toEqual([]);
  });

  it('every exemption still tail-appends and still reparents immediately (no stale entries)', () => {
    const tailAppendFiles = new Set(findTailAppendFiles().map((file) => relative(TOOLS_ROOT, file)));

    for (const [exemptPath, reason] of Object.entries(EXEMPTIONS)) {
      expect(
        tailAppendFiles.has(exemptPath),
        `Stale exemption: ${exemptPath} no longer tail-appends — drop the entry`
      ).toBe(true);
      expect(reason.length, `Exemption for ${exemptPath} needs a non-trivial reason`).toBeGreaterThan(40);
    }
  });

  it('exempt files back their claim: the tail-append is paired with a reparent into the table', () => {
    for (const relPath of REPARENT_PAIRED) {
      const source = readFileSync(join(TOOLS_ROOT, relPath), 'utf8');
      const reparentsIntoTable = /setBlockParent\s*\([^;]*?(tableBlockId|blockId)/.test(source);

      expect(
        reparentsIntoTable,
        `${relPath} is exempt because every tail-append is immediately reparented ` +
        `into the table, but the file no longer calls ` +
        `setBlockParent(…, <the table's block id>). Either restore the pairing or ` +
        `drop the exemption and express the insert's parent intent directly.`
      ).toBe(true);
    }
  });
});
