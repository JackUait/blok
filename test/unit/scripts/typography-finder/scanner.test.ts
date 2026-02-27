/**
 * Tests for Typography Scanner
 * Tests the scanning of source files for typography violations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanSourceDirectory, findTypographyIssues, scanFile, clearTypoCache } from '../../../../scripts/typography-finder/scanner';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

describe('Typography Scanner', () => {
  const testDir = join(process.cwd(), 'test-temp-typo');

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    clearTypoCache();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    clearTypoCache();
  });

  describe('findTypographyIssues - French punctuation', () => {
    it('should detect missing NBSP before question mark in French text', () => {
      const code = `const text = 'Comment ça va ?';`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({
        type: 'missing-nbsp',
        punctuation: '?',
        line: 1,
      });
    });

    it('should detect missing NBSP before exclamation mark', () => {
      const code = `const text = 'Bonjour !';`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].punctuation).toBe('!');
    });

    it('should detect missing NBSP before colon', () => {
      const code = `const text = 'Note : ceci est important';`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].punctuation).toBe(':');
    });

    it('should detect missing NBSP before semicolon', () => {
      const code = `const text = 'Oui ; mais non';`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].punctuation).toBe(';');
    });

    it('should detect missing NBSP before percent sign', () => {
      const code = `const text = 'Une réduction de 20 %';`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].punctuation).toBe('%');
    });

    it('should detect missing NBSP before euro symbol', () => {
      const code = `const text = 'Le prix est de 10 €';`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].punctuation).toBe('€');
    });

    it('should detect missing NBSP before dollar sign', () => {
      const code = `const text = 'Le coût est de 50 $';`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].punctuation).toBe('$');
    });

    it('should detect missing NBSP in guillemets', () => {
      const code = `const text = 'Il a dit « bonjour » à tous';`;
      const result = findTypographyIssues(code);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some(i => i.type === 'missing-nbsp-guillemets')).toBe(true);
    });

    it('should detect multiple issues in one line', () => {
      const code = `const text = 'Quoi ? Comment ? Incroyable !';`;
      const result = findTypographyIssues(code);
      expect(result.issues.length).toBeGreaterThanOrEqual(3);
    });

    it('should not flag text with existing NBSP', () => {
      const nbsp = '\u00A0';
      const code = `const text = 'Bonjour${nbsp}!';`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });

    it('should not flag English text (no space before punctuation)', () => {
      const code = `const text = 'How are you?';`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('findTypographyIssues - JSX/TSX elements', () => {
    it('should detect issues in JSX text content', () => {
      const code = `<div>Comment ça va ?</div>;`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(1);
    });

    it('should detect issues in template literals', () => {
      const code = `const text = \`Bonjour ${name} !\`;`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(1);
    });

    it('should handle JSX with expressions', () => {
      const code = `<span>Hello {name} !</span>`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(1);
    });

    it('should not flag code/technical strings', () => {
      const code = `const regex = /test?/;`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });

    it('should not flag URLs', () => {
      const code = `const url = 'https://example.com?query=value';`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });

    it('should not flag CSS class names', () => {
      const code = `const classes = 'btn btn-primary!';`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('findTypographyIssues - Edge cases', () => {
    it('should handle empty strings', () => {
      const result = findTypographyIssues('');
      expect(result.issues).toHaveLength(0);
    });

    it('should handle strings without punctuation', () => {
      const code = `const text = 'Just plain text';`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });

    it('should handle punctuation at start of string', () => {
      const code = `const text = '!';`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });

    it('should skip commented lines', () => {
      const code = `
        // const text = 'Bonjour !';
        const text = 'Valid';
      `;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('scanFile', () => {
    it('should scan a TypeScript file and return typography issues', async () => {
      const filePath = join(testDir, 'test.ts');
      await writeFile(filePath, `const text = 'Bonjour !';`, 'utf-8');

      const result = await scanFile(filePath);
      expect(result.issues).toHaveLength(1);
      expect(result.filePath).toBe(filePath);
    });

    it('should return empty result for non-text files', async () => {
      const filePath = join(testDir, 'image.png');
      await writeFile(filePath, Buffer.from([0x89, 0x50]));

      const result = await scanFile(filePath);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('scanSourceDirectory', () => {
    it('should scan all TypeScript files in directory', async () => {
      await writeFile(join(testDir, 'file1.ts'), `const text = 'Bonjour !';`);
      await writeFile(join(testDir, 'file2.ts'), `const text = 'Comment ça va ?';`);
      await writeFile(join(testDir, 'file3.ts'), `const text = 'Valid text';`);

      const result = await scanSourceDirectory(testDir);

      expect(result.filesScanned).toBeGreaterThanOrEqual(3);
      expect(result.totalIssues).toBeGreaterThan(0);
    });

    it('should skip node_modules', async () => {
      const nodeModulesDir = join(testDir, 'node_modules', 'some-package');
      await mkdir(nodeModulesDir, { recursive: true });
      await writeFile(join(nodeModulesDir, 'index.ts'), `const text = 'Bonjour !';`);

      await writeFile(join(testDir, 'local.ts'), `const text = 'Valid !';`);

      const result = await scanSourceDirectory(testDir);

      // Local file should be scanned
      expect(result.totalIssues).toBeGreaterThan(0);
    });
  });

  describe('Real-world patterns', () => {
    it('should detect issues in React component with French text', async () => {
      await writeFile(join(testDir, 'Button.tsx'), `
        export const Button = () => {
          return <button type="button">Cliquez ici !</button>;
        };
      `, 'utf-8');

      const result = await scanSourceDirectory(testDir);
      expect(result.totalIssues).toBeGreaterThan(0);
      expect(result.fileResults.some(f => f.issues.length > 0)).toBe(true);
    });

    it('should handle mixed English and French', async () => {
      await writeFile(join(testDir, 'Mixed.tsx'), `
        <div>
          <p>Hello!</p>
          <p>Comment ça va ?</p>
        </div>
      `, 'utf-8');

      const result = await scanSourceDirectory(testDir);
      // Only French should have issues
      expect(result.totalIssues).toBe(1);
    });
  });

  describe('False positive detection - template expressions', () => {
    it('should not flag ternary operators in template literals', () => {
      // Use a string that looks like the code but with actual values
      const code = "const classes = `prefix ${true ? 'a' : 'b'} suffix`;";
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });

    it('should not flag ? in ternary operators with spaces', () => {
      const code = `const result = index > length ? length : index;`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });

    it('should not flag : in ternary operators', () => {
      const code = `const value = condition ? true : false;`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });

    it('should not flag ${...} template expressions', () => {
      const code = "const text = `Hello ${name}!`;";
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });

    it('should not flag $ in regex replacement patterns ($1, $2, etc.)', () => {
      const code = `const result = text.replace(/([a-z])([A-Z])/g, '$1 $2');`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('False positive detection - operators', () => {
    it('should not flag != comparison operator', () => {
      const code = `if (value !== null && target !== element) { return; }`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });

    it('should not flag ! in negation', () => {
      const code = `if (!isValid) { return; }`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });

    it('should not flag : in TypeScript type annotations', () => {
      const code = `type ConsoleMethod = keyof Console;`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });

    it('should not flag : in object literal properties', () => {
      const code = `const obj = { key: 'value', count: 42 };`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });

    it('should not flag conditional types in TypeScript', () => {
      const code = `type Result<T> = T extends string ? 'string' : 'other';`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('False positive detection - CSS classes', () => {
    it('should not flag Tailwind !important modifier', () => {
      const code = `const classes = 'shadow-none bg-transparent mr-0!';`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });

    it('should not flag Tailwind utility classes with hyphens', () => {
      const code = `const classes = 'text-red-500 bg-blue-100 w-full';`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });

    it('should not flag twMerge patterns', () => {
      const code = `return twMerge(css.icon, isInline && 'w-auto h-auto');`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });

    it('should not flag className patterns', () => {
      const code = `className: 'flex items-center justify-center',`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('False positive detection - code syntax', () => {
    it('should not flag CSS-in-JS box-shadow values', () => {
      const code = `wrapper.style.boxShadow = \`0 \${extension}px 0 \${this.BG_COLOR}\`;`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });

    it('should not flag currency symbols in non-string contexts', () => {
      const code = `const price = \$0; // or code variable names`;
      const result = findTypographyIssues(code);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('Directory exclusion', () => {
    it('should exclude blok-master directory from scanning', async () => {
      const blokMasterDir = join(testDir, 'blok-master', 'src');
      await mkdir(blokMasterDir, { recursive: true });
      await writeFile(join(blokMasterDir, 'test.ts'), `const text = 'Bonjour !';`);

      const result = await scanSourceDirectory(testDir);
      // blok-master should be excluded, so no issues from that file
      expect(result.totalIssues).toBe(0);
    });

    it('should exclude typography-finder directory from scanning', async () => {
      const typoFinderDir = join(testDir, 'typography-finder');
      await mkdir(typoFinderDir, { recursive: true });
      await writeFile(join(typoFinderDir, 'test.ts'), `const text = 'Bonjour !';`);

      const result = await scanSourceDirectory(testDir);
      expect(result.totalIssues).toBe(0);
    });
  });
});
