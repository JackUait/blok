import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseZip, RECOMMENDED_ZIP_LIMITS } from '../../../../../src/tools/file/pptx/parser/ZipParser';
import JSZipShim from '../../../../../src/tools/file/zip/jszip-shim';

import { OFFICE_CASES, listLikePptxRenderer, normalize } from './office-normalize';

// Golden output was captured with @aiden0z/pptx-renderer on the real jszip 3.10.2. The
// in-house pptx engine replaced both and must still list a deck the same way.
const bytesOf = (rel: string): Uint8Array<ArrayBuffer> => new Uint8Array(readFileSync(resolve(__dirname, rel)));

describe('the pptx engine reads zips the same as pptx-renderer did through jszip', () => {
  it.each([
    ['pptx', OFFICE_CASES.pptx],
    ['xlsx', OFFICE_CASES.xlsx],
  ])('the pptx engine lists the %s like the golden', async (kind, rel) => {
    const files = await parseZip(bytesOf(rel).buffer, RECOMMENDED_ZIP_LIMITS);

    await expect(`${JSON.stringify(normalize(files), null, 1)}\n`).toMatchFileSnapshot(`./fixtures/golden/pptx-parse-${kind}.json`);
  });

  it.each([
    ['pptx', OFFICE_CASES.pptx],
    ['xlsx', OFFICE_CASES.xlsx],
  ])('the shim lists the %s like the golden', async (kind, rel) => {
    const listed = await listLikePptxRenderer(await JSZipShim.loadAsync(bytesOf(rel)));

    await expect(`${JSON.stringify(listed, null, 1)}\n`).toMatchFileSnapshot(`./fixtures/golden/zip-listing-${kind}.json`);
  });

  // The media golden was captured by bundling the renderer with the real jszip 3.10.2.
  it('the pptx engine reads a slide picture like jszip did', async () => {
    const files = await parseZip(bytesOf(OFFICE_CASES.pptxImage).buffer, RECOMMENDED_ZIP_LIMITS);

    expect(files.media.size).toBe(1);
    await expect(`${JSON.stringify(normalize(files), null, 1)}\n`).toMatchFileSnapshot('./fixtures/golden/pptx-parse-pptx-image.json');
  });
});
