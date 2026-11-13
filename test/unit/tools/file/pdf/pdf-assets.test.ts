import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PDF_ASSET_FILES, PdfAssetFactory } from '../../../../../src/tools/file/pdf/pdf-assets';

const PDFJS = resolve(__dirname, '../../../../../node_modules/pdfjs-dist');
const ASSETS = resolve(__dirname, '../../../../../src/tools/file/pdf/assets');

const bytesOf = (dir: string, name: string): Uint8Array => new Uint8Array(readFileSync(resolve(PDFJS, dir, name)));

describe('pdf.js assets bundled with Blok', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bundles every cmap pdfjs-dist ships', () => {
    const shipped = readdirSync(resolve(PDFJS, 'cmaps')).filter((name) => name.endsWith('.bcmap')).sort();

    expect(Object.keys(PDF_ASSET_FILES.cMapUrl).sort()).toEqual(shipped);
  });

  it('bundles only the standard fonts pdf.js asks for when system fonts are on', () => {
    expect(Object.keys(PDF_ASSET_FILES.standardFontDataUrl).sort()).toEqual(['FoxitDingbats.pfb', 'FoxitSymbol.pfb']);
  });

  it('bundles the image decoders, not the ICC or JS-eval wasm', () => {
    expect(Object.keys(PDF_ASSET_FILES.wasmUrl).sort()).toEqual(['jbig2.wasm', 'openjpeg.wasm']);
  });

  it('keeps each generated module equal to its pdfjs-dist file', () => {
    // Read as text: importing all 172 modules costs vitest ~45 s.
    const groups = [['cmaps', 'cmaps'], ['standard_fonts', 'fonts'], ['wasm', 'wasm']] as const;

    for (const [from, dir] of groups) {
      for (const module of readdirSync(resolve(ASSETS, dir))) {
        const source = readFileSync(resolve(ASSETS, dir, module), 'utf8');
        const body = /export default `([^`]*)`;/.exec(source)?.[1];
        // Short lines: source scanners with greedy regexes go quadratic on one long token.
        expect(body?.split('\n').every((line) => line.length <= 76), `${dir}/${module} line length`).toBe(true);
        const base64 = body?.replace(/\s/g, '');
        const name = readdirSync(resolve(PDFJS, from)).find((file) => file.replace(/\.[^.]+$/, '.ts') === module) ?? module;

        expect(base64, `${dir}/${module}`).toBe(Buffer.from(bytesOf(from, name)).toString('base64'));
      }
    }
  });

  it('hands pdf.js the exact bytes, one file of each kind', async () => {
    const factory = new PdfAssetFactory();

    expect(await factory.fetch({ kind: 'cMapUrl', filename: '90ms-RKSJ-H.bcmap' })).toEqual(bytesOf('cmaps', '90ms-RKSJ-H.bcmap'));
    expect(await factory.fetch({ kind: 'standardFontDataUrl', filename: 'FoxitDingbats.pfb' })).toEqual(bytesOf('standard_fonts', 'FoxitDingbats.pfb'));
    expect(await factory.fetch({ kind: 'wasmUrl', filename: 'jbig2.wasm' })).toEqual(bytesOf('wasm', 'jbig2.wasm'));
  });

  it('rejects a file it does not bundle, so pdf.js warns and goes on', async () => {
    await expect(new PdfAssetFactory().fetch({ kind: 'wasmUrl', filename: 'qcms_bg.wasm' })).rejects.toThrow('qcms_bg.wasm');
    await expect(new PdfAssetFactory().fetch({ kind: 'iccUrl', filename: 'x.icc' })).rejects.toThrow('iccUrl');
  });
});
