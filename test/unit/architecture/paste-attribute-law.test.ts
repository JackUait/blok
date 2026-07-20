/**
 * Architectural enforcement: the Paste Attribute Law.
 *
 * The law (see CLAUDE.md, Tools section): every attribute that a tool's
 * onPaste — or any helper it calls — reads from pasted DOM MUST be whitelisted
 * in that tool's `pasteConfig.tags`. Both sanitize passes (the whole-document
 * first pass in paste/index.ts and the per-node pass in html-handler.ts)
 * derive their attribute whitelists from `pasteConfig.tags`; a missing entry
 * means html-janitor silently strips the attribute before onPaste runs and
 * data is lost with no error. This is how pasted merged table cells were
 * flattened for months (fixed in c808b383), and how checklist checked state,
 * clipboard cell spans and more were lost (audited and fixed in ed5d9c7e).
 *
 * This test mechanically enforces the law so it cannot regress by oversight:
 *
 * 1. Every paste-path source file is scanned for DOM attribute reads:
 *    - `getAttribute('x')` / `hasAttribute('x')` (incl. optional chaining)
 *    - `.dataset.fooBar` (= data-foo-bar)
 *    - attribute selectors inside querySelector/querySelectorAll/closest/matches
 *    - `.checked` property reflection (strict paste-processing files only)
 * 2. Each attribute found must be either:
 *    - whitelisted in the owning tool's `pasteConfig.tags` (checked against
 *      the REAL config via SanitizerConfigBuilder — the same code the paste
 *      pipeline uses), or
 *    - `data-blok-*` (internal editor attributes, never pasted from outside), or
 *    - listed in EXEMPT_READS below with a reason explaining why the read is
 *      NOT on pasted DOM (own rendered DOM, editor DOM, …).
 * 3. Dynamic (non-literal) getAttribute/hasAttribute calls cannot be checked
 *    automatically, so each paste-path file declares exactly how many it has
 *    and which pasted attributes they can receive (EXPECTED_DYNAMIC_READS).
 *    A new dynamic call fails the count and forces classification.
 * 4. Completeness guards: every file under src/tools that mentions onPaste or
 *    has "paste" in its name, and every paste pipeline handler, must be
 *    registered here — new paste code cannot dodge the scan silently.
 *
 * If this test fails on your change: either add the attribute to the tool's
 * `pasteConfig.tags` (plus a test that pastes HTML carrying it through the
 * real sanitizer), or — only if the read is genuinely not on pasted DOM —
 * add an exemption below with a reason.
 *
 * Known limits (still covered by the law + per-tool paste tests): property
 * reflections other than `.checked` (e.g. `.src`) in non-strict files, and
 * attribute names built at runtime.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SanitizerConfigBuilder } from '../../../src/components/modules/paste/sanitizer-config';
import type { BlockToolAdapter } from '../../../src/components/tools/block';
import type { ToolsCollection } from '../../../src/components/tools/collection';
import { AudioTool } from '../../../src/tools/audio';
import { CalloutTool } from '../../../src/tools/callout';
import { CodeTool } from '../../../src/tools/code';
import { DividerTool } from '../../../src/tools/divider';
import { FileTool } from '../../../src/tools/file';
import { Header } from '../../../src/tools/header';
import { ImageTool } from '../../../src/tools/image';
import { Bookmark } from '../../../src/tools/link/bookmark';
import { Embed } from '../../../src/tools/link/embed';
import { ListItem } from '../../../src/tools/list';
import { Paragraph } from '../../../src/tools/paragraph';
import { Quote } from '../../../src/tools/quote';
import { Table } from '../../../src/tools/table';
import { ToggleItem } from '../../../src/tools/toggle';
import { VideoTool } from '../../../src/tools/video';
import type { PasteConfig } from '../../../types/configs/paste-config';

const REPO_ROOT = resolve(__dirname, '../../..');

interface ToolEntry {
  name: string;
  pasteConfig: PasteConfig | false | undefined;
  /** Repo-relative paste-path files (onPaste + every helper touching pasted DOM). */
  files: string[];
  /**
   * Files whose whole job is processing pasted DOM. These additionally get
   * property-reflection scanning (`.checked`).
   */
  strictFiles?: string[];
}

type ToolWithPasteConfig = { pasteConfig?: PasteConfig | false };

const toolPasteConfig = (tool: unknown): PasteConfig | false | undefined =>
  (tool as ToolWithPasteConfig).pasteConfig;

/**
 * Every tool with an onPaste handler, mapped to the files that constitute its
 * paste path. Guard tests below fail if a tool/file is missing here.
 */
const TOOL_REGISTRY: ToolEntry[] = [
  { name: 'audio', pasteConfig: toolPasteConfig(AudioTool), files: ['src/tools/audio/index.ts'] },
  { name: 'callout', pasteConfig: toolPasteConfig(CalloutTool), files: ['src/tools/callout/index.ts'] },
  { name: 'code', pasteConfig: toolPasteConfig(CodeTool), files: ['src/tools/code/index.ts'] },
  { name: 'divider', pasteConfig: toolPasteConfig(DividerTool), files: ['src/tools/divider/index.ts'] },
  { name: 'file', pasteConfig: toolPasteConfig(FileTool), files: ['src/tools/file/index.ts'] },
  { name: 'header', pasteConfig: toolPasteConfig(Header), files: ['src/tools/header/index.ts'] },
  { name: 'image', pasteConfig: toolPasteConfig(ImageTool), files: ['src/tools/image/index.ts'] },
  { name: 'bookmark', pasteConfig: toolPasteConfig(Bookmark), files: ['src/tools/link/bookmark/index.ts'] },
  { name: 'embed', pasteConfig: toolPasteConfig(Embed), files: ['src/tools/link/embed/index.ts'] },
  {
    name: 'list',
    pasteConfig: toolPasteConfig(ListItem),
    files: ['src/tools/list/index.ts', 'src/tools/list/static-configs.ts'],
    strictFiles: ['src/tools/list/paste-handler.ts'],
  },
  { name: 'paragraph', pasteConfig: toolPasteConfig(Paragraph), files: ['src/tools/paragraph/index.ts'] },
  { name: 'quote', pasteConfig: toolPasteConfig(Quote), files: ['src/tools/quote/index.ts'] },
  {
    name: 'table',
    pasteConfig: toolPasteConfig(Table),
    files: ['src/tools/table/index.ts'],
    strictFiles: ['src/tools/table/table-operations.ts', 'src/tools/table/table-cell-paste.ts'],
  },
  { name: 'toggle', pasteConfig: toolPasteConfig(ToggleItem), files: ['src/tools/toggle/index.ts'] },
  { name: 'video', pasteConfig: toolPasteConfig(VideoTool), files: ['src/tools/video/index.ts'] },
];

/**
 * Paste pipeline files that touch pasted DOM before/outside any single tool's
 * onPaste. Their reads are checked against the UNION of every tool's
 * whitelist plus the inline link-config attributes (href/target/rel handled
 * by apply-link-config + the inline sanitize config).
 */
const PIPELINE_FILES: string[] = [
  'src/components/modules/paste/handlers/base.ts',
  'src/components/modules/paste/handlers/blok-data-handler.ts',
  'src/components/modules/paste/handlers/files-handler.ts',
  'src/components/modules/paste/handlers/html-handler.ts',
  'src/components/modules/paste/handlers/pattern-handler.ts',
  'src/components/modules/paste/handlers/table-cells-handler.ts',
  'src/components/modules/paste/handlers/text-handler.ts',
  'src/components/utils/apply-link-config.ts',
];

const INLINE_LINK_ATTRS = new Set(['href', 'target', 'rel']);

interface ExemptRead {
  file: string;
  attr: string;
  reason: string;
}

/**
 * Attribute reads in paste-path files that are NOT on pasted DOM.
 * Every entry must say WHY. Adding an entry to silence a read that IS on
 * pasted DOM violates the law — whitelist it in pasteConfig instead.
 */
const EXEMPT_READS: ExemptRead[] = [
  {
    file: 'src/tools/code/index.ts',
    attr: 'aria-label',
    reason: 'read from the tool\'s own copy/settings buttons, not pasted DOM',
  },
  {
    file: 'src/tools/code/index.ts',
    attr: 'data-mode',
    reason: 'read from the tool\'s own view-mode toggle buttons, not pasted DOM',
  },
  {
    file: 'src/tools/code/index.ts',
    attr: 'data-line-index',
    reason: 'read from the tool\'s own rendered line gutter, not pasted DOM',
  },
  {
    file: 'src/tools/image/index.ts',
    attr: 'data-loading',
    reason: 'read from the tool\'s own rendered figure while uploading, not pasted DOM',
  },
  {
    file: 'src/tools/image/index.ts',
    attr: 'data-state',
    reason: 'read from the tool\'s own root to detect the error state, not pasted DOM',
  },
  {
    file: 'src/tools/list/index.ts',
    attr: 'data-list-marker',
    reason: 'selector over the tool\'s own rendered bullet marker, not pasted DOM',
  },
  {
    file: 'src/tools/table/table-cell-paste.ts',
    attr: 'checked',
    reason:
      'block-data property `data.checked` in the cell serializer, not a DOM read; ' +
      'pasted checkbox state is read via the list paste helpers and survives via ' +
      'sanitizeTable\'s explicit input whitelist (sanitizer-config.ts)',
  },
];

interface ExpectedDynamicReads {
  file: string;
  /** Exact number of non-literal getAttribute/hasAttribute calls in the file. */
  count: number;
  /**
   * Pasted-DOM attributes those dynamic calls can receive; each is verified
   * against the owning whitelist. Own-DOM-only dynamic calls contribute to
   * `count` but list no attrs.
   */
  pastedAttrs: string[];
  reason: string;
}

const EXPECTED_DYNAMIC_READS: ExpectedDynamicReads[] = [
  {
    file: 'src/tools/table/table-operations.ts',
    count: 2,
    pastedAttrs: ['colspan', 'rowspan'],
    reason:
      'getCellPosition reads CELL_COL_ATTR from the rendered grid (own DOM); ' +
      'parseSpan reads colspan/rowspan from pasted cells via parsePastedTable',
  },
  {
    file: 'src/components/modules/paste/handlers/html-handler.ts',
    count: 1,
    pastedAttrs: ['data-blok-columns-candidate'],
    reason:
      'isColumnsCandidateTable reads COLUMNS_CANDIDATE_ATTR — the stamp the ' +
      'Google Docs preprocessor sets on single-row tables so they expand ' +
      'into column blocks; whitelisted on TABLE in the table pasteConfig',
  },
];

/* ------------------------------------------------------------------ */
/* Scanning                                                            */
/* ------------------------------------------------------------------ */

interface AttributeRead {
  file: string;
  line: number;
  attr: string;
  via: string;
}

const LITERAL_ATTR_CALL = /(?:getAttribute|hasAttribute)(?:\?\.)?\(\s*(['"`])([^'"`]+)\1/g;
const DYNAMIC_ATTR_CALL = /(?:getAttribute|hasAttribute)(?:\?\.)?\(\s*(?!['"`])[^)]/g;
const DATASET_READ = /\.dataset\.([a-zA-Z_$][\w$]*)/g;
const SELECTOR_CALL = /(?:querySelector(?:All)?|closest|matches)(?:\?\.)?\(\s*(['"`])([^'"`]+)\1/g;
const SELECTOR_ATTR = /\[([a-zA-Z][\w-]*)/g;
const CHECKED_REFLECTION = /\.checked\b/g;

const camelToKebab = (name: string): string =>
  name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

const matchAll = (source: string, regex: RegExp): RegExpExecArray[] =>
  Array.from(source.matchAll(new RegExp(regex.source, regex.flags)));

const lineOf = (source: string, index: number): number =>
  source.slice(0, index).split('\n').length;

/**
 * Registered files may briefly not exist on a checkout (e.g. a file added on
 * another branch); skip them — the completeness guards ensure every existing
 * paste file is registered, so nothing real escapes the scan.
 */
const readSource = (relFile: string): string =>
  existsSync(join(REPO_ROOT, relFile)) ? readFileSync(join(REPO_ROOT, relFile), 'utf-8') : '';

/** Collect every statically detectable attribute read in a file. */
const collectAttributeReads = (relFile: string, strict: boolean): AttributeRead[] => {
  const source = readSource(relFile);
  const reads: AttributeRead[] = [];

  matchAll(source, LITERAL_ATTR_CALL).forEach((match) => {
    reads.push({ file: relFile, line: lineOf(source, match.index), attr: match[2], via: 'get/hasAttribute' });
  });

  matchAll(source, DATASET_READ).forEach((match) => {
    reads.push({
      file: relFile,
      line: lineOf(source, match.index),
      attr: `data-${camelToKebab(match[1])}`,
      via: 'dataset',
    });
  });

  matchAll(source, SELECTOR_CALL).forEach((selectorMatch) => {
    matchAll(selectorMatch[2], SELECTOR_ATTR).forEach((attrMatch) => {
      reads.push({
        file: relFile,
        line: lineOf(source, selectorMatch.index),
        attr: attrMatch[1],
        via: `selector "${selectorMatch[2]}"`,
      });
    });
  });

  if (strict) {
    matchAll(source, CHECKED_REFLECTION).forEach((match) => {
      reads.push({ file: relFile, line: lineOf(source, match.index), attr: 'checked', via: '.checked reflection' });
    });
  }

  return reads;
};

const countDynamicReads = (relFile: string): number =>
  matchAll(readSource(relFile), DYNAMIC_ATTR_CALL).length;

/* ------------------------------------------------------------------ */
/* Whitelist extraction — uses the SAME builder as the paste pipeline  */
/* ------------------------------------------------------------------ */

const builder = new SanitizerConfigBuilder(
  {} as unknown as ToolsCollection<BlockToolAdapter>,
  {}
);

const whitelistedAttrs = (pasteConfig: PasteConfig | false | undefined): Set<string> => {
  if (pasteConfig === false || pasteConfig === undefined) {
    return new Set();
  }

  const config = builder.buildToolConfig({ pasteConfig } as unknown as BlockToolAdapter);

  return new Set(
    Object.values(config)
      .flatMap((tagConfig) => (typeof tagConfig === 'object' && tagConfig !== null ? Object.keys(tagConfig) : []))
      .map((attr) => attr.toLowerCase())
  );
};

const UNION_WHITELIST = new Set([
  ...TOOL_REGISTRY.flatMap((entry) => [...whitelistedAttrs(entry.pasteConfig)]),
  ...INLINE_LINK_ATTRS,
]);

/* ------------------------------------------------------------------ */
/* Verdicts                                                            */
/* ------------------------------------------------------------------ */

const isInternalAttr = (attr: string): boolean => attr.toLowerCase().startsWith('data-blok-');

const isExempt = (read: AttributeRead): boolean =>
  EXEMPT_READS.some((exempt) => exempt.file === read.file && exempt.attr.toLowerCase() === read.attr.toLowerCase());

const violationsIn = (files: string[], strictFiles: string[], whitelist: Set<string>): string[] => {
  const allReads = [
    ...files.flatMap((file) => collectAttributeReads(file, false)),
    ...strictFiles.flatMap((file) => collectAttributeReads(file, true)),
  ];

  return allReads
    .filter((read) => !isInternalAttr(read.attr))
    .filter((read) => !whitelist.has(read.attr.toLowerCase()))
    .filter((read) => !isExempt(read))
    .map((read) => `${read.file}:${read.line} reads "${read.attr}" (via ${read.via}) — not whitelisted and not exempted`);
};

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('Paste Attribute Law: every attribute a paste path reads must be whitelisted in pasteConfig', () => {
  TOOL_REGISTRY.forEach((entry) => {
    it(`${entry.name}: all attribute reads in its paste path are whitelisted or exempted`, () => {
      const violations = violationsIn(entry.files, entry.strictFiles ?? [], whitelistedAttrs(entry.pasteConfig));

      /**
       * A violation means the sanitizer will strip this attribute BEFORE
       * onPaste sees it. Add it to the tool's pasteConfig.tags (plus a test
       * pasting HTML with that attribute through the real sanitizer), or add
       * an EXEMPT_READS entry if the read is not on pasted DOM.
       */
      expect(violations).toEqual([]);
    });
  });

  it('pipeline handlers: all attribute reads are whitelisted in some tool config or exempted', () => {
    const violations = violationsIn(PIPELINE_FILES, [], UNION_WHITELIST);

    expect(violations).toEqual([]);
  });

  it('dynamic getAttribute/hasAttribute calls are declared and their pasted attrs whitelisted', () => {
    const scannedFiles = [
      ...TOOL_REGISTRY.flatMap((entry) => [...entry.files, ...(entry.strictFiles ?? [])]),
      ...PIPELINE_FILES,
    ];

    const undeclared = scannedFiles
      .map((file) => ({ file, count: countDynamicReads(file) }))
      .filter(({ file, count }) => {
        const declared = EXPECTED_DYNAMIC_READS.find((expected) => expected.file === file);

        return count !== (declared?.count ?? 0);
      })
      .map(({ file, count }) => `${file}: has ${count} dynamic attribute read(s) — declare them in EXPECTED_DYNAMIC_READS with the attrs they can receive`);

    expect(undeclared).toEqual([]);

    const unwhitelistedDynamic = EXPECTED_DYNAMIC_READS.flatMap((declared) => {
      const owner = TOOL_REGISTRY.find(
        (entry) => entry.files.includes(declared.file) || (entry.strictFiles ?? []).includes(declared.file)
      );
      const whitelist = owner ? whitelistedAttrs(owner.pasteConfig) : UNION_WHITELIST;

      return declared.pastedAttrs
        .filter((attr) => !whitelist.has(attr.toLowerCase()))
        .map((attr) => `${declared.file}: dynamic read of pasted attr "${attr}" is not whitelisted in ${owner?.name ?? 'any tool'}'s pasteConfig`);
    });

    expect(unwhitelistedDynamic).toEqual([]);
  });
});

describe('Paste Attribute Law: completeness guards (new paste code cannot dodge the scan)', () => {
  const collectFiles = (root: string): string[] => {
    const entries = readdirSync(root);

    return entries.flatMap((entry) => {
      const fullPath = join(root, entry);

      if (statSync(fullPath).isDirectory()) {
        return collectFiles(fullPath);
      }

      return entry.endsWith('.ts') && !entry.endsWith('.d.ts') ? [fullPath] : [];
    });
  };

  const registeredFiles = new Set(
    TOOL_REGISTRY.flatMap((entry) => [...entry.files, ...(entry.strictFiles ?? [])])
  );
  const registeredToolDirs = new Set(
    TOOL_REGISTRY.flatMap((entry) => entry.files.map((file) => file.split('/').slice(0, -1).join('/')))
  );

  it('every src/tools file that defines an onPaste handler belongs to a registered tool', () => {
    const unregistered = collectFiles(join(REPO_ROOT, 'src/tools'))
      .map((file) => file.slice(REPO_ROOT.length + 1))
      .filter((file) => /(?:^|\s)(?:public\s+)?onPaste\s*\(/m.test(readSource(file)))
      .filter((file) => {
        const dir = file.split('/').slice(0, -1).join('/');

        return ![...registeredToolDirs].some((toolDir) => dir === toolDir || dir.startsWith(`${toolDir}/`));
      });

    expect(unregistered).toEqual([]);
  });

  it('every src/tools file with "paste" in its name is scanned', () => {
    const unscanned = collectFiles(join(REPO_ROOT, 'src/tools'))
      .map((file) => file.slice(REPO_ROOT.length + 1))
      .filter((file) => /paste/i.test(file.split('/').pop() ?? ''))
      .filter((file) => !registeredFiles.has(file));

    expect(unscanned).toEqual([]);
  });

  it('every paste pipeline handler file is scanned', () => {
    const unscanned = collectFiles(join(REPO_ROOT, 'src/components/modules/paste/handlers'))
      .map((file) => file.slice(REPO_ROOT.length + 1))
      .filter((file) => !PIPELINE_FILES.includes(file));

    expect(unscanned).toEqual([]);
  });

  it('every registered tool actually exposes a pasteConfig-compatible value', () => {
    TOOL_REGISTRY.forEach((entry) => {
      /**
       * `undefined` is allowed only for tools that genuinely define no
       * pasteConfig; a typo'd import would silently produce an empty
       * whitelist and mask violations, so require the key to exist.
       */
      expect(entry.pasteConfig, `${entry.name} pasteConfig`).toBeDefined();
    });
  });
});
