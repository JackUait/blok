/**
 * Architectural enforcement: the Paste Stamp Law — the WRITE-side complement
 * of the Paste Attribute Law (paste-attribute-law.test.ts).
 *
 * The paste pipeline pre-passes STAMP metadata onto pasted DOM before
 * sanitization — e.g. preprocessNestedLists stamps `aria-level` (nesting
 * depth) and `data-list-style` (ordered context) onto every `<li>`. Those
 * stamps only reach tool onPaste handlers if the sanitizer keeps them:
 * either via STRUCTURAL_TAG_ATTRIBUTES or via some tool's pasteConfig
 * whitelist. A stamp outside both is silently stripped — core code destroying
 * what other core code just wrote. That drift was layer 1 of the root cause
 * of "pasted table loses bullet points" (db4c243d): the pre-pass stamped
 * aria-level/data-list-style, and the structural sanitize config gave
 * `li: {}`, stripping them before the table tool could read nesting depth.
 *
 * This test mechanically keeps the two sides in sync:
 *
 * 1. Every .ts file under src/components/modules/paste is scanned for literal
 *    `setAttribute('x', ...)` calls (directory walk — new pre-passes cannot
 *    dodge the scan).
 * 2. Each stamped attribute must be:
 *    - `data-blok-*` (internal editor channel, preserved by design), or
 *    - present in STRUCTURAL_TAG_ATTRIBUTES (the structural survival layer), or
 *    - whitelisted in at least one tool's pasteConfig (checked against the
 *      REAL configs via SanitizerConfigBuilder — the same code the pipeline
 *      uses), or
 *    - listed in EXEMPT_STAMPS with a reason explaining why the stamp does
 *      not need to survive sanitization.
 *
 * If this test fails on your change: add the attribute to
 * STRUCTURAL_TAG_ATTRIBUTES (plus a test pasting HTML through the real
 * sanitizer proving it survives), or exempt it with a reason if it is
 * genuinely not consumed downstream.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { STRUCTURAL_TAG_ATTRIBUTES } from '../../../src/components/modules/paste/constants';
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
import type { BlokConfig } from '../../../types/configs/blok-config';
import type { PasteConfig } from '../../../types/configs/paste-config';

const REPO_ROOT = resolve(__dirname, '../../..');
const SCAN_ROOT = 'src/components/modules/paste';

interface ExemptStamp {
  file: string;
  attr: string;
  reason: string;
}

/**
 * Stamps that deliberately do NOT need to survive sanitization.
 * Every entry must say WHY. Adding an entry to silence a stamp that a tool
 * DOES read downstream violates the law — whitelist it instead.
 */
const EXEMPT_STAMPS: ExemptStamp[] = [
  {
    file: 'src/components/modules/paste/index.ts',
    attr: 'data-drop-indicator',
    reason: 'stamped on the editor\'s own block holder to show a drop edge — editor DOM, never pasted DOM',
  },
  {
    file: 'src/components/modules/paste/gfm-toggle-recovery.ts',
    attr: 'open',
    reason:
      'semantic decoration on the synthesized <details> so the raw markup is a valid ' +
      'expanded toggle; ToggleItem.onPaste reads only the summary text and open-state ' +
      'is not part of pasted fidelity',
  },
];

type ToolWithPasteConfig = { pasteConfig?: PasteConfig | false };

const TOOL_CLASSES: unknown[] = [
  AudioTool, CalloutTool, CodeTool, DividerTool, FileTool, Header, ImageTool,
  Bookmark, Embed, ListItem, Paragraph, Quote, Table, ToggleItem, VideoTool,
];

const builder = new SanitizerConfigBuilder(
  {} as unknown as ToolsCollection<BlockToolAdapter>,
  {} as BlokConfig
);

const pasteConfigUnion = (): Set<string> => {
  const attrs = new Set<string>();

  for (const toolClass of TOOL_CLASSES) {
    const pasteConfig = (toolClass as ToolWithPasteConfig).pasteConfig;

    if (pasteConfig === false || pasteConfig === undefined) {
      continue;
    }

    const config = builder.buildToolConfig({ pasteConfig } as unknown as BlockToolAdapter);

    Object.values(config).forEach((tagConfig) => {
      if (typeof tagConfig === 'object' && tagConfig !== null) {
        Object.keys(tagConfig).forEach((attr) => attrs.add(attr.toLowerCase()));
      }
    });
  }

  return attrs;
};

const structuralUnion = (): Set<string> =>
  new Set(
    Object.values(STRUCTURAL_TAG_ATTRIBUTES)
      .flatMap((tagConfig) => Object.keys(tagConfig))
      .map((attr) => attr.toLowerCase())
  );

const SURVIVING_ATTRS = new Set([...structuralUnion(), ...pasteConfigUnion()]);

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

const LITERAL_SET_ATTRIBUTE = /\.setAttribute\(\s*(['"`])([^'"`]+)\1/g;

const lineOf = (source: string, index: number): number =>
  source.slice(0, index).split('\n').length;

describe('Paste Stamp Law: attributes the paste pipeline stamps must survive sanitization', () => {
  it('every literal setAttribute in the paste module is surviving, internal, or exempted', () => {
    const violations = collectFiles(join(REPO_ROOT, SCAN_ROOT))
      .map((file) => file.slice(REPO_ROOT.length + 1))
      .flatMap((file) => {
        const source = readFileSync(join(REPO_ROOT, file), 'utf-8');

        return Array.from(source.matchAll(new RegExp(LITERAL_SET_ATTRIBUTE.source, LITERAL_SET_ATTRIBUTE.flags)))
          .filter((match) => !match[2].toLowerCase().startsWith('data-blok-'))
          .filter((match) => !SURVIVING_ATTRS.has(match[2].toLowerCase()))
          .filter((match) =>
            !EXEMPT_STAMPS.some((exempt) => exempt.file === file && exempt.attr.toLowerCase() === match[2].toLowerCase())
          )
          .map((match) =>
            `${file}:${lineOf(source, match.index)} stamps "${match[2]}" — the sanitizer will strip it ` +
            'before any tool onPaste sees it. Add it to STRUCTURAL_TAG_ATTRIBUTES (plus a test pasting ' +
            'HTML through the real sanitizer), or add an EXEMPT_STAMPS entry with a reason if it is not ' +
            'consumed downstream.'
          );
      });

    expect(violations).toEqual([]);
  });

  it('every exemption still matches real code (stale exemptions must be removed)', () => {
    const stale = EXEMPT_STAMPS
      .filter((exempt) => {
        const fullPath = join(REPO_ROOT, exempt.file);
        const source = readFileSync(fullPath, 'utf-8');

        return !new RegExp(`setAttribute\\(\\s*['"\`]${exempt.attr}['"\`]`).test(source);
      })
      .map((exempt) => `${exempt.file}: exempted stamp "${exempt.attr}" no longer exists`);

    expect(stale).toEqual([]);
  });

  it('the known list stamps are covered by STRUCTURAL_TAG_ATTRIBUTES (the original regression)', () => {
    // Layer 1 of db4c243d: preprocessNestedLists stamps these on <li> and the
    // structural config must keep them, or nesting depth / ordered context is
    // silently lost for every tool that parses lists out of pasted HTML.
    expect(STRUCTURAL_TAG_ATTRIBUTES.li).toMatchObject({
      'aria-level': true,
      'data-list-style': true,
    });
  });
});
