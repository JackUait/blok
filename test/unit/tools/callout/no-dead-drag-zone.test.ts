// test/unit/tools/callout/no-dead-drag-zone.test.ts
//
// Structural lock-in: the callout block MUST NOT reintroduce the invisible
// inner drag-zone span that was removed in commit 4f325025. The bug rewired
// the settings-toggler drag handler to `[data-callout-drag-zone]`, making
// the visible grip-dots icon non-functional. This test forbids every symbol
// involved in that pattern from reappearing in production source.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC_ROOT = resolve(__dirname, '../../../../src');

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /data-callout-drag-zone/,
    reason: 'invisible drag-zone span was removed; wire drag on settingsToggler instead',
  },
  {
    pattern: /calloutDragZone/,
    reason: 'dragZone variable was removed from toolbar + callout tool',
  },
  {
    pattern: /DRAG_ZONE_STYLES/,
    reason: 'DRAG_ZONE_STYLES constant was removed from src/tools/callout/constants',
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      walk(full, out);
      // eslint-disable-next-line vitest/no-conditional-tests -- utility walk fn, not a conditional test
    } else if (/\.(ts|tsx|js|jsx|css|scss)$/.test(entry)) {
      out.push(full);
    }
  }

  return out;
}

describe('callout: dead drag-zone pattern lock-in', () => {
  const files = walk(SRC_ROOT);

  it(`no production source contains ${FORBIDDEN_PATTERNS[0].pattern.source} (${FORBIDDEN_PATTERNS[0].reason})`, () => {
    const { pattern } = FORBIDDEN_PATTERNS[0];
    const offenders: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf8');

      if (pattern.test(content)) {
        offenders.push(file.replace(SRC_ROOT, 'src'));
      }
    }

    expect(offenders).toEqual([]);
  });

  it(`no production source contains ${FORBIDDEN_PATTERNS[1].pattern.source} (${FORBIDDEN_PATTERNS[1].reason})`, () => {
    const { pattern } = FORBIDDEN_PATTERNS[1];
    const offenders: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf8');

      if (pattern.test(content)) {
        offenders.push(file.replace(SRC_ROOT, 'src'));
      }
    }

    expect(offenders).toEqual([]);
  });

  it(`no production source contains ${FORBIDDEN_PATTERNS[2].pattern.source} (${FORBIDDEN_PATTERNS[2].reason})`, () => {
    const { pattern } = FORBIDDEN_PATTERNS[2];
    const offenders: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, 'utf8');

      if (pattern.test(content)) {
        offenders.push(file.replace(SRC_ROOT, 'src'));
      }
    }

    expect(offenders).toEqual([]);
  });
});
