import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ARCHITECTURE LAW — the Ask AI live preview never puts a node in the block tree.
 *
 * Holders are siblings: `setBlockParent`, `mountChildBlocks` and `caret.ts`
 * break on a foreign node between them. The preview draws in an overlay that is
 * a child of the editor wrapper, so every DOM insert in its code must target
 * the overlay layer or a node the overlay owns.
 */

const ASSISTANT = join(__dirname, '../../../src/components/modules/assistant');
const FILES = ['live-preview.ts', 'gap.ts'];

const INSERT_METHODS = new Set(['insertBefore', 'append', 'appendChild', 'after', 'before', 'replaceWith', 'prepend', 'insertAdjacentElement', 'replaceChildren']);

/** Receiver text → why it is an overlay node. */
const ALLOWED_RECEIVERS: Record<string, string> = {
  'this.deps.layer': 'The overlay host (the editor wrapper). Only group boxes are mounted here.',
  'this.box': 'A Group\'s box: an overlay root this module created.',
  'this.root': 'An Item\'s element (one insert command), created by this module inside a group box.',
  'this.el': 'A Line\'s content column (one preview block), created by this module inside an item.',
  target: 'A field of a preview block this module created: words land in it.',
  listItem: 'A list item element makeView just created, not yet mounted.',
  listRow: 'A list row makeView just created, not yet mounted.',
  rewriteFrame: 'A rewrite preview line makeView just created, not yet mounted; it holds the text around the range.',
  wrapper: 'A table or divider wrapper makeView just created, not yet mounted.',
  scroll: 'A preview table\'s scroll box, created by makeTable.',
  table: 'A preview <table>, created by makeTable.',
  colgroup: 'A preview table\'s <colgroup>, created by makeTable.',
  row: 'A row makeTable added to its own <tbody>.',
  cell: 'A preview table cell tableCell just created.',
  blocks: 'A preview cell\'s content box, created by tableCell.',
  gutter: 'The line numbers of a preview code block buildCodeDOM just created.',
  body: 'A preview callout\'s child container, created by makeCallout through buildCalloutDOM.',
  slot: 'A preview callout child\'s box, created by makeCallout.',
  landedWord: 'A word span this module created; it only gets its text reset.',
};

const insertCalls = (fileName: string, code: string): Array<{ receiver: string; method: string; line: number }> => {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  const found: Array<{ receiver: string; method: string; line: number }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && INSERT_METHODS.has(node.expression.name.text)) {
      found.push({
        receiver: node.expression.expression.getText(source),
        method: node.expression.name.text,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
};

const violations = (fileName: string, code: string): string[] =>
  insertCalls(fileName, code)
    .filter((call) => !(call.receiver in ALLOWED_RECEIVERS))
    .map((call) => `${fileName}:${call.line} ${call.receiver}.${call.method}()`);

describe('Ask AI preview overlay law', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('flags an insert whose receiver is not an overlay node', () => {
    const planted = 'holder.append(x);\nnode?.before(y);\nthis.container.insertBefore(a, b);\nthis.deps.layer.appendChild(box);';

    expect(violations('planted.ts', planted)).toEqual([
      'planted.ts:1 holder.append()',
      'planted.ts:2 node.before()',
      'planted.ts:3 this.container.insertBefore()',
    ]);
  });

  it('preview code only mounts into the overlay layer', () => {
    const found = FILES.flatMap((file) => violations(file, readFileSync(join(ASSISTANT, file), 'utf8')));

    expect(found).toEqual([]);
  });

  it('mounts something, so the scan is not vacuous', () => {
    const calls = insertCalls('live-preview.ts', readFileSync(join(ASSISTANT, 'live-preview.ts'), 'utf8'));

    expect(calls.some((call) => call.receiver === 'this.deps.layer')).toBe(true);
  });
});
