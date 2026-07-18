import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  findDuplicateJsonKeys,
  findLocaleIntegrityIssues,
} from '../../../../scripts/i18n/check-translations.mjs';

type EnglishMessages = Record<string, string>;
type LocaleMessages = Record<string, unknown>;

const LOCALES_DIR = resolve(
  __dirname,
  '../../../../src/components/i18n/locales'
);
const AUDIT_LEDGER_PATH = resolve(
  __dirname,
  '../../../../docs/plans/2026-07-19-all-locales-translation-audit-ledger.md'
);

const localeCodes = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();

const readLocale = (
  locale: string
): { raw: string; messages: LocaleMessages } => {
  const raw = readFileSync(join(LOCALES_DIR, locale, 'messages.json'), 'utf-8');

  return {
    raw,
    messages: JSON.parse(raw) as LocaleMessages,
  };
};

const english = readLocale('en').messages as EnglishMessages;
const englishKeys = Object.keys(english).sort();
const auditLedger = readFileSync(AUDIT_LEDGER_PATH, 'utf-8');

const ENGLISH_GUIDELINE_EXPECTATIONS: Readonly<Record<string, string>> = {
  'blockSettings.openMenuAction': ' to open the menu',
  'blockSettings.convertWithChildrenWarning':
    'Nested blocks: {count}. Converting this block will move them to the top level. Continue?',
  'tools.marker.textColor': 'Text color',
  'tools.toggle.bodyPlaceholder':
    'Empty toggle. Click to add a block, or drag blocks here.',
  'tools.table.insertColumnLeft': 'Insert column left',
  'tools.table.insertColumnRight': 'Insert column right',
  'tools.table.insertRowAbove': 'Insert row above',
  'tools.table.insertRowBelow': 'Insert row below',
  'tools.table.placement': 'Alignment',
  'tools.table.placementTopLeft': 'Top left',
  'tools.table.placementTopCenter': 'Top center',
  'tools.table.placementTopRight': 'Top right',
  'tools.table.placementMiddleLeft': 'Middle left',
  'tools.table.placementMiddleRight': 'Middle right',
  'tools.table.placementBottomLeft': 'Bottom left',
  'tools.table.placementBottomCenter': 'Bottom center',
  'tools.table.placementBottomRight': 'Bottom right',
  'a11y.dropCancelled': 'Drag canceled',
  'a11y.atTop': 'Block is at the top and cannot move up',
  'a11y.atBottom': 'Block is at the bottom and cannot move down',
  'a11y.searchResults': 'Search results: {count}',
  'a11y.allBlocksSelected': 'All blocks selected. Total: {count}',
  'tools.callout.addEmoji': 'Add icon',
  'tools.callout.filterEmojis': 'Search emojis…',
  'tools.callout.pickRandom': 'Pick a random emoji',
  'tools.code.searchLanguage': 'Search languages…',
  'tools.link.linkTitle': 'Link text',
  'tools.image.altDescription':
    'Describe this image for people who can’t see it.',
  'tools.file.previewError': 'Couldn’t load preview',
  'tools.database.viewTypeListDescription': 'Show items in a simple list',
  'tools.bookmark.loading': 'Loading link preview…',
  'tools.embed.empty': 'No embed link',
  'tools.video.toggleTimeDisplay':
    'Switch between elapsed and remaining time',
  'tools.video.ctxStats': 'Playback statistics',
  'tools.callout.emojiSearchResults': 'Emoji matches: {count}',
};

const decodeLedgerCode = (cell: string): string => {
  const trimmed = cell.trim();

  if (!trimmed.startsWith('`') || !trimmed.endsWith('`')) {
    return trimmed;
  }

  const code = trimmed.slice(1, -1);

  if (code.startsWith('"') && code.endsWith('"')) {
    return JSON.parse(code) as string;
  }

  return code;
};

const englishLedgerFindings = auditLedger
  .split('\n')
  .filter(line => line.startsWith('| `F-en-'))
  .map(line => {
    const cells = line
      .split('|')
      .slice(1, -1)
      .map(cell => cell.trim());

    return {
      id: decodeLedgerCode(cells[0] ?? ''),
      key: decodeLedgerCode(cells[2] ?? ''),
      expected: decodeLedgerCode(cells[5] ?? ''),
      status: cells[7] ?? '',
    };
  });

describe('translation guideline corpus integrity', () => {
  it.each(Object.entries(ENGLISH_GUIDELINE_EXPECTATIONS))(
    'English %s uses the approved source wording',
    (key, expected) => {
      expect(english[key], `${key} violates the English source-copy audit`).toBe(
        expected
      );
    }
  );

  it('keeps English source expectations synchronized with verified ledger findings', () => {
    const findingExpectations = Object.fromEntries(
      englishLedgerFindings.map(finding => [
        finding.key,
        finding.expected,
      ])
    );
    const expectedFindingIds = englishLedgerFindings
      .map(finding => finding.id)
      .sort();
    const localeAudit = auditLedger.slice(
      auditLedger.indexOf('## Locale Audit'),
      auditLedger.indexOf('## English Source Audit Evidence')
    );
    const englishRow = localeAudit
      .split('\n')
      .find(line => line.startsWith('| `en` |'));
    const englishCells = englishRow
      ?.split('|')
      .slice(1, -1)
      .map(cell => cell.trim());
    const recordedFindingIds = englishCells?.[10]
      ?.match(/F-en-\d{3}/gu)
      ?.sort() ?? [];

    expect(findingExpectations).toEqual(ENGLISH_GUIDELINE_EXPECTATIONS);
    expect(
      englishLedgerFindings.every(finding => finding.status === 'verified')
    ).toBe(true);
    expect(recordedFindingIds).toEqual(expectedFindingIds);
    expect(englishCells?.slice(7, 10)).toEqual(['pass', 'pass', 'pass']);
    expect(englishCells?.[11]).toBe('first-pass-complete');
  });

  it.each(localeCodes)('%s satisfies structural translation rules', locale => {
    const { raw, messages } = readLocale(locale);
    const duplicateKeys = findDuplicateJsonKeys(raw);
    const localeKeys = Object.keys(messages).sort();
    const integrityIssues = findLocaleIntegrityIssues(english, messages);

    expect(
      duplicateKeys,
      `${locale} has duplicate decoded JSON keys`
    ).toEqual([]);
    expect(localeKeys, `${locale} keys differ from English`).toEqual(
      englishKeys
    );
    expect(
      integrityIssues,
      `${locale} has translation integrity issues`
    ).toEqual([]);
  });
});
