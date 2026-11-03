/**
 * Blob URL law.
 *
 * A blob: URL has the page's origin. A text/html, SVG or XML blob opened in a
 * tab or a frame runs script AS THE HOST, in Chrome, Firefox and WebKit, and
 * `rel="noopener"` does not help. WebKit also sniffs octet-stream, zip, Office
 * and untyped blobs into HTML. Firefox opens a blob in a tab on middle-click
 * even when the link has `download`.
 *
 * So every blob: URL in src/ is made by createSafeObjectUrl
 * (src/shared/safe-object-url.ts), which re-types any type outside a measured
 * safe list to text/plain. Its `svgImage` option keeps SVG, so each use needs
 * a reason. A raw `URL.createObjectURL` needs a reasoned exemption.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(__dirname, '../../../src');
const HELPER = 'shared/safe-object-url.ts';

/** Raw createObjectURL calls, keyed by file. Every entry MUST carry a reason. */
const RAW_EXEMPTIONS: Record<string, string> = {
  [HELPER]: 'the helper itself',
  'playground/icon-gallery.ts':
    'dev playground only, not in the published bundle; Blok\'s own icon SVG, downloaded by a plain click',
};

/** `svgImage: true` users, keyed by file. The URL must never open as a page. */
const SVG_IMAGE_USERS: Record<string, string> = {
  'tools/image/uploader.ts':
    'the image block shows it in <img>; download goes through tools/image/download.ts. ' +
    'KNOWN RISK: opened in its own tab, the SVG runs script in the host origin; only an uploader avoids it',
  'tools/image/index.ts': 'the failed-upload thumbnail is an <img>',
  'tools/image/download.ts': 'a plain programmatic click on an <a download>, which downloads in all three browsers',
  'components/utils/asset-uploader.ts':
    'only for kind "image", whose tools show it in <img>; every other kind is re-typed. ' +
    'Same known risk as tools/image/uploader.ts',
  'tools/database/database-chart-view.ts': 'the chart SVG is drawn into an <img> to rasterize it, then revoked',
  'tools/database/database-download.ts': 'a plain programmatic click on an <a download>, then revoked',
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      return walk(full);
    }

    return full.endsWith('.ts') && !full.endsWith('.d.ts') && !full.endsWith('.test.ts') ? [full] : [];
  });
}

function isCommentLine(text: string): boolean {
  const trimmed = text.trim();

  return trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*');
}

interface Hit {
  file: string;
  line: number;
}

function scan(pattern: RegExp): Hit[] {
  return walk(SRC_DIR).flatMap((path) => {
    const file = relative(SRC_DIR, path);

    return readFileSync(path, 'utf8').split('\n').flatMap((text, index) => (
      !isCommentLine(text) && pattern.test(text) ? [{ file, line: index + 1 }] : []
    ));
  });
}

describe('Blob URL law', () => {
  const raw = scan(/\bcreateObjectURL\b/);
  const helperCalls = scan(/\bcreateSafeObjectUrl\(/);
  const svgImage = scan(/\bsvgImage\s*:/);

  it('finds the known blob URL sites (a regex break must not pass silently)', () => {
    expect(raw.some((hit) => hit.file === HELPER)).toBe(true);
    expect(helperCalls.length).toBeGreaterThanOrEqual(10);
  });

  it('makes every blob: URL through createSafeObjectUrl, or a reasoned exemption', () => {
    const violations = raw
      .filter((hit) => !(hit.file in RAW_EXEMPTIONS))
      .map((hit) => `${hit.file}:${hit.line} calls URL.createObjectURL; use createSafeObjectUrl`);

    expect(violations).toEqual([]);
  });

  it('gives every svgImage use a reason', () => {
    const violations = svgImage
      .filter((hit) => hit.file !== HELPER && !(hit.file in SVG_IMAGE_USERS))
      .map((hit) => `${hit.file}:${hit.line} keeps an SVG blob; add it to SVG_IMAGE_USERS with a reason, or drop svgImage`);

    expect(violations).toEqual([]);
  });

  it('keeps every exemption alive (a stale entry means the site moved)', () => {
    const rawFiles = new Set(raw.map((hit) => hit.file));
    const svgFiles = new Set(svgImage.map((hit) => hit.file));

    expect([
      ...Object.keys(RAW_EXEMPTIONS).filter((file) => !rawFiles.has(file)),
      ...Object.keys(SVG_IMAGE_USERS).filter((file) => !svgFiles.has(file)),
    ]).toEqual([]);
  });
});

/**
 * Hosts copy these uploaders as examples, and the presets package ships to
 * them, so they follow the same rule as src/.
 */
describe('Blob URL law outside src/', () => {
  const ROOT = resolve(__dirname, '../../..');
  const SAMPLES = ['index.html', 'docs/src/components/demo/EditorWrapper.tsx'];
  const PRESETS_DIR = join(ROOT, 'packages/presets/src');

  it('never hands Blok a blob: URL of the raw uploaded file in a sample uploader', () => {
    const violations = SAMPLES.flatMap((file) => readFileSync(join(ROOT, file), 'utf8').split('\n').flatMap((text, index) => (
      /\bcreateObjectURL\(\s*file\s*\)/.test(text) ? [`${file}:${index + 1} passes the raw file; re-type it like createSafeObjectUrl`] : []
    )));

    expect(violations).toEqual([]);
  });

  it('makes every blob: URL in the presets package through createSafeObjectUrl', () => {
    const violations = walk(PRESETS_DIR).flatMap((path) => readFileSync(path, 'utf8').split('\n').flatMap((text, index) => (
      !isCommentLine(text) && /\bcreateObjectURL\b/.test(text) ? [`${relative(ROOT, path)}:${index + 1}`] : []
    )));

    expect(violations).toEqual([]);
  });
});
