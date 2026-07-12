import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE LAW — the flat block store is NOT the document.
 *
 * "Everything Is a Block" (see CLAUDE.md) means nested-block tools keep their
 * children as REAL blocks in the SAME flat array as the document's blocks — and
 * they are appended at its TAIL:
 *
 *   api.blocks.insert(tool, data, {}, api.blocks.getBlocksCount(), false)
 *   (src/tools/table/table-cell-blocks.ts — table cells; columns/toggle/callout
 *    children land in the same store via parentId)
 *
 * So for a document ending in a table, `blocks[blocks.length - 1]` is the
 * table's bottom-right CELL paragraph, not the last block of the document. Core
 * modules that reached for that raw tail shipped real user traps:
 *
 *   - clicking the empty space below a trailing table dropped the caret INSIDE
 *     the bottom-right cell, with no way to escape below the table (ui.ts
 *     bottom zone + Caret.setToTheLastBlock read BlockManager.lastBlock);
 *   - insertAtEnd's appended block was adopted INTO the last column;
 *   - api.blocks.insertMany() with no index wedged blocks BETWEEN table cells;
 *   - a rubber-band lasso across a 3x3 table selected the table AND all nine
 *     cell paragraphs, so Duplicate duplicated the cells a second time.
 *
 * THE LAW:
 *   A. No core module (src/components/**) may derive "the last block of the
 *      document" from the tail of the flat store. Use `BlockManager.lastBlock` /
 *      `BlockRepository.lastBlock`, which skip nested children — or
 *      `topLevelBlocks` for the whole root enumeration.
 *   B. The parent-aware accessors must STAY parent-aware (nobody may "simplify"
 *      lastBlock back into `store[length - 1]`).
 *   C. Document-end insertion (`insertAtEnd`) must force top level, otherwise the
 *      appended block inherits the trailing container.
 *   D. Lasso selection must enumerate top-level blocks only — a child's holder is
 *      mounted INSIDE its root's holder (BlockHierarchy.setBlockParent), so any
 *      band that reaches a child also overlaps its root; selecting both is the
 *      duplicate-twice bug.
 *
 * NOT covered by this law (deliberately): `api.blocks.getBlocksCount()` /
 * `getBlockByIndex(index)` / `insert(…, index)` address the FLAT index space and
 * MUST keep doing so — that is the index space nested-block tools insert their
 * children with. Consumers that want the document's blocks derive the tree
 * (`parentId === null`, src/components/utils/blocks-tree.ts).
 */

const SRC_ROOT = join(__dirname, '../../../src');
const CORE_ROOT = join(SRC_ROOT, 'components');

const REPOSITORY_FILE = join(CORE_ROOT, 'modules/blockManager/repository.ts');
const INSERTION_FILE = join(CORE_ROOT, 'modules/blockManager/block-insertion.ts');
const RECTANGLE_FILE = join(CORE_ROOT, 'modules/rectangleSelection.ts');

/**
 * Raw flat-store tail reads. Each matches "give me the last element of the block
 * store", which is a nested child whenever the document ends in a container.
 */
const RAW_TAIL_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: 'store[…length - 1] (indexed tail read)',
    pattern: /(?:BlockManager|repository|this)\.blocks\s*\[[^\]]*\.length\s*-\s*1\s*\]/,
  },
  {
    name: 'blocksStore[…length - 1] (indexed tail read)',
    pattern: /blocksStore\s*\[[^\]]*\.length\s*-\s*1\s*\]/,
  },
  {
    name: 'store.length - 1 (last-index arithmetic)',
    pattern: /(?:BlockManager|repository|this)\.blocks\.length\s*-\s*1/,
  },
  {
    name: 'store.at(-1) (tail read)',
    pattern: /(?:BlockManager|repository|this)\.blocks\.at\(\s*-\s*1\s*\)/,
  },
];

/**
 * Files allowed to read the raw flat tail, with the reason why the nested-child
 * tail is harmless there. Keys are relative to src/components/.
 *
 * Currently EMPTY — no core module needs the raw tail. `BlockRepository` walks the
 * store backwards to find the last TOP-LEVEL block (pinned by law B) and
 * `BlockInsertion.insertAtEnd` addresses the flat append slot through
 * `repository.length` (never `.blocks[length - 1]`), so neither trips the scan.
 * If you must add an entry, justify why the tail block being a table cell /
 * column child cannot hurt there.
 */
const EXEMPTIONS: Record<string, string> = {};

const collectCoreFiles = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      collectCoreFiles(full, out);
    } else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) {
      out.push(full);
    }
  }

  return out;
};

/**
 * Comment lines describe the trap (this law quotes it) — they are not code.
 */
const isCodeLine = (line: string): boolean => !/^\s*(?:\/\/|\*|\/\*)/.test(line);

/**
 * Report every raw flat-tail read in one file, as "path:line — pattern".
 */
const scanFile = (file: string): string[] => {
  const relPath = relative(CORE_ROOT, file);
  const lines = readFileSync(file, 'utf8').split('\n');

  return RAW_TAIL_PATTERNS.flatMap(({ name, pattern }) =>
    lines
      .map((line, index) => ({ line,
        number: index + 1 }))
      .filter(({ line }) => isCodeLine(line) && pattern.test(line))
      .map(({ line, number }) => `${relPath}:${number} — ${name}\n      ${line.trim()}`)
  );
};

/**
 * Extract a method body by brace matching, so the law asserts against the real
 * method and not an unrelated coincidence elsewhere in the file.
 */
const extractMember = (source: string, signature: string): string => {
  const start = source.indexOf(signature);

  expect(start, `Member not found (renamed?): ${signature}`).toBeGreaterThan(-1);

  const bodyStart = source.indexOf('{', start);
  let depth = 0;

  for (let index = bodyStart; index < source.length; index++) {
    const char = source[index];

    depth += char === '{' ? 1 : 0;
    depth -= char === '}' ? 1 : 0;

    if (depth === 0 && char === '}') {
      return source.slice(bodyStart, index + 1);
    }
  }

  throw new Error(`Unbalanced braces while extracting ${signature}`);
};

describe('top-level block enumeration law', () => {
  const coreFiles = collectCoreFiles(CORE_ROOT);

  it('scans the core modules (guards against the scan silently going stale)', () => {
    const relative_ = coreFiles.map((file) => relative(CORE_ROOT, file));

    expect(coreFiles.length).toBeGreaterThan(50);
    expect(relative_).toContain('modules/ui.ts');
    expect(relative_).toContain('modules/caret.ts');
    expect(relative_).toContain('modules/rectangleSelection.ts');
    expect(relative_).toContain('modules/api/blocks.ts');
    expect(relative_).toContain('modules/blockManager/repository.ts');
  });

  it('LAW A: no core module reads the tail of the flat block store', () => {
    const violations = coreFiles
      .filter((file) => !(relative(CORE_ROOT, file) in EXEMPTIONS))
      .flatMap((file) => scanFile(file));

    expect(
      violations,
      'These core modules read the tail of the FLAT block store. When the document ' +
      'ends in a table / columns / toggle, that tail is a NESTED CHILD (cell paragraph, ' +
      'column child), not the last block of the document:\n' +
      violations.map((violation) => `  - ${violation}`).join('\n') +
      '\nUse BlockManager.lastBlock / BlockManager.topLevelBlocks (parent-aware), or add ' +
      'an exemption with a reason.'
    ).toEqual([]);
  });

  it('every exemption still points at a file that reads the raw tail (no stale entries)', () => {
    for (const [exemptPath, reason] of Object.entries(EXEMPTIONS)) {
      const hits = scanFile(join(CORE_ROOT, exemptPath));

      expect(hits.length, `Stale exemption: ${exemptPath} no longer reads the raw flat tail`).toBeGreaterThan(0);
      expect(reason.length, `Exemption for ${exemptPath} needs a non-trivial reason`).toBeGreaterThan(20);
    }
  });

  it('LAW B: BlockRepository.lastBlock and topLevelBlocks stay parent-aware', () => {
    const source = readFileSync(REPOSITORY_FILE, 'utf8');

    const lastBlock = extractMember(source, 'public get lastBlock()');
    const topLevelBlocks = extractMember(source, 'public get topLevelBlocks()');

    expect(
      lastBlock,
      'BlockRepository.lastBlock must skip nested children — either by filtering on ' +
      'block.parentId === null or by deriving from topLevelBlocks. Reverting it to the ' +
      'raw store tail puts the caret inside a trailing table cell.'
    ).toMatch(/parentId\s*===\s*null|topLevelBlocks/);

    expect(
      topLevelBlocks,
      'BlockRepository.topLevelBlocks must filter on parentId === null.'
    ).toMatch(/parentId\s*===\s*null/);
  });

  it('LAW C: insertAtEnd appends at the document root (forceTopLevel)', () => {
    const source = readFileSync(INSERTION_FILE, 'utf8');
    const insertAtEnd = extractMember(source, 'public insertAtEnd(');

    expect(
      insertAtEnd,
      'BlockInsertion.insertAtEnd must pass forceTopLevel: true. Without it, insert()\'s ' +
      'column-inheritance rescue adopts the appended block INTO the trailing column, so ' +
      '"add a block below the document" writes inside the columns.'
    ).toMatch(/forceTopLevel:\s*true/);
  });

  it('LAW D: the lasso enumerates top-level blocks only', () => {
    const source = readFileSync(RECTANGLE_FILE, 'utf8');
    const trySelectNextBlock = extractMember(source, 'private trySelectNextBlock(');

    expect(
      trySelectNextBlock,
      'RectangleSelection.trySelectNextBlock must skip nested blocks (parentId !== null). ' +
      'A child holder is mounted INSIDE its root holder, so a band that reaches a cell ' +
      'also overlaps the table — selecting both makes Duplicate duplicate the cells twice.'
    ).toMatch(/parentId\s*!==\s*null/);
  });
});
