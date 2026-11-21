import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE LAW — the interface never writes words in capitals.
 *
 * Labels, headings, badges and docs prose read "Default", never "DEFAULT".
 * Acronyms (PDF, URL), initials in an avatar, key letters and a file's own
 * formatting stay as they are.
 *
 * 1. No stylesheet, class string or inline style turns text into capitals:
 *    `text-transform: uppercase`, Tailwind `uppercase`, small caps.
 * 2. No locale string, docs data string or docs JSX text writes a word in
 *    capitals unless it is an acronym.
 */

const REPO_ROOT = resolve(__dirname, '../../..');

const tracked = (...globs: string[]): string[] => execFileSync('git', ['ls-files', '--', ...globs], { cwd: REPO_ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((file) => file.length > 0);

const UI_FILES = tracked('src', 'docs/src', 'packages/*/src', 'index.html', 'override-extension')
  .filter((file) => /\.(css|ts|tsx|vue|html|mjs|js)$/.test(file))
  .filter((file) => !/\.(test|spec|mutants)\.|\/__snapshots__\/|\.d\.ts$/.test(file));

/** `file` → why capitals are right there. A key `file::selector` exempts one CSS rule. */
const EXEMPT: Record<string, string> = {
  'src/styles/presence.css::[data-blok-presence-face]': 'Initials of a person in an avatar.',
  'index.html::.playground-presence-face': 'Initials of a person in an avatar.',
  'src/tools/file/docx/props.ts': 'Reproduces the caps and small-caps formatting a .docx file asks for.',
  'src/tools/file/pptx/renderer/TextRenderer.ts': 'Reproduces the caps and small-caps formatting a .pptx file asks for.',
};

const CSS_CAPS = /text-transform\s*:\s*uppercase|font-variant(?:-caps)?\s*:[^;}]*\b(?:all-)?(?:small|petite)-caps\b|font-variant(?:-caps)?\s*:[^;}]*\b(?:unicase|titling-caps)\b/g;
const JS_CAPS = /textTransform\s*[:=]\s*['"`]uppercase|fontVariant(?:Caps)?\s*[:=]\s*['"`][^'"`]*caps/g;
const CLASS_CAPS = /['"`][^'"`\n]*(?<![\w-])uppercase(?![\w-])[^'"`\n]*['"`]/g;

const selectorBefore = (text: string, index: number): string => {
  const open = text.lastIndexOf('{', index);
  const start = Math.max(text.lastIndexOf('}', open) + 1, text.lastIndexOf(';', open) + 1, text.lastIndexOf('*/', open) + 2);

  return text.slice(start, open).trim();
};

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/** Words in capitals that are not acronyms. Code spans and placeholders hold identifiers like BLOK_FONT_SIZE_TOKENS. */
const shoutedWords = (text: string): string[] => {
  const prose = text.replace(/<code>[\s\S]*?<\/code>|`[^`]*`|\{[^}]*\}|https?:\S+/g, ' ');

  return [...prose.matchAll(/(?<![\p{L}\p{N}_./-])\p{Lu}[\p{Lu}\p{N}]+(?![\p{L}_])/gu)]
    .map(([word]) => word)
    .filter((word) => !ACRONYMS.has(word));
};

const ACRONYM_HINT = 'Write the word in normal case. If it is an acronym, add it to ACRONYMS.';

describe('no all-caps law', () => {
  it('no stylesheet, class string or inline style writes text in capitals', () => {
    const offenders: string[] = [];

    for (const file of UI_FILES) {
      if (EXEMPT[file] !== undefined) {
        continue;
      }
      const text = readFileSync(resolve(REPO_ROOT, file), 'utf8');

      // `::first-letter` capitals give sentence case, which is the goal.
      const isAllowed = (selector: string): boolean => /::?first-letter\s*$/.test(selector)
        || selector.split(',').some((part) => EXEMPT[`${file}::${part.trim()}`] !== undefined);

      offenders.push(...[...text.matchAll(CSS_CAPS)]
        .map((match) => ({ match, selector: selectorBefore(text, match.index) }))
        .filter(({ selector }) => !isAllowed(selector))
        .map(({ match, selector }) => `${file}:${lineOf(text, match.index)} ${selector} { ${match[0]} }`));

      if (file.endsWith('.css')) {
        continue;
      }

      for (const match of [...text.matchAll(JS_CAPS), ...text.matchAll(CLASS_CAPS)]) {
        offenders.push(`${file}:${lineOf(text, match.index)} ${match[0].slice(0, 120)}`);
      }
    }

    expect(offenders, 'Write the text in normal case instead of turning it into capitals. Only initials or a document\'s own formatting go in EXEMPT, with a reason.').toEqual([]);
  });

  it('no locale string writes a word in capitals unless it is an acronym', () => {
    const files = tracked('src/components/i18n/locales/*.json', 'docs/src/i18n/*.json');
    const flat = (value: unknown, path: string): Array<[string, string]> => {
      if (typeof value === 'string') {
        return [[path, value]];
      }
      if (value !== null && typeof value === 'object') {
        return Object.entries(value).flatMap(([key, child]) => flat(child, path === '' ? key : `${path}.${key}`));
      }

      return [];
    };
    const offenders: string[] = [];

    expect(files.length).toBeGreaterThan(70);

    for (const file of files) {
      for (const [key, value] of flat(JSON.parse(readFileSync(resolve(REPO_ROOT, file), 'utf8')), '')) {
        offenders.push(...shoutedWords(value).map((word) => `${file} ${key}: ${word}`));
      }
    }

    expect(offenders, ACRONYM_HINT).toEqual([]);
  });

  // English docs prose lives in the data modules; en.json only overlays it.
  it('no docs data string or docs JSX text writes a word in capitals unless it is an acronym', () => {
    const files = tracked('docs/src').filter((file) => /-data\.ts$|\.tsx$/.test(file) && !/\.(test|spec)\./.test(file));
    const offenders: string[] = [];

    expect(files.some((file) => file.endsWith('api-data.ts'))).toBe(true);

    for (const file of files) {
      const source = ts.createSourceFile(file, readFileSync(resolve(REPO_ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (node: ts.Node): void => {
        // A .tsx file's string literals are mostly SVG paths, colours and class names, so only its JSX text counts.
        const prose = ts.isJsxText(node) || (file.endsWith('-data.ts') && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)));

        if (prose) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

          offenders.push(...shoutedWords(node.text).map((word) => `${file}:${line} ${word}`));
        }
        ts.forEachChild(node, visit);
      };

      visit(source);
    }

    expect(offenders, ACRONYM_HINT).toEqual([]);
  });
});

/** Words that are written in capitals in their own language. */
const ACRONYMS = new Set([
  // Latin script.
  'ABD', 'ABŞ', 'ACL', 'AI', 'AMER', 'APAC', 'API', 'AS', 'ASCII', 'ASP', 'ASV', 'AVIF', 'AWS', 'BCP', 'BUJ',
  'C0', 'C1', 'CCITT', 'CDN', 'CJK', 'CMD', 'CMYK', 'CN', 'COOP', 'CORS', 'CRDT', 'CSP', 'CSS', 'CSV',
  'DEL', 'DELETE', 'DFS', 'DI', 'DIY', 'DNS', 'DOM', 'DTO', 'DUK', 'EAE', 'EMEA', 'ESC', 'F10', 'F2', 'F3',
  'FAQ', 'FFFD', 'FR', 'GCS', 'GET', 'GFM', 'GIF', 'GTM', 'GYIK', 'H1', 'H5', 'H6', 'HEX', 'HMAC', 'HOC',
  'HR', 'HS256', 'HTML', 'HTTP', 'HTTPS', 'I1', 'IA', 'ICC', 'ID', 'INSERT', 'IP', 'ISO', 'JAV', 'JBIG2', 'JPEG', 'JS',
  'JSON', 'JWT', 'KB', 'KI', 'KKK', 'L7', 'LATAM', 'LLM', 'LTR', 'MB', 'MCP', 'MI', 'MIME', 'MP4', 'MPL', 'NLO', 'NLP',
  'NSO', 'NUL', 'OK', 'OS', 'OZN', 'PDF', 'PNG', 'POST', 'PRD', 'PUT', 'Q3', 'QSR', 'R2', 'README', 'RSC',
  'RTL', 'S3', 'SAE', 'SELECT', 'SEO', 'SI', 'Sİ', 'SHA256', 'SSE', 'SSR', 'SSRF', 'SSS', 'SVG', 'T2', 'T3', 'TI',
  'TLS', 'TS', 'UA', 'UAE', 'UFO', 'UI', 'UK', 'UKK', 'US', 'USA', 'URL', 'UTC', 'UTF', 'VAE', 'VIP', 'VPS', 'WWW',
  'XL', 'XML', 'XS', 'XSS', 'ZEA',
  // ISO 4217 currency codes in the Number format labels.
  'AED', 'ARS', 'AUD', 'BRL', 'BTC', 'CAD', 'CHF', 'CLP', 'CNY', 'COP', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'JPY', 'KRW',
  'MXN', 'MYR', 'NGN', 'NOK', 'NZD', 'PEN', 'PHP', 'PKR', 'PLN', 'RON', 'RUB', 'SAR', 'SEK', 'SGD', 'THB', 'TRY', 'TWD', 'USD', 'UYU', 'VND', 'ZAR',
  // Greek, Cyrillic and Armenian script.
  'ΑΤΙΑ', 'ΗΠΑ', 'ΤΝ', 'ВИ', 'ИИ', 'КБ', 'ЛПР', 'НЛО', 'ОАЕ', 'ОАЭ', 'ОК', 'ОС', 'США', 'УАЕ', 'ЧЗВ', 'ШІ',
  'ԱԲ', 'ԱՄՆ',
]);
