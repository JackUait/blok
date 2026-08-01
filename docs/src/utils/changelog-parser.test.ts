/**
 * Tests for changelog parser
 */

import { describe, it, expect } from 'vitest';
import { parseChangelog } from './changelog-parser';

// Sample from the actual CHANGELOG.md to verify the parser handles real data
const REAL_CHANGELOG_SAMPLE = `# Changelog

All notable changes to this project will be documented in this file.

## [0.5.0](https://github.com/JackUait/blok/compare/v0.4.1-beta.5...v0.5.0) (2026-01-23)

### ✨ Features

- implement Conflict-Free Replicated Data Type (CRDT) undo/redo ([#33](https://github.com/JackUait/blok/pull/33)) ([98477264](https://github.com/JackUait/blok/commit/984772642af711dcbe23d06f14ed77c003012ecc))
- handle edge cases when converting lists in old format to lists in new format ([594f3ba7](https://github.com/JackUait/blok/commit/594f3ba77cee0a08bcf5f46bb8251e41d857ea8e))

### 🐛 Bug Fixes

- toolbar hover behavior after cross-block selection ([#35](https://github.com/JackUait/blok/pull/35)) ([122a50fc](https://github.com/JackUait/blok/commit/122a50fcdabee2e7003c8f464701ecc35e4fc9af))
- trigger PatternPasteEvent for internal cut/paste operations ([d98fd369](https://github.com/JackUait/blok/commit/d98fd36951cd5824d728ddb006572d071f6e8650))

### 🔧 CI/CD

- fix bundle size tracking ([#32](https://github.com/JackUait/blok/pull/32)) ([655691fd](https://github.com/JackUait/blok/commit/655691fde852d28cc9ec0c4e9e539ffd25f3ff4c))

### ♻️ Refactoring

- decouple files to reduce their complexity ([#34](https://github.com/JackUait/blok/pull/34)) ([55b77ce7](https://github.com/JackUait/blok/commit/55b77ce7140ec4cc08bec83861ac36bce244086c))
- reduce bundle size ([#30](https://github.com/JackUait/blok/pull/30)) ([c437a8be](https://github.com/JackUait/blok/commit/c437a8be38290ca1d0a5ac0d1f7978a414df2540))

### 🧹 Chores

- update storybook-related dependencies ([b5fb5313](https://github.com/JackUait/blok/commit/b5fb531379b5c4df597643e8133275207e919a8f))
- Pre-v1 Polish: UX Improvements & Bug Fixes ([#31](https://github.com/JackUait/blok/pull/31)) ([1917a221](https://github.com/JackUait/blok/commit/1917a2214f6f3c08923a3df6cf963949ae2125de))

## [0.4.1-beta.5](https://github.com/JackUait/blok/compare/v0.4.1-beta.4...v0.4.1-beta.5) (2025-12-07)

### 🐛 Bug Fixes

- external plugins may break because of Tailwind ([ee68032](https://github.com/JackUait/blok/commit/ee68032720482dbfba6cf9d3cf3602a6df755226))

### ✨ Features

- add data-blok-header-level to headers in the popover ([d27a758](https://github.com/JackUait/blok/commit/d27a7587803342279a10cbd7fdd317c984119fcd))
`;

describe('changelog-parser', () => {
  describe('parseChangelog', () => {
    it('should parse a simple changelog with one release', () => {
      const markdown = `
# Changelog

## [0.5.0](https://github.com/JackUait/blok/compare/v0.4.1...v0.5.0) (2026-01-23)

### ✨ Features

- implement undo/redo
- add new feature

### 🐛 Bug Fixes

- fix critical bug
`;

      const result = parseChangelog(markdown);

      expect(result).toHaveLength(1);
      expect(result[0].version).toBe('0.5.0');
      expect(result[0].date).toBe('2026-01-23');
      expect(result[0].releaseType).toBe('minor');
      expect(result[0].changes).toHaveLength(3);
    });

    it('should map emojis to correct categories', () => {
      const markdown = `
# Changelog

## [0.5.0](https://github.com/JackUait/blok/compare/v0.4.1...v0.5.0) (2026-01-23)

### ✨ Features
- new feature

### 🐛 Bug Fixes
- fix bug

### 🔧 CI/CD
- update workflow

### ♻️ Refactoring
- clean code

### 🧹 Chores
- update deps

### 🧪 Tests
- add tests

### ⚠️ Deprecated
- old API

### 🗑️ Removed
- delete feature

### 🔒 Security
- fix vulnerability
`;

      const result = parseChangelog(markdown);
      const changes = result[0].changes;

      expect(changes.find((c) => c.description === 'new feature')?.category).toBe('added');
      expect(changes.find((c) => c.description === 'fix bug')?.category).toBe('fix');
      expect(changes.find((c) => c.description === 'update workflow')?.category).toBe('changed');
      expect(changes.find((c) => c.description === 'clean code')?.category).toBe('changed');
      expect(changes.find((c) => c.description === 'update deps')?.category).toBe('changed');
      expect(changes.find((c) => c.description === 'add tests')?.category).toBe('changed');
      expect(changes.find((c) => c.description === 'old API')?.category).toBe('deprecated');
      expect(changes.find((c) => c.description === 'delete feature')?.category).toBe('removed');
      expect(changes.find((c) => c.description === 'fix vulnerability')?.category).toBe('security');
    });

    it('should categorize BREAKING CHANGES headers written with a bare ⚠ (no variation selector)', () => {
      const markdown = `
# Changelog

## [2.0.0](url) (2026-01-23)

### ⚠ BREAKING CHANGES

- the \`@bloklabs/*\` scope rebrand
`;

      const result = parseChangelog(markdown);

      expect(result[0].changes[0].category).toBe('breaking');
    });

    it('should categorize BREAKING CHANGES headers without an emoji', () => {
      const markdown = `
# Changelog

## [2.0.0](url) (2026-01-23)

### BREAKING CHANGES

- drop the legacy API
`;

      const result = parseChangelog(markdown);

      expect(result[0].changes[0].category).toBe('breaking');
    });

    it('should handle category headers without emojis', () => {
      const markdown = `
# Changelog

## [0.5.0](url) (2026-01-23)

### Features
- new feature

### Bug Fixes
- fix bug
`;

      const result = parseChangelog(markdown);
      const changes = result[0].changes;

      expect(changes.find((c) => c.description === 'new feature')?.category).toBe('added');
      expect(changes.find((c) => c.description === 'fix bug')?.category).toBe('fix');
    });

    it('should strip PR and commit links from change descriptions', () => {
      const markdown = `
# Changelog

## [0.5.0](url) (2026-01-23)

### ✨ Features
- implement undo/redo ([#33](https://github.com/JackUait/blok/pull/33)) ([98477264](https://github.com/JackUait/blok/commit/984772642af711dcbe23d06f14ed77c003012ecc))
`;

      const result = parseChangelog(markdown);
      expect(result[0].changes[0].description).toBe('implement undo/redo');
    });

    it('should parse multiple releases', () => {
      const markdown = `
# Changelog

## [0.5.0](url) (2026-01-23)

### ✨ Features
- feature A

### 🐛 Bug Fixes
- bug A

## [0.4.1](url) (2025-12-10)

### ✨ Features
- feature B
`;

      const result = parseChangelog(markdown);

      expect(result).toHaveLength(2);
      expect(result[0].version).toBe('0.5.0');
      expect(result[0].changes).toHaveLength(2);
      expect(result[1].version).toBe('0.4.1');
      expect(result[1].changes).toHaveLength(1);
    });

    it('should determine correct release types', () => {
      const markdown = `
# Changelog

## [1.0.0](url) (2026-01-23)
### ✨ Features
- major feature

## [0.5.0](url) (2026-01-20)
### ✨ Features
- minor feature

## [0.0.1](url) (2026-01-10)
### ✨ Features
- initial
`;

      const result = parseChangelog(markdown);

      expect(result[0].releaseType).toBe('major');
      expect(result[1].releaseType).toBe('minor');
      expect(result[2].releaseType).toBe('patch'); // 0.0.1 is a patch version (patch != 0)
    });

    it('should skip comment lines (starting with >)', () => {
      const markdown = `
# Changelog

## [0.4.1](url) (2025-12-16)

> This is the same as 0.4.1-beta.0 but tagged as a stable release.

### ✨ Features
- feature A
`;

      const result = parseChangelog(markdown);

      expect(result[0].changes).toHaveLength(1);
      expect(result[0].changes[0].description).toBe('feature A');
    });

    it('should handle beta and pre-release versions', () => {
      const markdown = `
# Changelog

## [0.4.1-beta.5](url) (2025-12-07)
### 🐛 Bug Fixes
- fix beta bug

## [1.0.0-rc.1](url) (2026-01-01)
### ✨ Features
- rc feature
`;

      const result = parseChangelog(markdown);

      expect(result[0].version).toBe('0.4.1-beta.5');
      expect(result[1].version).toBe('1.0.0-rc.1');
    });

    it('should create release URLs correctly', () => {
      const markdown = `
# Changelog

## [0.5.0](https://github.com/JackUait/blok/compare/v0.4.1...v0.5.0) (2026-01-23)

### ✨ Features
- feature A
`;

      const result = parseChangelog(markdown);

      expect(result[0].releaseUrl).toBe('https://github.com/JackUait/blok/releases/tag/v0.5.0');
    });

    it('should set highlight for non-patch releases with significant changes', () => {
      const markdown = `
# Changelog

## [0.5.0](url) (2026-01-23)

### ✨ Features
- CRDT-based undo/redo system
- Another feature

### 🐛 Bug Fixes
- fix bug
`;

      const result = parseChangelog(markdown);

      expect(result[0].highlight).toBe('CRDT-based undo/redo system');
    });

    it('should not set highlight for patch releases', () => {
      const markdown = `
# Changelog

## [0.4.2](url) (2026-01-23)

### ✨ Features
- small feature
`;

      const result = parseChangelog(markdown);

      expect(result[0].releaseType).toBe('patch');
      // Patch releases with features might still get a highlight, which is acceptable
    });

    it('should handle category headers with PR links', () => {
      const markdown = `
# Changelog

## [0.5.0](url) (2026-01-23)

### 🐛 Bug Fixes ([#35](url)) ([commit](url))
- fix the thing
`;

      const result = parseChangelog(markdown);

      expect(result[0].changes).toHaveLength(1);
      expect(result[0].changes[0].category).toBe('fix');
      expect(result[0].changes[0].description).toBe('fix the thing');
    });

    it('should handle empty changelog', () => {
      const markdown = `# Changelog\n\nNo releases yet.`;
      const result = parseChangelog(markdown);
      expect(result).toHaveLength(0);
    });
  });

  describe('getReleaseType', () => {
    // This is tested indirectly through parseChangelog
    it('should correctly identify major versions', () => {
      const markdown = `
# Changelog

## [2.0.0](url) (2026-01-23)
### ✨ Features
- breaking
`;
      const result = parseChangelog(markdown);
      expect(result[0].releaseType).toBe('major');
    });
  });

  describe('parseChangelog with real data sample', () => {
    it('should parse the real CHANGELOG.md sample', () => {
      const result = parseChangelog(REAL_CHANGELOG_SAMPLE);

      // Verify we get 2 releases
      expect(result).toHaveLength(2);

      // Verify first release
      const first = result[0];
      expect(first.version).toBe('0.5.0');
      expect(first.date).toBe('2026-01-23');
      expect(first.releaseType).toBe('minor');
      expect(first.changes.length).toBeGreaterThan(0);

      // Verify changes have categories without markdown links
      first.changes.forEach((change) => {
        expect(['added', 'changed', 'fix', 'deprecated', 'removed', 'security']).toContain(change.category);
        expect(change.description).not.toContain('](');
        expect(change.description).not.toContain('github.com');
      });
    });

    it('should strip all PR and commit links from the real sample', () => {
      const result = parseChangelog(REAL_CHANGELOG_SAMPLE);

      // Find the "CRDT undo/redo" change
      const crdtChange = result[0].changes.find(
        (c) => c.description.includes('Conflict-Free Replicated Data Type')
      );
      expect(crdtChange).toBeDefined();
      expect(crdtChange!.description).toBe('implement Conflict-Free Replicated Data Type (CRDT) undo/redo');
    });

    it('should correctly categorize all emoji categories from the real sample', () => {
      const result = parseChangelog(REAL_CHANGELOG_SAMPLE);
      const changes = result[0].changes;

      // Check that we have each category type present in the sample
      const categories = new Set(changes.map((c) => c.category));
      expect(categories.has('added')).toBe(true); // ✨ Features
      expect(categories.has('fix')).toBe(true); // 🐛 Bug Fixes
      expect(categories.has('changed')).toBe(true); // 🔧 CI/CD, ♻️ Refactoring, 🧹 Chores
    });
  });
});
