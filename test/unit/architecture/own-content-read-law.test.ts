/**
 * Architectural enforcement: the Own-Content Read Law.
 *
 * A container block's holder CONTAINS its children's holders, and a toggle keeps
 * chrome in the DOM at all times (the "Empty toggle…" body placeholder, the
 * arrow's svg whitespace). So reading text or HTML off a holder, the tool's
 * rendered root (`pluginsContent`) or a child slot reads the children and the
 * chrome as the block's own content:
 *   - `Block.isEmpty` read `$.isEmpty(this.pluginsContent)`, so every toggle
 *     looked filled: Cmd+A on an empty toggle title skipped the block stage and
 *     the plus button inserted below an empty toggle instead of reusing it;
 *   - copying a toggle put its children's text and the placeholder in its HTML.
 *
 * The law: a raw `.textContent` / `.innerText` / `.innerHTML` read, or a
 * `$.isEmpty(…)` call, on a holder, `pluginsContent`, `contentElement` or a
 * child container goes through the helpers in src/components/utils/own-element.ts
 * (`ownClone` for the block's own content, `isContentEmpty` / `textWithoutChrome`
 * for the subtree with chrome left out) or `Block.isEmpty`. A raw read is allowed only with an
 * exemption that says why it cannot see a child or chrome.
 *
 * Chrome is declared, not special-cased: a tool marks its UI (toggle arrow and
 * body placeholder, list marker, checkbox, code header and line numbers) with
 * `data-blok-chrome`, and the helpers skip that one attribute. The helper file
 * imports nothing from src/tools, so no tool's attributes creep into core.
 *
 * Not covered: reads off a tool's own inner element (a heading's `<h2>`, a
 * toggle's title editable) — those never hold another block.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isInstrumented } from '../helpers/instrumented';

const REPO_ROOT = resolve(__dirname, '../../..');
const HELPER_FILE = 'src/components/utils/own-element.ts';

/** Roots that can hold nested block holders or toggle chrome. */
// `(?<![\\w$])holder` keeps `placeholder` out; `Holder` still catches `blockHolder`, `childHolder`.
const ROOT = '[\\w$?.]*(?:(?<![\\w$])holder|Holder|pluginsContent|contentElement|[cC]hildContainer)\\w*';

/** `block.holder.textContent`, `childContainer?.innerHTML` … — but not an assignment to them. */
const RAW_READ = new RegExp(`${ROOT}\\??\\.(?:textContent|innerText|innerHTML)\\b(?!\\s*\\+?=(?!=))`, 'g');

/** `$.isEmpty(this.pluginsContent)`, `Dom.isEmpty(block.holder)` … */
const EMPTY_READ = new RegExp(`(?<![\\w$])(?:\\$|Dom|dom\\$)\\.isEmpty\\(\\s*${ROOT}`, 'g');

interface ExemptSite {
  file: string;
  /** A substring of the hit's line. */
  snippet: string;
  reason: string;
}

const EXEMPT_SITES: ExemptSite[] = [
  {
    file: 'src/components/utils/inline-normalization.ts',
    snippet: 'holder.innerHTML',
    reason: '`holder` is a detached container parsed from an HTML string, not a block holder',
  },
  {
    file: 'src/components/modules/blockSelection.ts',
    snippet: 'clean(holder.innerHTML, this.sanitizerConfig)',
    reason: '`holder` is a detached div holding a range clone clamped to one editing host, not a block holder',
  },
  {
    file: 'src/components/modules/toolbar/plus-button.ts',
    snippet: 'hoveredBlock.pluginsContent.textContent',
    reason: 'gated on paragraph, whose rendered root holds only its own editable; startsWith reads its first characters',
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

interface Hit {
  file: string;
  line: number;
  text: string;
}

const isComment = (line: string): boolean => /^\s*(?:\*|\/\*|\/\/)/.test(line);

const scan = (file: string, source: string): Hit[] =>
  source.split('\n').flatMap((text, index) => {
    if (isComment(text)) {
      return [];
    }
    const matches = [...text.matchAll(new RegExp(RAW_READ.source, 'g')), ...text.matchAll(new RegExp(EMPTY_READ.source, 'g'))];

    return matches.length > 0 ? [{ file, line: index + 1, text: text.trim() }] : [];
  });

const findHits = (): Hit[] =>
  SCAN_ROOTS.flatMap(collectFiles)
    .filter((file) => file !== HELPER_FILE)
    .flatMap((file) => scan(file, readFileSync(join(REPO_ROOT, file), 'utf-8')));

const isExempt = (hit: Hit): boolean =>
  EXEMPT_SITES.some((site) => site.file === hit.file && hit.text.includes(site.snippet));

/** An import in the helper file that reaches into a tool. */
const TOOL_IMPORT = /from\s+['"][./]*tools\//;

const toolImports = (source: string): string[] =>
  source.split('\n').filter((line) => TOOL_IMPORT.test(line));

describe('Own-Content Read Law: text/HTML reads of a block root go through the own-content helpers', () => {
  it('every raw text/HTML/emptiness read of a holder, pluginsContent or child container is routed or exempted', () => {
    const violations = findHits()
      .filter((hit) => !isExempt(hit))
      .map((hit) =>
        `${hit.file}:${hit.line} ${hit.text} — this root can hold nested blocks and toggle chrome, so the read ` +
        `counts them as the block's own content. Use ownClone / isContentEmpty / textWithoutChrome from ${HELPER_FILE} or ` +
        'Block.isEmpty, or add an EXEMPT_SITES entry saying why it cannot.'
      );

    expect(violations).toEqual([]);
  });

  it.skipIf(isInstrumented())('every exemption still matches real code (stale exemptions must be removed)', () => {
    const hits = findHits();
    const stale = EXEMPT_SITES
      .filter((site) => !hits.some((hit) => hit.file === site.file && hit.text.includes(site.snippet)))
      .map((site) => `${site.file}: exempted "${site.snippet}" no longer matches a raw read`);

    expect(stale).toEqual([]);
  });

  it('the scan sees the raw reads this law replaced, and skips writes and comments (self-check)', () => {
    const replaced = [
      '    const emptyText = $.isEmpty(this.pluginsContent);',
      "    const isEmpty = firstChild.holder.textContent === '';",
      "  return (holder.textContent ?? '').trim() === '';",
      "  const text = block.holder.textContent || '';",
      "  const text = childContainer?.textContent ?? '';",
    ];

    expect(replaced.map((line) => scan('x.ts', line).length)).toEqual([1, 1, 1, 1, 1]);
    expect(scan('x.ts', "    block.holder.innerHTML = '';")).toEqual([]);
    expect(scan('x.ts', '   * copy sanitizes `holder.innerHTML`')).toEqual([]);
    expect(scan('x.ts', 'const text = placeholder.textContent;')).toEqual([]);
    expect(scan('x.ts', 'const text = blockHolder?.innerHTML;')).toHaveLength(1);
  });

  it('the helpers skip chrome by the data-blok-chrome marker, not by tool-specific attributes', () => {
    const source = readFileSync(join(REPO_ROOT, HELPER_FILE), 'utf-8');

    expect(toolImports(source)).toEqual([]);
    expect(source).toContain('DATA_ATTR.chrome');
    // Self-check: the scan sees the toggle import this rule replaced.
    expect(toolImports("import { TOGGLE_ATTR } from '../../tools/toggle/constants';")).toHaveLength(1);
  });
});
