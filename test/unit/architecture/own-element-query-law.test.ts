/**
 * Architectural enforcement: the Own-Element Query Law.
 *
 * A container block's holder CONTAINS its children's holders (toggle, callout
 * and column slots). So `holder.querySelector(marker)` can return a CHILD's
 * marker whenever the marker is one nested blocks also carry:
 *   - a value selector (`[data-blok-toggle-open="false"]`) skips the block's own
 *     marker and finds a nested one — an open toggle holding a collapsed toggle
 *     read as collapsed and hid every new child;
 *   - a presence selector on a block that has no marker of its own finds a
 *     child's — a callout holding a toggle read as a toggle.
 * The drag module shipped this bug (fixed in 71b86c20): a block dropped below a
 * collapsed toggle holding an open child toggle was swallowed and hidden.
 *
 * The law: a holder-rooted query for an at-risk marker goes through
 * `findOwn` (src/components/utils/own-element.ts), which only returns elements
 * whose nearest block holder is the block itself. A raw query is allowed only
 * with an exemption that says why it cannot see a child's marker. Exemptions
 * whose reason starts with `BUG:` are known defects in code this law did not
 * fix; they stay listed so they are easy to find.
 *
 * Not covered: `[data-blok-element-content]` (the holder's own direct child,
 * always first) and queries rooted on a tool's own wrapper rather than a holder.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isInstrumented } from '../helpers/instrumented';

const REPO_ROOT = resolve(__dirname, '../../..');
const HELPER_FILE = 'src/components/utils/own-element.ts';

/** Markers that nested blocks also render, so a holder-wide query can hit a child's. */
const AT_RISK = [
  // Matches the attribute, its camelCase key and a SCREAMING_CASE constant alike.
  /toggle[-_]?open/i,
  /toggle[-_]?children/i,
  /toggle[-_]?arrow/i,
  /toggle[-_]?content/i,
  /nested[-_]?blocks/i,
  /list[-_]?depth/i,
  /list[-_]?style/i,
  /heading[-_]?level/i,
  /listitem/i,
  /checkbox/i,
  /contenteditable/i,
  /\bh[1-6]\b/,
  /CHILD_SLOT_SELECTOR/,
  /LIST_TEST_IDS/,
];

/** `holder.`, `block.holder.`, `blockHolder?.` … followed by a querySelector call. */
const HOLDER_QUERY = /[\w$?.]*[hH]older\??\.querySelector(?:All)?(?:<[^>]*>)?\(/g;

interface ExemptSite {
  file: string;
  /** A substring of the call, read from the start of its line through the closing paren. */
  snippet: string;
  reason: string;
}

const EXEMPT_SITES: ExemptSite[] = [
  {
    file: 'src/tools/nested-blocks.ts',
    snippet: 'block.holder.querySelector(CHILD_SLOT_SELECTOR)',
    reason: 'presence of any slot: nested holders only live inside the block\'s own slot, so a slotless block has none',
  },
  {
    file: 'src/components/utils/home-slot.ts',
    snippet: 'holder.querySelector(CHILD_SLOT_SELECTOR)',
    reason: 'same rule as hierarchy.findHomeSlot: the own slot contains every nested slot and comes first',
  },
  {
    file: 'src/components/modules/blockManager/block-insertion.ts',
    snippet: "currentBlock.holder.querySelector('[contenteditable=\"true\"]:not([data-blok-mutation-free])')",
    reason: 'splitBlockWithData callers (toggle, toggle heading, list) render their own editable before any child slot',
  },
  {
    file: 'src/components/modules/blockManager/block-insertion.ts',
    snippet: "currentBlock?.holder?.querySelector('[data-blok-toggle-children]')",
    reason: 'the own slot comes first; the caret-in-slot check that follows separates title from child',
  },
  {
    file: 'src/markdown/markdown-handler.ts',
    snippet: "currentBlock?.holder?.querySelector('[data-blok-toggle-children]')",
    reason: 'the own slot comes first; the caret-in-slot check that follows separates title from child',
  },
  {
    file: 'src/components/modules/paste/handlers/blok-data-handler.ts',
    snippet: "currentBlock?.holder?.querySelector('[data-blok-toggle-children]')",
    reason: 'the own slot comes first; the caret-in-slot check that follows separates title from child',
  },
  {
    file: 'src/components/modules/paste/handlers/base.ts',
    snippet: "currentBlock?.holder?.querySelector('[data-blok-toggle-children]')",
    reason: 'the own slot comes first; the caret-in-slot check that follows separates title from child',
  },
  {
    file: 'src/tools/list/caret-manager.ts',
    snippet: "holder.querySelector('[contenteditable=\"true\"]:not([data-blok-mutation-free])')",
    reason: 'list items are slotless: their holder never contains another block',
  },
  {
    file: 'src/tools/list/caret-manager.ts',
    snippet: "holder?.querySelector('[contenteditable=\"true\"]:not([data-blok-mutation-free])')",
    reason: 'list items are slotless: their holder never contains another block',
  },
  {
    file: 'src/tools/list/depth-validator.ts',
    snippet: "block.holder?.querySelector('[role=\"listitem\"]')",
    reason: 'every caller checks name === list first, and list items are slotless',
  },
  {
    file: 'src/tools/list/marker-calculator.ts',
    snippet: "block.holder?.querySelector('[role=\"listitem\"]')",
    reason: 'every caller checks name === list first, and list items are slotless',
  },
  {
    file: 'src/tools/list/marker-calculator.ts',
    snippet: "block.holder?.querySelector('[data-list-style]')",
    reason: 'every caller checks name === list first, and list items are slotless',
  },
  {
    file: 'src/tools/list/list-helpers.ts',
    snippet: "blockHolder?.querySelector('[data-list-style=\"ordered\"]')",
    reason: 'every caller checks name === list first, and list items are slotless',
  },
  {
    file: 'src/tools/list/ordered-marker-manager.ts',
    snippet: "blockHolder?.querySelector('[data-list-style=\"ordered\"]')",
    reason: 'every caller checks name === list first, and list items are slotless',
  },
  {
    file: 'src/components/modules/blockEvents/composers/blockSelectionKeys.ts',
    snippet: "block.holder?.querySelector('[data-list-depth]')",
    reason: 'called only on list items (filtered by name), which are slotless',
  },
  {
    file: 'src/components/modules/blockEvents/composers/blockSelectionKeys.ts',
    snippet: "block.holder?.querySelector('input[type=\"checkbox\"]')",
    reason: 'gated on name === list, and list items are slotless',
  },
  {
    file: 'src/components/modules/toolbar/index.ts',
    snippet: "targetBlock.holder.querySelector('[data-blok-toggle-arrow]')",
    reason: 'gated on name === header; a header without its own arrow is slotless and holds no child',
  },
  {
    file: 'src/components/modules/toolbar/index.ts',
    snippet: "block.holder.querySelector('[data-blok-toggle-arrow]')",
    reason: 'gated on paragraph/header; a header without its own arrow is slotless and holds no child',
  },
  {
    file: 'src/components/modules/toolbar/index.ts',
    snippet: "'[data-blok-testid=\"callout-emoji-btn\"], [data-blok-toggle-arrow]'",
    reason: 'only called for callout/toggle/toggle heading, whose own emoji or arrow comes before their child slot',
  },
  {
    file: 'src/components/modules/ui.ts',
    snippet: "'[contenteditable]:not([data-blok-mutation-free])'",
    reason: 'every block gets the same value; a container without its own editable only re-sets a child to it',
  },
  {
    file: 'src/components/ui/toolbox.ts',
    snippet: "currentBlock.holder.querySelector<HTMLElement>('[contenteditable=\"true\"]:not([data-blok-mutation-free])')",
    reason: 'the current block holds the caret; tools with text render it before any child slot',
  },
  {
    file: 'src/tools/table/table-subsystems.ts',
    snippet: "input: block.holder.querySelector<HTMLElement>('[contenteditable=\"true\"]:not([data-blok-mutation-free])')",
    reason: 'a container in a cell resolves to its first child, which is a target too; wrapMark/unwrapMark are idempotent',
  },
  {
    file: 'src/components/inline-tools/inline-tool-link.ts',
    snippet: "block?.holder.querySelector('h1, h2, h3, h4, h5, h6')",
    reason: 'checks heading.closest(holder) === block.holder right after, so a child\'s heading is dropped',
  },
  {
    file: 'src/components/modules/rectangleSelection.ts',
    snippet: 'block.holder.querySelectorAll<HTMLElement>(createSelector(DATA_ATTR.nestedBlocks))',
    reason: 'ownChildrenSlot keeps only the slot whose nearest holder is the block',
  },
  {
    file: 'src/components/modules/blockEvents/composers/keyboardNavigation.ts',
    snippet: "'[data-blok-toggle-open], [data-blok-toggle-children], [data-blok-nested-blocks]'",
    reason: 'presence of any container marker: a block without its own slot holds no child',
  },
  {
    file: 'src/components/modules/blockEvents/composers/keyboardNavigation.ts',
    snippet: "const isToggleHeading = currentBlock.holder.querySelector('[data-blok-toggle-open]')",
    reason: 'only read for header/quote blocks; a header without its own marker is slotless, a quote always is',
  },
];

const SCAN_ROOTS = [
  'src',
  ...readdirSync(join(REPO_ROOT, 'packages'))
    .map((name) => join('packages', name, 'src'))
    .filter((dir) => {
      try {
        return statSync(join(REPO_ROOT, dir)).isDirectory();
      } catch {
        return false;
      }
    }),
];

const collectFiles = (root: string): string[] =>
  readdirSync(join(REPO_ROOT, root)).flatMap((entry) => {
    const path = join(root, entry);

    if (statSync(join(REPO_ROOT, path)).isDirectory()) {
      return collectFiles(path);
    }

    const isSource = /\.tsx?$/.test(entry) && !entry.endsWith('.d.ts') && !/\.(test|spec)\.tsx?$/.test(entry);

    return isSource ? [path] : [];
  });

const PAREN_STEP: Record<string, number> = { '(': 1, ')': -1 };

/** The source text from `start` through the paren that closes the one at `openParen`. */
const callText = (source: string, start: number, openParen: number): string => {
  const end = Array.from(source.slice(openParen)).reduce<{ depth: number; end: number }>(
    (acc, char, offset) => {
      if (acc.end !== -1) {
        return acc;
      }
      const depth = acc.depth + (PAREN_STEP[char] ?? 0);

      return { depth, end: depth === 0 ? openParen + offset + 1 : -1 };
    },
    { depth: 0, end: -1 }
  ).end;

  return source.slice(start, end === -1 ? source.length : end);
};

interface Hit {
  file: string;
  line: number;
  /** From the start of the call's line through its closing paren. */
  call: string;
}

const lineOf = (source: string, index: number): number => source.slice(0, index).split('\n').length;

const findHits = (): Hit[] =>
  SCAN_ROOTS.flatMap(collectFiles)
    .filter((file) => file !== HELPER_FILE)
    .flatMap((file) => {
      const source = readFileSync(join(REPO_ROOT, file), 'utf-8');

      return Array.from(source.matchAll(new RegExp(HOLDER_QUERY.source, HOLDER_QUERY.flags)))
        .map((match) => ({
          file,
          line: lineOf(source, match.index),
          call: callText(source, source.lastIndexOf('\n', match.index) + 1, match.index + match[0].length - 1),
        }))
        .filter((hit) => AT_RISK.some((pattern) => pattern.test(hit.call)));
    });

const isExempt = (hit: Hit): boolean =>
  EXEMPT_SITES.some((site) => site.file === hit.file && hit.call.includes(site.snippet));

describe('Own-Element Query Law: holder-rooted queries for nested-block markers go through findOwn', () => {
  it('every holder-rooted query for an at-risk marker uses findOwn or is exempted', () => {
    const violations = findHits()
      .filter((hit) => !isExempt(hit))
      .map((hit) =>
        `${hit.file}:${hit.line} ${hit.call.trim().replace(/\s+/g, ' ')} — a container's holder holds its children's ` +
        'holders, so this can return a CHILD\'s marker. Use findOwn(holder, selector) from ' +
        `${HELPER_FILE}, or add an EXEMPT_SITES entry saying why it cannot.`
      );

    expect(violations).toEqual([]);
  });

  it.skipIf(isInstrumented())('every exemption still matches real code (stale exemptions must be removed)', () => {
    const hits = findHits();
    const stale = EXEMPT_SITES
      .filter((site) => !hits.some((hit) => hit.file === site.file && hit.call.includes(site.snippet)))
      .map((site) => `${site.file}: exempted "${site.snippet}" no longer matches a holder query`);

    expect(stale).toEqual([]);
  });

  it('the scan sees the raw query this law replaced (self-check)', () => {
    const source = 'const a = block.holder.querySelector(\'[data-blok-toggle-open="false"]\') !== null;';
    const match = new RegExp(HOLDER_QUERY.source, HOLDER_QUERY.flags).exec(source);

    expect(match).not.toBeNull();
    expect(callText(source, 0, (match?.index ?? 0) + (match?.[0].length ?? 1) - 1))
      .toBe('const a = block.holder.querySelector(\'[data-blok-toggle-open="false"]\')');
  });
});
